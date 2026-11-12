// One pass of the notifier: look at Firestore, work out who needs to hear
// about what, and send it. index.js runs this every POLL_SECONDS.
//
// Three kinds of notification (GitHub issue #17):
//   match     a newly posted game fits a player's matchmaking settings
//   reminder  a game a player is in starts within the next hour
//   feedback  a game a player was in just ended: rate the other players
//
// Every notification is saved in `notifications` before it's sent, under an ID
// made from what it's about (for example reminder_<game>_<player>_<start time>).
// Creating a document whose ID already exists fails, so each one goes out once
// even if two notifiers run at the same time or one restarts. The same document
// is the player's in-app inbox (listMyNotifications in notifications.js).
//
// The Admin SDK skips the security rules, so this code must only ever write
// `notifications`, `notifier`, and the push tokens in `notificationSettings`.

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { fitsMatchAlert, sportsmanshipScore } from "./matching.js";
import { buildMessage } from "./messages.js";

export const CHANNELS = ["email", "sms", "desktop"];
export const REMINDER_MINUTES = 60;
// Feedback requests only go out for games that ended in the last day, so a
// notifier that was off for a week doesn't send a pile of old ones.
export const FEEDBACK_LOOKBACK_HOURS = 24;
// Keep in sync with FEEDBACK_WINDOW_DAYS in ../../firebase/sportsmanship.js.
export const FEEDBACK_WINDOW_DAYS = 14;
export const MAX_MATCH_ALERTS_PER_DAY = 3;
// The first time the notifier runs, it looks for games posted this recently.
export const FIRST_RUN_LOOKBACK_MINUTES = 10;
const NEW_GAMES_PER_PASS = 100;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ALREADY_EXISTS = 6; // gRPC status code Firestore uses for create() on an existing ID

/**
 * Run one pass.
 *
 * @param {object} deps
 * @param {import("firebase-admin/firestore").Firestore} deps.db
 * @param {import("firebase-admin/auth").Auth} deps.auth  for players' email addresses
 * @param {{email: object, sms: object, desktop: object}} deps.channels  from buildChannels()
 * @param {{appUrl: string, timeZone: string}} deps.config
 * @param {Date} [deps.now]
 * @param {Function} [deps.log]
 * @returns {Promise<{match: number, reminder: number, feedback: number, errors: string[]}>}
 *   how many of each were sent, and any step that failed
 */
export async function runOnce({ db, auth, channels, config, now = new Date(), log = console.log }) {
  const ctx = {
    db,
    auth,
    channels,
    config,
    now,
    log,
    settings: new Map(),
    emails: new Map(),
    summary: { match: 0, reminder: 0, feedback: 0, errors: [] },
  };
  // One failing step (for example a missing index on the live project)
  // shouldn't stop the others.
  for (const [name, step] of [
    ["match alerts", sendMatchAlerts],
    ["game reminders", sendGameReminders],
    ["feedback requests", sendFeedbackRequests],
  ]) {
    try {
      await step(ctx);
    } catch (err) {
      log(`${name} failed: ${err.message}`);
      ctx.summary.errors.push(`${name}: ${err.message}`);
    }
  }
  return ctx.summary;
}

// ---------------------------------------------------------------------------
// The three kinds
// ---------------------------------------------------------------------------

// New games since the last pass, matched against everyone's match alerts.
async function sendMatchAlerts(ctx) {
  const { db, now } = ctx;
  const stateRef = db.doc("notifier/state");
  const state = (await stateRef.get()).data() ?? {};
  const cursor = state.matchCursor ?? Timestamp.fromMillis(now.getTime() - FIRST_RUN_LOOKBACK_MINUTES * MINUTE);

  const snap = await db
    .collection("events")
    .where("createdAt", ">", cursor)
    .orderBy("createdAt")
    .limit(NEW_GAMES_PER_PASS)
    .get();
  for (const d of snap.docs) {
    await alertMatches(ctx, toGame(d));
    // Move past each game as it's done, so a restart doesn't look at it again.
    await stateRef.set({ matchCursor: d.get("createdAt") }, { merge: true });
  }
}

