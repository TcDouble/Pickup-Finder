// Friends list for Pickup-Finder (GitHub issue #33).
//
// Players send each other friend requests, accept or decline them, and can
// unfriend later. Friends see which of them are online (presence.js) and
// which upcoming games their friends are going to.
//
// One friendships/{pairId} document per pair of players, whoever asked
// first. The ID is the two user IDs, sorted and joined with "_" (pairId in
// social-helpers.js), so two people can never have two documents. The data
// model is in README.md in this folder, and firestore.rules checks
// everything these functions check, so the page can show a clear message
// before Firestore says no.
//
// Usage:
//   import { sendFriendRequest, watchFriends } from "../firebase/friends.js";
//
// Like events.js, call these only after Firebase Auth has finished loading
// the user (inside onAuthStateChanged).

import { db, auth } from "./firebase-config.js";
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { EventError, toEvent } from "./events.js";
import { chunk, pairId, searchPrefixes, splitFriendships } from "./social-helpers.js";

export const MAX_SEARCH_RESULTS = 10;
export const MAX_NAME_SEARCH = 30; // display names are at most 30 characters
const DEFAULT_MAX_GAMES = 20;
const PROFILE_CACHE_MS = 5 * 60 * 1000;

const friendshipsCol = collection(db, "friendships");
const usersCol = collection(db, "users");
const eventsCol = collection(db, "events");

/**
 * Thrown by this module. It's an EventError, so friendlyEventError() from
 * events.js turns it into text for the page too.
 */
export class FriendError extends EventError {
  constructor(code, message) {
    super(code, message);
    this.name = "FriendError";
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * Ask another player to be friends. If they already asked you, this accepts
 * their request instead. Asking again, or asking a friend, is fine.
 *
 * @param {string} userId  the other player
 * @returns {Promise<"outgoing"|"friend">} the relation afterwards: request
 *   sent, or friends
 */
export async function sendFriendRequest(userId) {
  const user = requireUser();
  checkOtherPlayer(user, userId);
  const ref = doc(friendshipsCol, pairId(user.uid, userId));

  return runFriendTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      const data = snap.data();
      if (data.status === "accepted") return "friend";
      if (data.requesterId === user.uid) return "outgoing";
      // They asked first, so say yes to their request.
      tx.update(ref, { status: "accepted", acceptedAt: serverTimestamp() });
      return "friend";
    }

    const profile = await tx.get(doc(usersCol, userId));
    if (!profile.exists()) {
      throw new FriendError("friends/not-found", "That player doesn't have an account anymore.");
    }
    tx.set(ref, {
      userIds: user.uid < userId ? [user.uid, userId] : [userId, user.uid],
      requesterId: user.uid,
      addresseeId: userId,
      status: "pending",
      createdAt: serverTimestamp(),
    });
    return "outgoing";
  }).catch((err) => {
    // Still refused after the retries: they turned friend requests off in Settings.
    if (err?.code === "permission-denied") {
      throw new FriendError("friends/not-accepting", "This player isn't accepting friend requests.");
    }
    throw err;
  });
}

/**
 * Accept a friend request another player sent you. Accepting twice is fine.
 * @returns {Promise<"friend">}
 */
export async function acceptFriendRequest(userId) {
  const user = requireUser();
  checkOtherPlayer(user, userId);
  const ref = doc(friendshipsCol, pairId(user.uid, userId));

  return runFriendTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new FriendError("friends/no-request", "That friend request isn't there anymore.");
    }
    const data = snap.data();
    if (data.status === "accepted") return "friend";
    if (data.addresseeId !== user.uid) {
      throw new FriendError("friends/not-yours", "Only the player you asked can accept your request.");
    }
    tx.update(ref, { status: "accepted", acceptedAt: serverTimestamp() });
    return "friend";
  });
}

/**
 * End things with another player: decline their request, cancel yours, or
 * unfriend them. Doing it when there's nothing to remove is fine.
 */
export async function removeFriend(userId) {
  const user = requireUser();
  checkOtherPlayer(user, userId);
  await deleteDoc(doc(friendshipsCol, pairId(user.uid, userId)));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The signed-in player's friends and requests, once:
 * { friends, incoming, outgoing }. Each item is { userId, relation,
 * createdAt, acceptedAt, displayName, photoURL, city, sports, hasProfile }.
 * Friends are sorted by name, requests newest first.
 */
export async function listFriends() {
  const user = requireUser();
  const snap = await getDocs(myFriendshipsQuery(user.uid));
  return describe(snap.docs.map((d) => d.data()), user.uid);
}

/**
 * Live version of listFriends: calls onChange({ friends, incoming, outgoing })
 * now and whenever a request arrives, is accepted, or is removed.
 * Returns an unsubscribe function.
 */
export function watchFriends(onChange, onError = console.error) {
  const user = requireUser();
  let latest = 0;
  return onSnapshot(
    myFriendshipsQuery(user.uid),
    async (snap) => {
      // Reading names takes a moment; only the newest snapshot may report.
      const id = ++latest;
      try {
        const result = await describe(snap.docs.map((d) => d.data()), user.uid);
        if (id === latest) onChange(result);
      } catch (err) {
        if (id === latest) onError(err);
      }
    },
    onError,
  );
}

/**
 * Find players by the start of their display name, to send them a request.
 * Not case sensitive for the first letter ("riley" finds "Riley"), but
 * Firestore can only match the start of a name. Leaves out the signed-in
 * player. Each item: { userId, displayName, photoURL, city, sports }.
 */
export async function findPlayers(text, { max = MAX_SEARCH_RESULTS } = {}) {
  const user = requireUser();
  const prefixes = searchPrefixes(String(text ?? "").slice(0, MAX_NAME_SEARCH));
  if (prefixes.length === 0) return [];

  const snaps = await Promise.all(
    prefixes.map((prefix) =>
      getDocs(
        query(
          usersCol,
          where("displayName", ">=", prefix),
          where("displayName", "<=", `${prefix}`),
          orderBy("displayName"),
          limit(max),
        ),
      ),
    ),
  );
  const found = new Map();
  for (const snap of snaps) {
    for (const d of snap.docs) {
      if (d.id === user.uid) continue;
      const profile = toProfile(d.id, d.data());
      found.set(d.id, profile);
      remember(profile);
    }
  }
  return sortByName([...found.values()]).slice(0, max);
}

/**
 * Upcoming games (not cancelled) that any of the given players are going to,
 * soonest first, for "Your friends' games". Each game is shaped like
 * events.js returns them, plus `friendIds`: which of the given players are
 * going.
 */
export async function listFriendsGames(friendIds, { max = DEFAULT_MAX_GAMES } = {}) {
  requireUser();
  const ids = [...new Set(friendIds)];
  if (ids.length === 0) return [];
  const wanted = new Set(ids);
  const now = Timestamp.now();

  // array-contains-any takes up to 30 values, so ask in batches.
  const snaps = await Promise.all(
    chunk(ids, 30).map((batch) =>
      getDocs(
        query(
          eventsCol,
          where("participantIds", "array-contains-any", batch),
          where("startTime", ">=", now),
          orderBy("startTime"),
          limit(max),
        ),
      ),
    ),
  );
  const games = new Map();
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const data = d.data();
      if (data.status !== "scheduled") continue;
      games.set(d.id, {
        ...toEvent(d.id, data),
        friendIds: (data.participantIds ?? []).filter((id) => wanted.has(id)),
      });
    }
  }
  return [...games.values()].sort((a, b) => a.startTime - b.startTime).slice(0, max);
}

