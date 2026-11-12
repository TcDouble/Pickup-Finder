// Notification settings and the in-app inbox for Pickup-Finder (GitHub issue #17).
//
// Players choose how they hear from Pickup-Finder (email, text message, or
// desktop notification) and what about:
//   - "match":    a new game fits their matchmaking settings (sport, area,
//                 skill level, and the lowest sportsmanship score they'll play with)
//   - "reminder": a game they're in starts in about an hour
//   - "feedback": a game they played just ended, so they can rate the others
//
// The page only saves settings here. The notifier (../notifier/) is a small
// Node server that watches Firestore and sends the messages, so they arrive
// even when nobody has the site open. Every message it sends is also saved in
// `notifications`, which this module reads for an in-app inbox.
//
// The data model is in README.md in this folder. firestore.rules enforces the
// same limits; the checks here exist so the page can show a clear message
// before Firestore says no.
//
// Usage:
//   import { getNotificationSettings, saveNotificationSettings } from "../firebase/notifications.js";
//
// Like events.js, call these only after Firebase Auth has finished loading the
// user (inside onAuthStateChanged).

import { app, db, auth } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { EventError, SKILL_LEVELS, SPORTS } from "./events.js";

// Keep these in sync with the notificationSettings rules in firestore.rules
// and with ../notifier/src/.
export const CHANNELS = ["email", "sms", "desktop"];
export const NOTIFICATION_TYPES = ["match", "reminder", "feedback"];
export const MATCH_SKILL_LEVELS = ["any", ...SKILL_LEVELS];
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 100;
export const MAX_DESKTOP_DEVICES = 5;

// The public "Web Push certificate" key from the Firebase console (Project
// settings > Cloud Messaging > Web Push certificates). It's public, so it's
// safe to commit. Desktop notifications stay off until someone pastes it here.
export const VAPID_KEY = "";

const DEFAULT_INBOX_SIZE = 20;
const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;

const settingsCol = collection(db, "notificationSettings");
const inboxCol = collection(db, "notifications");

/** Thrown by this module. It's an EventError, so friendlyEventError() from events.js works too. */
export class NotificationError extends EventError {
  constructor(code, message) {
    super(code, message);
    this.name = "NotificationError";
  }
}

/**
 * What a player gets before they change anything: reminders and feedback
 * requests in the in-app inbox only, no match alerts, and nothing by email,
 * text, or desktop until they turn a channel on.
 */
export function defaultNotificationSettings() {
  return {
    channels: { email: false, sms: false, desktop: false },
    phone: "",
    desktopTokens: [],
    gameReminders: true,
    feedbackReminders: true,
    matchAlerts: { sportIds: [], skillLevel: "any", near: null, minScore: 0 },
  };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * The signed-in user's notification settings, or the defaults if they've never
 * saved any. Same shape as defaultNotificationSettings(), plus `updatedAt`
 * (a Date, or null) and `desktopDevices` (how many browsers are set up).
 */
export async function getNotificationSettings() {
  const user = requireUser();
  const snap = await getDoc(doc(settingsCol, user.uid));
  return toSettings(snap.exists() ? snap.data() : null);
}

/**
 * Change some of the signed-in user's settings and keep the rest. Returns the
 * settings as saved.
 *
 * @param {object} changes  any of:
 * @param {{email?: boolean, sms?: boolean, desktop?: boolean}} [changes.channels]
 *        how to send notifications. sms needs a phone number; desktop needs
 *        enableDesktopNotifications() in at least one browser first.
 * @param {string} [changes.phone]  for text messages, e.g. "+1 303 555 0100".
 *        A 10-digit number without a country code is taken as a US number.
 *        "" removes it.
 * @param {boolean} [changes.gameReminders]      a message an hour before your games
 * @param {boolean} [changes.feedbackReminders]  a message after a game to rate the players
 * @param {object} [changes.matchAlerts]  when to tell you about new games. Any of:
 *        sportIds (list of SPORTS; [] turns match alerts off), skillLevel
 *        ("any", "casual", "competitive"), near ({ lat, lng, radiusKm } or null
 *        for anywhere), minScore (0 to 100: skip games where any player's
 *        sportsmanship score is below this).
 */
export async function saveNotificationSettings(changes = {}) {
  const user = requireUser();
  const editable = ["channels", "phone", "gameReminders", "feedbackReminders", "matchAlerts"];
  for (const key of Object.keys(changes)) {
    if (!editable.includes(key)) {
      throw new NotificationError("notifications/not-editable", `"${key}" isn't a notification setting.`);
    }
  }
  const ref = doc(settingsCol, user.uid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = toSettings(snap.exists() ? snap.data() : null);
    const cleaned = cleanSettings({
      ...current,
      ...changes,
      channels: { ...current.channels, ...changes.channels },
      matchAlerts: { ...current.matchAlerts, ...changes.matchAlerts },
    });
    tx.set(ref, { ...cleaned, updatedAt: serverTimestamp() });
    return toSettings(cleaned);
  });
}