async function alertMatches(ctx, game) {
  const { db, now } = ctx;
  if (game.status !== "scheduled" || game.startTime <= now) return;
  if (game.participantIds.length >= game.playerLimit) return;

  const following = await db
    .collection("notificationSettings")
    .where("matchAlerts.sportIds", "array-contains", game.sportId)
    .get();
  if (following.empty) return;

  const scores = await sportsmanshipScores(db, game.participantIds);
  const lowestScore = Math.min(...scores);
  const averageScore = Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);

  for (const d of following.docs) {
    const uid = d.id;
    const settings = d.data();
    ctx.settings.set(uid, settings);
    if (!fitsMatchAlert(game, settings.matchAlerts, { uid, now, lowestScore })) continue;
    if ((await matchAlertsInLastDay(ctx, uid)) >= MAX_MATCH_ALERTS_PER_DAY) continue;
    await notify(ctx, { type: "match", uid, game, id: `match_${game.id}_${uid}`, extra: { averageScore } });
  }
}

// Games starting within the next hour.
async function sendGameReminders(ctx) {
  const { db, now } = ctx;
  const snap = await db
    .collection("events")
    .where("status", "==", "scheduled")
    .where("startTime", ">", Timestamp.fromDate(now))
    .where("startTime", "<=", Timestamp.fromMillis(now.getTime() + REMINDER_MINUTES * MINUTE))
    .get();
  for (const d of snap.docs) {
    const game = toGame(d);
    for (const uid of game.participantIds) {
      await notify(ctx, {
        type: "reminder",
        uid,
        game,
        // The start time is in the ID so a game that's moved gets a new reminder.
        id: `reminder_${game.id}_${uid}_${game.startTime.getTime()}`,
        wanted: (s) => s.gameReminders !== false,
      });
    }
  }
}