/**
 * Profiles for a list of players, read 30 at a time and kept for a few
 * minutes, so live lists don't read them again on every change. Returns a
 * Map of user ID to { userId, displayName, photoURL, city, sports }; players
 * without a profile are left out. presence.js uses this too.
 */
export async function getPlayerProfiles(userIds) {
  const now = Date.now();
  const unique = [...new Set(userIds)].filter(Boolean);
  const missing = unique.filter((id) => !(profileCache.get(id)?.until > now));
  for (const batch of chunk(missing, 30)) {
    const snap = await getDocs(query(usersCol, where(documentId(), "in", batch)));
    const found = new Set();
    for (const d of snap.docs) {
      remember(toProfile(d.id, d.data()));
      found.add(d.id);
    }
    for (const id of batch) {
      if (!found.has(id)) profileCache.set(id, { profile: null, until: now + PROFILE_CACHE_MS });
    }
  }
  const profiles = new Map();
  for (const id of unique) {
    const profile = profileCache.get(id)?.profile;
    if (profile) profiles.set(id, profile);
  }
  return profiles;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const profileCache = new Map(); // user ID -> { profile or null, until }

function remember(profile) {
  profileCache.set(profile.userId, { profile, until: Date.now() + PROFILE_CACHE_MS });
}

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new FriendError("events/not-signed-in", "Please log in first.");
  return user;
}

function checkOtherPlayer(user, userId) {
  if (typeof userId !== "string" || userId === "" || userId.includes("_") || userId.includes("/")) {
    throw new FriendError("friends/not-found", "That player doesn't have an account anymore.");
  }
  if (userId === user.uid) {
    throw new FriendError("friends/self", "That's you! Pick another player.");
  }
}

// Every friendships document the player is in. The rules only allow lists
// that filter on your own ID like this.
function myFriendshipsQuery(uid) {
  return query(friendshipsCol, where("userIds", "array-contains", uid));
}

// Friendships documents -> { friends, incoming, outgoing } with names.
async function describe(docs, uid) {
  const others = docs.map((data) => (data.userIds ?? []).find((id) => id !== uid)).filter(Boolean);
  const profiles = await getPlayerProfiles(others);
  const nameOf = (id) => profiles.get(id)?.displayName ?? "";
  const { friends, incoming, outgoing } = splitFriendships(docs, uid, nameOf);
  const withProfile = (view) => {
    const profile = profiles.get(view.userId);
    return {
      ...view,
      displayName: profile?.displayName ?? null,
      photoURL: profile?.photoURL ?? null,
      city: profile?.city ?? "",
      sports: profile?.sports ?? [],
      hasProfile: Boolean(profile),
    };
  };
  return {
    friends: friends.map(withProfile),
    incoming: incoming.map(withProfile),
    outgoing: outgoing.map(withProfile),
  };
}

function toProfile(userId, data) {
  return {
    userId,
    displayName: typeof data.displayName === "string" ? data.displayName : null,
    photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
    city: typeof data.city === "string" ? data.city : "",
    sports: Array.isArray(data.sports) ? data.sports : [],
  };
}

function sortByName(players) {
  return players.sort((a, b) =>
    String(a.displayName ?? "").localeCompare(String(b.displayName ?? ""), "en", { sensitivity: "base" }),
  );
}

// Like runGameTransaction in events.js. When two players ask each other at
// the same moment, both read "no document yet" and both try to create it.
// The rules see the second create as a change to the first player's request
// and refuse it ("permission-denied"), which Firestore doesn't retry. Running
// the transaction again reads the request that's there now and accepts it.
const FRIEND_TRANSACTION_TRIES = 3;

async function runFriendTransaction(updateFunction) {
  for (let tries = 1; ; tries++) {
    try {
      return await runTransaction(db, updateFunction);
    } catch (err) {
      if (err?.code !== "permission-denied" || tries >= FRIEND_TRANSACTION_TRIES) throw err;
    }
  }
}