// ---------------------------------------------------------------------------
// Desktop notifications
// ---------------------------------------------------------------------------

/**
 * Turn on desktop notifications in this browser. Asks the user for
 * permission, registers firebase-messaging-sw.js, and saves this browser's
 * push token, so the notifier can reach it even when the site is closed.
 * Call it from a click handler (browsers only ask for permission after a click).
 * To stop them, save { channels: { desktop: false } }.
 *
 * @param {object} [options]
 * @param {string} [options.vapidKey]  defaults to VAPID_KEY
 * @param {string|URL} [options.serviceWorkerUrl]  defaults to firebase-messaging-sw.js next to this file
 */
export async function enableDesktopNotifications({ vapidKey = VAPID_KEY, serviceWorkerUrl } = {}) {
  requireUser();
  if (!vapidKey) {
    throw new NotificationError(
      "notifications/not-set-up",
      "Desktop notifications aren't set up yet. Please tell the team.",
    );
  }
  if (!("Notification" in globalThis) || !globalThis.navigator?.serviceWorker) {
    throw new NotificationError("notifications/unsupported", "This browser can't show desktop notifications.");
  }
  const { getMessaging, getToken, isSupported } = await import(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js"
  );
  if (!(await isSupported())) {
    throw new NotificationError("notifications/unsupported", "This browser can't show desktop notifications.");
  }
  if ((await Notification.requestPermission()) !== "granted") {
    throw new NotificationError(
      "notifications/permission-denied",
      "Your browser is blocking notifications from this site. Allow them in the browser's site settings, then try again.",
    );
  }
  // The service worker can't import firebase-config.js, so it gets the
  // project's public settings in its URL.
  const { apiKey, projectId, messagingSenderId, appId } = app.options;
  const swUrl = new URL(serviceWorkerUrl ?? new URL("./firebase-messaging-sw.js", import.meta.url));
  swUrl.search = new URLSearchParams({ apiKey, projectId, messagingSenderId, appId }).toString();
  const registration = await navigator.serviceWorker.register(swUrl.href);
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
  return saveDesktopToken(token);
}

/**
 * Save a browser's push token and turn desktop notifications on. Keeps the
 * MAX_DESKTOP_DEVICES most recent browsers. enableDesktopNotifications() calls
 * this for you. Returns the settings as saved.
 */
export async function saveDesktopToken(token) {
  const user = requireUser();
  if (typeof token !== "string" || token.length === 0) {
    throw new NotificationError("notifications/invalid-token", "That browser couldn't be set up for notifications.");
  }
  const ref = doc(settingsCol, user.uid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = toSettings(snap.exists() ? snap.data() : null);
    const tokens = [...current.desktopTokens.filter((t) => t !== token), token].slice(-MAX_DESKTOP_DEVICES);
    const cleaned = cleanSettings({
      ...current,
      desktopTokens: tokens,
      channels: { ...current.channels, desktop: true },
    });
    tx.set(ref, { ...cleaned, updatedAt: serverTimestamp() });
    return toSettings(cleaned);
  });
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

/**
 * Notifications the notifier has sent the signed-in user, newest first.
 * Each item: { id, type, eventId, sportId, title, body, link, createdAt, read }.
 *
 * @param {object} [options]
 * @param {number} [options.max]  at most this many (default 20)
 * @param {boolean} [options.unreadOnly]  only ones not marked read
 */
export async function listMyNotifications({ max = DEFAULT_INBOX_SIZE, unreadOnly = false } = {}) {
  const snap = await getDocs(inboxQuery(requireUser().uid, max));
  return toInbox(snap.docs, unreadOnly);
}

/** Live version of listMyNotifications, e.g. for a badge. Returns an unsubscribe function. */
export function watchMyNotifications(onChange, { max = DEFAULT_INBOX_SIZE, unreadOnly = false } = {}, onError = console.error) {
  const q = inboxQuery(requireUser().uid, max);
  return onSnapshot(q, (snap) => onChange(toInbox(snap.docs, unreadOnly)), onError);
}

/** Mark one of the signed-in user's notifications as read. Doing it twice is fine. */
export async function markNotificationRead(notificationId) {
  const user = requireUser();
  const ref = doc(inboxCol, notificationId);
  const snap = await getDoc(ref).catch((err) => {
    // Reading someone else's notification is denied, same as one that doesn't exist.
    if (err?.code === "permission-denied") return null;
    throw err;
  });
  if (!snap?.exists() || snap.data().uid !== user.uid) {
    throw new NotificationError("notifications/not-found", "That notification doesn't exist anymore.");
  }
  if (snap.data().readAt) return;
  await updateDoc(ref, { readAt: serverTimestamp() });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new NotificationError("events/not-signed-in", "Please log in first.");
  return user;
}