// Games that just ended, so players can rate each other (sportsmanship.js).
async function sendFeedbackRequests(ctx) {
  const { db, now } = ctx;
  const snap = await db
    .collection("events")
    .where("status", "==", "scheduled")
    .where("endTime", ">", Timestamp.fromMillis(now.getTime() - FEEDBACK_LOOKBACK_HOURS * HOUR))
    .where("endTime", "<=", Timestamp.fromDate(now))
    .get();
  for (const d of snap.docs) {
    const game = toGame(d);
    if (game.participantIds.length < 2) continue; // nobody else to rate
    const deadline = new Date(game.endTime.getTime() + FEEDBACK_WINDOW_DAYS * DAY);
    for (const uid of game.participantIds) {
      await notify(ctx, {
        type: "feedback",
        uid,
        game,
        id: `feedback_${game.id}_${uid}`,
        wanted: (s) => s.feedbackReminders !== false,
        extra: { deadline },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Sending one notification
// ---------------------------------------------------------------------------

// Save the notification and send it on the player's channels, unless they
// turned this kind off or it was already sent. Returns true if it was sent.
async function notify(ctx, { type, uid, game, id, wanted = () => true, extra = {} }) {
  const settings = await settingsFor(ctx, uid);
  if (settings && !wanted(settings)) return false;

  const message = buildMessage(type, game, { appUrl: ctx.config.appUrl, timeZone: ctx.config.timeZone, ...extra });
  const delivery = Object.fromEntries(CHANNELS.map((c) => [c, settings?.channels?.[c] ? "pending" : "off"]));
  const ref = ctx.db.collection("notifications").doc(id);
  try {
    await ref.create({
      uid,
      type,
      eventId: game.id,
      sportId: game.sportId,
      title: message.title,
      body: message.body,
      link: message.link,
      createdAt: Timestamp.fromDate(ctx.now),
      readAt: null,
      delivery,
    });
  } catch (err) {
    if (err.code === ALREADY_EXISTS) return false; // sent on an earlier pass
    throw err;
  }

  for (const channel of CHANNELS) {
    if (delivery[channel] === "pending") delivery[channel] = await deliver(ctx, channel, uid, settings, message);
  }
  await ref.update({ delivery });
  ctx.summary[type] += 1;
  ctx.log(`sent ${id}: ${CHANNELS.map((c) => `${c} ${delivery[c]}`).join(", ")}`);
  return true;
}

// Send on one channel. Returns what happened, which is saved in `delivery`:
// sent, logged (channel not set up), failed, no-address, or no-device.
async function deliver(ctx, channel, uid, settings, message) {
  const sender = ctx.channels[channel];
  try {
    let result;
    if (channel === "email") {
      const to = await emailFor(ctx, uid);
      if (!to) return "no-address";
      result = await sender.send({ to, subject: message.title, text: message.emailText });
    } else if (channel === "sms") {
      result = await sender.send({ to: settings.phone, body: message.sms });
    } else {
      const tokens = settings.desktopTokens ?? [];
      if (tokens.length === 0) return "no-device";
      result = await sender.send({ tokens, title: message.title, body: message.body, link: message.link });
      if (result.deadTokens?.length) await forgetDesktopTokens(ctx, uid, result.deadTokens);
      if (!result.logged && result.sent === 0) return "no-device";
    }
    return result?.logged ? "logged" : "sent";
  } catch (err) {
    ctx.log(`${channel} for ${uid} failed: ${err.message}`);
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// Reading and tidying
// ---------------------------------------------------------------------------

function toGame(d) {
  const data = d.data();
  return {
    id: d.id,
    ...data,
    startTime: data.startTime.toDate(),
    endTime: data.endTime.toDate(),
    participantIds: data.participantIds ?? [],
  };
}

// A player's settings, or null if they never saved any. Read once per pass.
async function settingsFor(ctx, uid) {
  if (!ctx.settings.has(uid)) {
    const snap = await ctx.db.doc(`notificationSettings/${uid}`).get();
    ctx.settings.set(uid, snap.exists ? snap.data() : null);
  }
  return ctx.settings.get(uid);
}

// The email address on the player's Firebase Auth account. Players can't type
// a different address, so nobody can point our emails at someone else.
async function emailFor(ctx, uid) {
  if (!ctx.emails.has(uid)) {
    const email = await ctx.auth.getUser(uid).then(
      (user) => user.email ?? null,
      (err) => {
        if (err.code === "auth/user-not-found") return null;
        throw err;
      },
    );
    ctx.emails.set(uid, email);
  }
  return ctx.emails.get(uid);
}

// Current sportsmanship scores for a list of players (100 for anyone unrated).
async function sportsmanshipScores(db, uids) {
  const snaps = await db.getAll(...uids.map((uid) => db.doc(`sportsmanship/${uid}`)));
  return snaps.map((s) => sportsmanshipScore(s.exists ? s.data() : {}));
}

async function matchAlertsInLastDay(ctx, uid) {
  const snap = await ctx.db
    .collection("notifications")
    .where("uid", "==", uid)
    .where("type", "==", "match")
    .where("createdAt", ">", Timestamp.fromMillis(ctx.now.getTime() - DAY))
    .count()
    .get();
  return snap.data().count;
}

// Remove browsers that will never get a notification again. If none are left,
// turn desktop off too, so the settings still pass the rules' check that
// desktop needs a browser.
async function forgetDesktopTokens(ctx, uid, deadTokens) {
  const ref = ctx.db.doc(`notificationSettings/${uid}`);
  await ctx.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const tokens = (snap.get("desktopTokens") ?? []).filter((t) => !deadTokens.includes(t));
    tx.update(ref, {
      desktopTokens: tokens,
      ...(tokens.length === 0 ? { "channels.desktop": false } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  ctx.settings.delete(uid);
}
