// Sportsmanship ratings for Pickup-Finder (GitHub issue #13).
//
// After a game ends, each player can rate every other player in it, positive
// or negative, with an optional comment, like feedback on eBay or Facebook
// Marketplace. Every player's totals, score, and feedback are public to
// signed-in users, and matchmaking.js uses the score to suggest games.
//
// The data model and examples are in README.md in this folder. The security
// rules in firestore.rules enforce who can rate whom; the checks here exist so
// the page can show a clear message before Firestore says no.
//
// Usage:
//   import { leaveFeedback, playersToRate, getPlayerStats } from "../firebase/sportsmanship.js";
//
// Like events.js, call these only after Firebase Auth has finished loading the
// user (inside onAuthStateChanged).

import { db, auth } from "./firebase-config.js";
import {
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { EventError } from "./events.js";

// Keep these in sync with the feedback rules in firestore.rules.
export const RATINGS = ["positive", "negative"];
export const MAX_COMMENT = 300;
export const FEEDBACK_WINDOW_DAYS = 14;

// A player's score counts this many extra positive ratings, so a new player
// starts at 100 and one bad game doesn't sink anyone. See sportsmanshipScore.
export const STARTING_POSITIVES = 3;

const WINDOW_MS = FEEDBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const DEFAULT_FEEDBACK_SHOWN = 20;
const IN_QUERY_LIMIT = 30; // Firestore's limit for "in" filters

const eventsCol = collection(db, "events");
const feedbackCol = collection(db, "feedback");
const statsCol = collection(db, "sportsmanship");
const usersCol = collection(db, "users");

/**
 * Thrown by this module. It's an EventError, so friendlyEventError() from
 * events.js turns it into text for the page too.
 */
export class SportsmanshipError extends EventError {
  constructor(code, message) {
    super(code, message);
    this.name = "SportsmanshipError";
  }
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/**
 * A player's public sportsmanship score, from 0 to 100: the share of their
 * ratings that are positive, counting STARTING_POSITIVES extra positive
 * ratings. No ratings = 100, one negative = 75, 20 positive and 2 negative = 92.
 */
export function sportsmanshipScore({ positive = 0, negative = 0 } = {}) {
  return Math.round((100 * (positive + STARTING_POSITIVES)) / (positive + negative + STARTING_POSITIVES));
}

// ---------------------------------------------------------------------------
// Leaving feedback
// ---------------------------------------------------------------------------

/**
 * Rate another player after a game you both played in.
 *
 * @param {string} eventId   the finished game
 * @param {string} toUserId  the player you're rating
 * @param {object} feedback
 * @param {"positive"|"negative"} feedback.rating
 * @param {string} [feedback.comment]  optional, up to MAX_COMMENT characters
 * @returns {Promise<string>} the feedback's id
 */
export async function leaveFeedback(eventId, toUserId, { rating, comment = "" } = {}) {
  const user = requireUser();
  if (!RATINGS.includes(rating)) {
    throw new SportsmanshipError("sportsmanship/invalid-rating", "Choose positive or negative.");
  }
  const text = String(comment ?? "").trim();
  if (text.length > MAX_COMMENT) {
    throw new SportsmanshipError(
      "sportsmanship/invalid-comment",
      `Keep the comment under ${MAX_COMMENT} characters.`,
    );
  }
  if (toUserId === user.uid) {
    throw new SportsmanshipError("sportsmanship/self", "You can't rate yourself.");
  }

  const game = await readGame(eventId);
  const problem = whyCantRate(game, user.uid);
  if (problem) throw new SportsmanshipError(...problem);
  if (!game.participantIds.includes(toUserId)) {
    throw new SportsmanshipError("sportsmanship/not-a-player", "That person wasn't in this game.");
  }

  const id = feedbackId(eventId, user.uid, toUserId);
  const feedbackRef = doc(feedbackCol, id);
  if ((await getDoc(feedbackRef)).exists()) {
    throw new SportsmanshipError(
      "sportsmanship/already-rated",
      "You've already rated this player for this game.",
    );
  }

  // The feedback and the player's totals change together or not at all. The
  // rules check that the totals go up by exactly this one rating.
  const batch = writeBatch(db);
  batch.set(feedbackRef, {
    eventId,
    sportId: game.sportId,
    fromId: user.uid,
    toId: toUserId,
    rating,
    comment: text,
    createdAt: serverTimestamp(),
  });
  batch.set(
    doc(statsCol, toUserId),
    {
      positive: increment(rating === "positive" ? 1 : 0),
      negative: increment(rating === "negative" ? 1 : 0),
      lastFeedbackId: id,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();
  return id;
}

/**
 * For the "rate your teammates" screen after a game: the other players, and
 * whether the signed-in user has rated each one yet.
 *
 * @returns {Promise<{eventId: string, sportId: string, endTime: Date, deadline: Date,
 *   canRate: boolean, whyNot: string|null,
 *   players: {userId: string, displayName: string|null, rated: boolean, rating: string|null}[]}>}
 *   `whyNot` is text to show when `canRate` is false (game not over, too late, ...).
 */
export async function playersToRate(eventId) {
  const user = requireUser();
  const game = await readGame(eventId);
  const problem = whyCantRate(game, user.uid);

  const given = await getDocs(
    query(feedbackCol, where("eventId", "==", eventId), where("fromId", "==", user.uid)),
  );
  const ratingFor = new Map(given.docs.map((d) => [d.data().toId, d.data().rating]));
  const others = game.participantIds.filter((id) => id !== user.uid);
  const names = await displayNames(others);

  return {
    eventId,
    sportId: game.sportId,
    endTime: game.endTime.toDate(),
    deadline: new Date(game.endTime.toMillis() + WINDOW_MS),
    canRate: problem === null,
    whyNot: problem ? problem[1] : null,
    players: others.map((userId) => ({
      userId,
      displayName: names.get(userId) ?? null,
      rated: ratingFor.has(userId),
      rating: ratingFor.get(userId) ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Reading ratings
// ---------------------------------------------------------------------------

/**
 * A player's totals and score: { userId, positive, negative, feedbackCount, score }.
 * A player nobody has rated yet gets zeros and a score of 100.
 */
export async function getSportsmanship(userId) {
  requireUser();
  const snap = await getDoc(doc(statsCol, userId));
  return toStats(userId, snap.exists() ? snap.data() : {});
}

/** getSportsmanship for many players at once. Returns a Map of user ID to totals. */
export async function getSportsmanshipMany(userIds) {
  requireUser();
  const found = await readByIds(statsCol, userIds);
  return new Map([...new Set(userIds)].map((id) => [id, toStats(id, found.get(id) ?? {})]));
}

/**
 * How many games a player has played: finished games they were in that
 * weren't cancelled. Counted by Firestore, so it costs one read.
 */
export async function countGamesPlayed(userId) {
  requireUser();
  const snap = await getCountFromServer(
    query(
      eventsCol,
      where("participantIds", "array-contains", userId),
      where("status", "==", "scheduled"),
      where("endTime", "<", Timestamp.now()),
    ),
  );
  return snap.data().count;
}

/**
 * Everything a profile page shows about a player's record:
 * { userId, positive, negative, feedbackCount, score, gamesPlayed }.
 */
export async function getPlayerStats(userId) {
  const [stats, gamesPlayed] = await Promise.all([getSportsmanship(userId), countGamesPlayed(userId)]);
  return { ...stats, gamesPlayed };
}

/**
 * The feedback a player has received, newest first, for their profile.
 * Each item: { id, eventId, sportId, fromId, fromName, rating, comment, createdAt }.
 */
export async function listFeedbackFor(userId, { max = DEFAULT_FEEDBACK_SHOWN } = {}) {
  requireUser();
  const snap = await getDocs(
    query(feedbackCol, where("toId", "==", userId), orderBy("createdAt", "desc"), limit(max)),
  );
  const items = snap.docs.map((d) => {
    const data = d.data();
    return { id: d.id, ...data, createdAt: data.createdAt?.toDate() ?? null };
  });
  const names = await displayNames(items.map((item) => item.fromId));
  return items.map((item) => ({ ...item, fromName: names.get(item.fromId) ?? null }));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new SportsmanshipError("events/not-signed-in", "Please log in first.");
  return user;
}

// Same format the rules check: one rating per rater, per player, per game.
function feedbackId(eventId, fromId, toId) {
  return `${eventId}_${fromId}_${toId}`;
}

async function readGame(eventId) {
  const snap = await getDoc(doc(eventsCol, eventId));
  if (!snap.exists()) {
    throw new SportsmanshipError("sportsmanship/not-found", "That game doesn't exist anymore.");
  }
  return snap.data();
}

// [code, message] if `uid` can't rate players in `game` right now, else null.
// Mirrors playedTogether() in firestore.rules.
function whyCantRate(game, uid, now = Date.now()) {
  if (game.status === "cancelled") {
    return ["sportsmanship/cancelled", "This game was cancelled, so there's nothing to rate."];
  }
  if (!game.participantIds.includes(uid)) {
    return ["sportsmanship/not-in-game", "Only players in this game can rate each other."];
  }
  if (game.endTime.toMillis() > now) {
    return ["sportsmanship/not-finished", "You can rate players once the game is over."];
  }
  if (now >= game.endTime.toMillis() + WINDOW_MS) {
    return [
      "sportsmanship/too-late",
      `Ratings close ${FEEDBACK_WINDOW_DAYS} days after the game.`,
    ];
  }
  return null;
}

function toStats(userId, data) {
  const positive = data.positive ?? 0;
  const negative = data.negative ?? 0;
  return {
    userId,
    positive,
    negative,
    feedbackCount: positive + negative,
    score: sportsmanshipScore({ positive, negative }),
  };
}

// Read documents by ID, IN_QUERY_LIMIT at a time. Returns a Map of ID to data
// for the ones that exist.
async function readByIds(col, ids) {
  const unique = [...new Set(ids)];
  const found = new Map();
  for (let i = 0; i < unique.length; i += IN_QUERY_LIMIT) {
    const chunk = unique.slice(i, i + IN_QUERY_LIMIT);
    const snap = await getDocs(query(col, where(documentId(), "in", chunk)));
    for (const d of snap.docs) found.set(d.id, d.data());
  }
  return found;
}

// Display names from users/{uid} profiles. Players without a profile are left out.
async function displayNames(userIds) {
  const profiles = await readByIds(usersCol, userIds);
  const names = new Map();
  for (const [id, profile] of profiles) {
    if (typeof profile.displayName === "string") names.set(id, profile.displayName);
  }
  return names;
}
