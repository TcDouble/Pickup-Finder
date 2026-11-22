// Who's online now, for Pickup-Finder (GitHub issue #32).
//
// While a player has the home page open and showing, their page checks in
// every minute: presence/{uid} gets state "online" and lastSeen = now. A
// player is online when they checked in within the last few minutes
// (ONLINE_WINDOW_MS in social-helpers.js), so someone whose page closed
// without saying goodbye drops off the list on their own. When the page
// closes or they log out, it says so (state "offline") so they drop off at
// once.
//
// Players can hide themselves: state "hidden" with no lastSeen. They don't
// show up in the list and their friends don't see when they were last on.
//
// Firestore has no "on disconnect" like the Realtime Database, which is why
// this checks in on a timer. The data model is in README.md in this folder,
// and firestore.rules lets players write only their own presence.
//
// Usage on a page:
//   import { startPresence, watchOnlinePlayers } from "../firebase/presence.js";
//   startPresence();                       // once, after the user is known
//   const stop = watchOnlinePlayers((players) => draw(players));

import { db, auth } from "./firebase-config.js";
import { beforeAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { EventError } from "./events.js";
import { getPlayerProfiles } from "./friends.js";
import { HEARTBEAT_MS, ONLINE_WINDOW_MS, chunk, isOnline } from "./social-helpers.js";

export { HEARTBEAT_MS, ONLINE_WINDOW_MS, isOnline };

export const MAX_ONLINE_SHOWN = 100;
const RECHECK_MS = 30 * 1000; // how often the online list drops players who stopped checking in
const RESUBSCRIBE_MS = 10 * 60 * 1000; // how often it asks Firestore again with a new cutoff
const GOODBYE_TIMEOUT_MS = 2000; // logging out waits at most this long to say so

const presenceCol = collection(db, "presence");

/** Thrown by this module; friendlyEventError() in events.js turns it into text. */
export class PresenceError extends EventError {
  constructor(code, message) {
    super(code, message);
    this.name = "PresenceError";
  }
}

// Whether this page is showing the player in the list. False until
// startPresence() or checkIn() runs, and after they hide themselves.
let sharing = false;

// ---------------------------------------------------------------------------
// Your own status
// ---------------------------------------------------------------------------

/** Mark the signed-in player online now. */
export async function checkIn() {
  const user = requireUser();
  sharing = true;
  await setDoc(doc(presenceCol, user.uid), { state: "online", lastSeen: serverTimestamp() });
}

/**
 * Mark the signed-in player offline (for closing the page or logging out).
 * Does nothing when they're hidden, so it never shows when they were last on.
 */
export async function checkOut() {
  const user = requireUser();
  if (!sharing) return;
  await updateDoc(doc(presenceCol, user.uid), { state: "offline", lastSeen: serverTimestamp() });
}

/**
 * Show or hide the signed-in player in the online list. Hidden players keep
 * seeing who else is online. Saved in Firestore, so it applies on every
 * device until they change it.
 */
export async function setShowOnline(show) {
  const user = requireUser();
  if (show) {
    await checkIn();
    if (lifecycle) lifecycle.resume();
    return;
  }
  sharing = false;
  if (lifecycle) lifecycle.pause();
  await setDoc(doc(presenceCol, user.uid), { state: "hidden", lastSeen: null });
}

/** Whether the signed-in player shows in the online list (not hidden). */
export async function getShowOnline() {
  const user = requireUser();
  const snap = await getDoc(doc(presenceCol, user.uid));
  return snap.data()?.state !== "hidden";
}

// ---------------------------------------------------------------------------
// Other players
// ---------------------------------------------------------------------------

/**
 * Presence for a list of players, for showing friends as online or "Active
 * 5m ago". Returns a Map of user ID to { state, lastSeen (Date or null),
 * online }. Players who never opened the app are left out.
 */
export async function getPresence(userIds) {
  requireUser();
  const unique = [...new Set(userIds)].filter(Boolean);
  const now = new Date();
  const found = new Map();
  for (const batch of chunk(unique, 30)) {
    const snap = await getDocs(query(presenceCol, where(documentId(), "in", batch)));
    for (const d of snap.docs) found.set(d.id, toPresence(d.data(), now));
  }
  return found;
}

/**
 * The players online now, live. Calls onChange(players) at once and whenever
 * someone comes online, goes offline, or stops checking in. The signed-in
 * player and players without a profile are left out. Each player:
 * { userId, displayName, photoURL, city, sports, lastSeen }, most recently
 * seen first. Returns an unsubscribe function.
 */
export function watchOnlinePlayers(onChange, onError = console.error) {
  const user = requireUser();
  let docs = new Map(); // user ID -> { state, lastSeen } from the current query
  let unsubscribe = () => {};
  let latest = 0;
  let stopped = false;

  async function report() {
    const id = ++latest;
    const now = new Date();
    const online = [...docs.entries()]
      .filter(([userId, presence]) => userId !== user.uid && isOnline(presence, now))
      .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
      .slice(0, MAX_ONLINE_SHOWN);
    try {
      const profiles = await getPlayerProfiles(online.map(([userId]) => userId));
      if (id !== latest || stopped) return;
      onChange(
        online
          .filter(([userId]) => profiles.has(userId))
          .map(([userId, presence]) => ({ ...profiles.get(userId), lastSeen: presence.lastSeen })),
      );
    } catch (err) {
      if (id === latest && !stopped) onError(err);
    }
  }

  // The query's cutoff is fixed when it starts, so players who stop checking
  // in stay in its results. report() drops them, and every RESUBSCRIBE_MS a
  // new query with a new cutoff keeps the results from growing.
  function subscribe() {
    unsubscribe();
    unsubscribe = onSnapshot(
      onlineQuery(),
      (snap) => {
        docs = new Map(snap.docs.map((d) => [d.id, toPresence(d.data())]));
        report();
      },
      (err) => {
        if (!stopped) onError(err);
      },
    );
  }

  subscribe();
  const recheck = setInterval(report, RECHECK_MS);
  const resubscribe = setInterval(subscribe, RESUBSCRIBE_MS);
  return () => {
    stopped = true;
    clearInterval(recheck);
    clearInterval(resubscribe);
    unsubscribe();
  };
}

// ---------------------------------------------------------------------------
// Checking in from a page
// ---------------------------------------------------------------------------

let lifecycle = null;

/**
 * Keep the signed-in player's presence up to date while this page is open:
 * check in now and every HEARTBEAT_MS while the page is showing, pause while
 * it's in the background, and check out when it closes or they log out.
 * Does nothing if they hid themselves. Call it once per page, after Firebase
 * Auth has loaded the user. Returns a function that stops it.
 */
export async function startPresence() {
  if (lifecycle) return lifecycle.stop;
  if (typeof document === "undefined") return () => {};
  await auth.authStateReady();
  if (!auth.currentUser || lifecycle) return lifecycle?.stop ?? (() => {});

  let timer = null;
  let paused = false;
  const beat = () =>
    checkIn().catch((err) => console.error("Cannot update your online status:", err));
  const startTimer = () => {
    clearInterval(timer);
    timer = setInterval(beat, HEARTBEAT_MS);
  };
  const stopTimer = () => {
    clearInterval(timer);
    timer = null;
  };

  const onVisibility = () => {
    if (paused) return;
    if (document.visibilityState === "visible") {
      beat();
      startTimer();
    } else {
      // No write here: the player drops off after ONLINE_WINDOW_MS unless
      // they come back, which saves a write every time someone switches tabs.
      stopTimer();
    }
  };
  // Best effort: the page may close before the write is sent.
  const onPageHide = () => {
    stopTimer();
    checkOut().catch(() => {});
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  // Say goodbye before logging out, while we're still allowed to write.
  const unhook = beforeAuthStateChanged(auth, async (next) => {
    if (next) return;
    stopTimer();
    paused = true;
    try {
      await withTimeout(checkOut(), GOODBYE_TIMEOUT_MS);
    } catch {
      // Never block logging out.
    }
  });

  lifecycle = {
    pause() {
      paused = true;
      stopTimer();
    },
    resume() {
      paused = false;
      if (document.visibilityState === "visible") startTimer();
    },
    stop() {
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      unhook();
      lifecycle = null;
    },
  };

  let hidden = false;
  try {
    hidden = !(await getShowOnline());
  } catch (err) {
    console.error("Cannot read your online status:", err);
  }
  if (hidden) {
    lifecycle.pause();
  } else if (document.visibilityState === "visible") {
    beat();
    startTimer();
  }
  return lifecycle.stop;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new PresenceError("events/not-signed-in", "Please log in first.");
  return user;
}

// Players who checked in within the window, newest first. Needs the
// presence (state, lastSeen desc) index in firestore.indexes.json.
function onlineQuery() {
  const cutoff = Timestamp.fromMillis(Date.now() - ONLINE_WINDOW_MS);
  return query(
    presenceCol,
    where("state", "==", "online"),
    where("lastSeen", ">", cutoff),
    orderBy("lastSeen", "desc"),
    limit(MAX_ONLINE_SHOWN + 1), // +1 in case the signed-in player is one of them
  );
}

// Firestore data -> { state, lastSeen (Date or null), online }.
function toPresence(data, now = new Date()) {
  const presence = { state: data.state ?? "offline", lastSeen: data.lastSeen?.toDate?.() ?? null };
  return { ...presence, online: isOnline(presence, now) };
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