function inboxQuery(uid, max) {
  return query(inboxCol, where("uid", "==", uid), orderBy("createdAt", "desc"), limit(max));
}

function toInbox(docs, unreadOnly) {
  const items = docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      type: data.type,
      eventId: data.eventId,
      sportId: data.sportId,
      title: data.title,
      body: data.body,
      link: data.link,
      createdAt: data.createdAt?.toDate() ?? null,
      read: Boolean(data.readAt),
    };
  });
  return unreadOnly ? items.filter((item) => !item.read) : items;
}

// Stored data (or null) -> settings with every field filled in.
function toSettings(data) {
  const defaults = defaultNotificationSettings();
  const settings = {
    ...defaults,
    ...data,
    channels: { ...defaults.channels, ...data?.channels },
    matchAlerts: { ...defaults.matchAlerts, ...data?.matchAlerts },
  };
  settings.updatedAt = typeof data?.updatedAt?.toDate === "function" ? data.updatedAt.toDate() : null;
  settings.desktopDevices = settings.desktopTokens.length;
  return settings;
}

// "+1 (303) 555-0100", "303-555-0100", "13035550100" -> "+13035550100".
function cleanPhone(value) {
  const raw = String(value ?? "").replace(/[\s().-]/g, "");
  if (raw === "") return "";
  if (/^[0-9]{10}$/.test(raw)) return `+1${raw}`;
  if (/^1[0-9]{10}$/.test(raw)) return `+${raw}`;
  return raw;
}

const isNumberIn = (n, low, high) => typeof n === "number" && Number.isFinite(n) && n >= low && n <= high;

// Check and tidy settings before saving. Mirrors validSettings() in firestore.rules.
function cleanSettings(s) {
  const channels = {};
  for (const name of CHANNELS) {
    if (typeof s.channels[name] !== "boolean") {
      throw new NotificationError("notifications/invalid-channel", `Turn ${name} notifications on or off.`);
    }
    channels[name] = s.channels[name];
  }
  for (const key of ["gameReminders", "feedbackReminders"]) {
    if (typeof s[key] !== "boolean") {
      throw new NotificationError("notifications/invalid-setting", `${key} has to be on or off.`);
    }
  }

  const phone = cleanPhone(s.phone);
  if (phone !== "" && !PHONE_PATTERN.test(phone)) {
    throw new NotificationError(
      "notifications/invalid-phone",
      "Enter a phone number with its country code, like +1 303 555 0100.",
    );
  }
  if (channels.sms && phone === "") {
    throw new NotificationError("notifications/no-phone", "Add a phone number to get text messages.");
  }
  if (channels.desktop && s.desktopTokens.length === 0) {
    throw new NotificationError(
      "notifications/no-desktop-device",
      "Turn on desktop notifications in this browser first.",
    );
  }

  const alerts = s.matchAlerts;
  if (!Array.isArray(alerts.sportIds) || !alerts.sportIds.every((id) => SPORTS.includes(id))) {
    throw new NotificationError("notifications/invalid-sport", "Pick sports from the list.");
  }
  if (!MATCH_SKILL_LEVELS.includes(alerts.skillLevel)) {
    throw new NotificationError("notifications/invalid-skill", "Skill level must be any, casual, or competitive.");
  }
  let near = null;
  if (alerts.near != null) {
    const { lat, lng, radiusKm } = alerts.near;
    if (!isNumberIn(lat, -90, 90) || !isNumberIn(lng, -180, 180)) {
      throw new NotificationError("notifications/invalid-area", "Pick a spot on the map for match alerts.");
    }
    if (!isNumberIn(radiusKm, MIN_RADIUS_KM, MAX_RADIUS_KM)) {
      throw new NotificationError(
        "notifications/invalid-area",
        `The distance has to be from ${MIN_RADIUS_KM} to ${MAX_RADIUS_KM} km.`,
      );
    }
    near = { lat, lng, radiusKm };
  }
  if (!isNumberIn(alerts.minScore, 0, 100)) {
    throw new NotificationError("notifications/invalid-min-score", "The minimum score has to be from 0 to 100.");
  }

  return {
    channels,
    phone,
    desktopTokens: [...s.desktopTokens],
    gameReminders: s.gameReminders,
    feedbackReminders: s.feedbackReminders,
    matchAlerts: {
      sportIds: [...new Set(alerts.sportIds)],
      skillLevel: alerts.skillLevel,
      near,
      minScore: alerts.minScore,
    },
  };
}
