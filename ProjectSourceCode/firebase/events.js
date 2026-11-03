// Events back end for Pickup-Finder.
//
// Everything the front end needs for pickup games: creating them, RSVPs, and
// finding games by sport, time, and location. The data model and examples are
// in README.md in this folder.
//
// The security rules in firestore.rules enforce the same limits (player limit,
// only the host edits, you can only RSVP yourself). The checks here exist so
// the page can show a clear message before Firestore says no.
//
// Usage:
//   import { createEvent, rsvpToEvent, listEvents } from "../firebase/events.js";
//
// Call these only after Firebase Auth has finished loading the user (inside
// onAuthStateChanged), or functions that need a user throw "events/not-signed-in".

import { db, auth } from "./firebase-config.js";
import {
  arrayRemove,
  arrayUnion,
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
  setDoc,
  Timestamp,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Keep these in sync with firestore.rules. SPORTS matches the checkboxes on
// the registration page.
export const SPORTS = ["basketball", "soccer", "volleyball", "tennis", "pickleball", "football"];
export const SKILL_LEVELS = ["casual", "competitive"];
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 50;
export const MAX_HOURS = 12;

const MAX_TITLE = 60;
const MAX_NAME = 60;
const MAX_DESCRIPTION = 500;
const MAX_PLACE_NAME = 100;
const MAX_ADDRESS = 200;
const DEFAULT_MAX_RESULTS = 50;

const eventsCol = collection(db, "events");

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown by this module. `code` is for your logic, `message` is safe to show. */
export class EventError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EventError";
    this.code = code;
  }
}

/** Turn any error from this module (or from Firestore) into text for the page. */
export function friendlyEventError(err) {
  if (err instanceof EventError) return err.message;
  switch (err?.code) {
    case "permission-denied":
      return "You don't have permission to do that. Make sure you're logged in.";
    case "unavailable":
    case "deadline-exceeded":
      return "Network error. Check your connection and try again.";
    case "failed-precondition":
      // Usually a missing index: the console error has a link to create it.
      return "This search isn't set up yet. Please tell the team.";
    default:
      return "Something went wrong. Please try again.";
  }
}

// ---------------------------------------------------------------------------
// Creating and editing events
// ---------------------------------------------------------------------------

/**
 * Create a game hosted by the signed-in user, who also counts as its first player.
 *
 * @param {object} input
 * @param {string} input.sportId       one of SPORTS
 * @param {Date|string} input.startTime  a Date, or a datetime-local value like "2026-11-05T18:00"
 * @param {Date|string} input.endTime
 * @param {{name: string, address?: string, lat: number, lng: number}} input.location
 * @param {number} input.playerLimit   total players including the host
 * @param {string} [input.title]       e.g. "5v5"
 * @param {string} [input.description]
 * @param {string} [input.skillLevel]  "casual" (default) or "competitive"
 * @returns {Promise<string>} the new event's id
 */
export async function createEvent(input) {
  const user = requireUser();
  const fields = cleanEventFields(input);
  const ref = doc(eventsCol);
  await setDoc(ref, {
    ...fields,
    hostId: user.uid,
    hostName: (user.displayName || "").slice(0, MAX_NAME),
    participantIds: [user.uid],
    status: "scheduled",
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Host only: change a game's details. Pass only the fields you want to change:
 * title, description, skillLevel, startTime, endTime, location, playerLimit.
 * The sport, the host, and the player list can't be changed here.
 */
export async function updateEvent(eventId, changes) {
  const user = requireUser();
  const editable = ["title", "description", "skillLevel", "startTime", "endTime", "location", "playerLimit"];
  for (const key of Object.keys(changes)) {
    if (!editable.includes(key)) {
      throw new EventError("events/not-editable", `The ${key} of a game can't be changed.`);
    }
  }
  const ref = doc(eventsCol, eventId);
  await runTransaction(db, async (tx) => {
    const current = await readOpenEvent(tx, ref);
    if (current.hostId !== user.uid) throw notHost();

    const merged = cleanEventFields({
      ...current,
      startTime: current.startTime.toDate(),
      endTime: current.endTime.toDate(),
      ...changes,
    });
    if (merged.playerLimit < current.participantIds.length) {
      throw new EventError(
        "events/limit-below-players",
        `${current.participantIds.length} players are already going, so the limit can't be lower than that.`,
      );
    }
    const update = {};
    for (const key of editable) update[key] = merged[key];
    tx.update(ref, update);
  });
}

/** Host only: cancel a game. Players still see it, marked cancelled. */
export async function cancelEvent(eventId) {
  const user = requireUser();
  const ref = doc(eventsCol, eventId);
  await runTransaction(db, async (tx) => {
    const current = await readOpenEvent(tx, ref);
    if (current.hostId !== user.uid) throw notHost();
    tx.update(ref, { status: "cancelled" });
  });
}

// ---------------------------------------------------------------------------
// RSVPs
// ---------------------------------------------------------------------------

/**
 * RSVP the signed-in user to a game. Throws "events/full" if there's no room,
 * even if several people try for the last spot at the same time. Doing it twice
 * is fine. Returns the event as it is after the RSVP.
 */
export async function rsvpToEvent(eventId) {
  const user = requireUser();
  const ref = doc(eventsCol, eventId);
  return runTransaction(db, async (tx) => {
    const current = await readOpenEvent(tx, ref);
    if (current.participantIds.includes(user.uid)) return toEvent(eventId, current);
    if (current.participantIds.length >= current.playerLimit) {
      throw new EventError("events/full", "Sorry, this game is full.");
    }
    tx.update(ref, { participantIds: arrayUnion(user.uid) });
    return toEvent(eventId, { ...current, participantIds: [...current.participantIds, user.uid] });
  });
}

/**
 * Take back the signed-in user's RSVP. The host can't leave their own game
 * (they cancel it instead). Doing it when you aren't going is fine.
 * Returns the event as it is after leaving.
 */
export async function cancelRsvp(eventId) {
  const user = requireUser();
  const ref = doc(eventsCol, eventId);
  return runTransaction(db, async (tx) => {
    const current = await readOpenEvent(tx, ref);
    if (!current.participantIds.includes(user.uid)) return toEvent(eventId, current);
    if (current.hostId === user.uid) {
      throw new EventError(
        "events/host-cannot-leave",
        "You're hosting this game. Cancel the game instead of leaving it.",
      );
    }
    tx.update(ref, { participantIds: arrayRemove(user.uid) });
    return toEvent(eventId, {
      ...current,
      participantIds: current.participantIds.filter((id) => id !== user.uid),
    });
  });
}

// ---------------------------------------------------------------------------
// Reading events
// ---------------------------------------------------------------------------

/** One game by id, or null if it doesn't exist. */
export async function getEvent(eventId) {
  const snap = await getDoc(doc(eventsCol, eventId));
  return snap.exists() ? toEvent(snap.id, snap.data()) : null;
}

/** Live version of getEvent. Calls onChange(event or null) on every change. Returns an unsubscribe function. */
export function watchEvent(eventId, onChange, onError = console.error) {
  return onSnapshot(
    doc(eventsCol, eventId),
    (snap) => onChange(snap.exists() ? toEvent(snap.id, snap.data()) : null),
    onError,
  );
}

/**
 * Find upcoming, scheduled games. Every filter is optional.
 *
 * @param {object} [filters]
 * @param {string|string[]} [filters.sportId]  one sport, or a list of up to 30
 * @param {Date} [filters.from]   earliest start time (default: now)
 * @param {Date} [filters.to]     start time before this
 * @param {{south: number, west: number, north: number, east: number}} [filters.bounds]
 *        a map rectangle, e.g. from the map's current view
 * @param {{lat: number, lng: number, radiusKm: number}} [filters.near]
 *        games within radiusKm of a point; each result gets distanceKm
 * @param {string} [filters.skillLevel]  "casual" or "competitive"
 * @param {boolean} [filters.openOnly]   only games that still have room
 * @param {number} [filters.max]   at most this many games (default 50)
 * @returns {Promise<object[]>} games sorted by start time
 */
export async function listEvents(filters = {}) {
  const { q, refine } = buildEventsQuery(filters);
  const snap = await getDocs(q);
  return refine(snap.docs.map((d) => toEvent(d.id, d.data())));
}

/** Live version of listEvents. Calls onChange(events) on every change. Returns an unsubscribe function. */
export function watchEvents(filters, onChange, onError = console.error) {
  const { q, refine } = buildEventsQuery(filters);
  return onSnapshot(q, (snap) => onChange(refine(snap.docs.map((d) => toEvent(d.id, d.data())))), onError);
}

/**
 * The signed-in user's games, for the "My games" page. Includes cancelled games.
 *
 * @param {object} [options]
 * @param {"joined"|"hosting"} [options.role]  joined (default) includes games you host
 * @param {"upcoming"|"past"} [options.when]   upcoming (default) soonest first; past most recent first
 * @param {number} [options.max]
 */
export async function listMyEvents({ role = "joined", when = "upcoming", max = DEFAULT_MAX_RESULTS } = {}) {
  const user = requireUser();
  const now = Timestamp.now();
  const who =
    role === "hosting"
      ? where("hostId", "==", user.uid)
      : where("participantIds", "array-contains", user.uid);
  const timing =
    when === "past"
      ? [where("startTime", "<", now), orderBy("startTime", "desc")]
      : [where("startTime", ">=", now), orderBy("startTime", "asc")];
  const snap = await getDocs(query(eventsCol, who, ...timing, limit(max)));
  return snap.docs.map((d) => toEvent(d.id, d.data()));
}

// ---------------------------------------------------------------------------
// Helpers for filters
// ---------------------------------------------------------------------------

/**
 * Start/end times for the time filter buttons: "today", "tonight" (5 PM to
 * midnight), "weekend" (Saturday and Sunday), or "week" (the next 7 days).
 * Pass the result's from/to to listEvents.
 */
export function timeRange(preset, now = new Date()) {
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const today = startOfDay(now);
  switch (preset) {
    case "today":
      return { from: now, to: addDays(today, 1) };
    case "tonight": {
      const evening = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 17);
      return { from: now > evening ? now : evening, to: addDays(today, 1) };
    }
    case "weekend": {
      const day = now.getDay(); // 0 = Sunday, 6 = Saturday
      if (day === 6 || day === 0) return { from: now, to: addDays(today, day === 6 ? 2 : 1) };
      const saturday = addDays(today, 6 - day);
      return { from: saturday, to: addDays(saturday, 2) };
    }
    case "week":
      return { from: now, to: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) };
    default:
      throw new EventError("events/invalid-time", `Unknown time filter "${preset}".`);
  }
}

/** Straight-line distance in km between two {lat, lng} points. */
export function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new EventError("events/not-signed-in", "Please log in first.");
  return user;
}

function notHost() {
  return new EventError("events/not-host", "Only the host can change this game.");
}

// Read an event inside a transaction and make sure it can still be changed.
async function readOpenEvent(tx, ref) {
  const snap = await tx.get(ref);
  if (!snap.exists()) throw new EventError("events/not-found", "That game doesn't exist anymore.");
  const data = snap.data();
  if (data.status === "cancelled") throw new EventError("events/cancelled", "This game was cancelled.");
  if (data.startTime.toMillis() <= Date.now()) {
    throw new EventError("events/started", "This game has already started.");
  }
  return data;
}

// Firestore data -> the plain object the front end gets.
function toEvent(id, data) {
  const uid = auth.currentUser?.uid;
  const ids = data.participantIds ?? [];
  return {
    id,
    ...data,
    startTime: data.startTime?.toDate() ?? null,
    endTime: data.endTime?.toDate() ?? null,
    createdAt: data.createdAt?.toDate() ?? null, // null for a moment right after creating
    playerCount: ids.length,
    spotsLeft: Math.max(0, data.playerLimit - ids.length),
    isFull: ids.length >= data.playerLimit,
    isGoing: uid ? ids.includes(uid) : false,
    isHost: uid ? data.hostId === uid : false,
  };
}

function toDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (value == null || Number.isNaN(date.getTime())) {
    throw new EventError("events/invalid-time", `Please enter a valid ${label}.`);
  }
  return date;
}

// Check and tidy the fields a host fills in. Mirrors validEvent() in firestore.rules.
function cleanEventFields(input) {
  const {
    sportId,
    title = "",
    description = "",
    skillLevel = "casual",
    startTime,
    endTime,
    location,
    playerLimit,
  } = input ?? {};

  if (!SPORTS.includes(sportId)) {
    throw new EventError("events/invalid-sport", "Please pick a sport.");
  }
  if (!SKILL_LEVELS.includes(skillLevel)) {
    throw new EventError("events/invalid-details", "Skill level must be casual or competitive.");
  }
  const cleanTitle = String(title).trim();
  const cleanDescription = String(description).trim();
  if (cleanTitle.length > MAX_TITLE) {
    throw new EventError("events/invalid-details", `Keep the title under ${MAX_TITLE} characters.`);
  }
  if (cleanDescription.length > MAX_DESCRIPTION) {
    throw new EventError("events/invalid-details", `Keep the description under ${MAX_DESCRIPTION} characters.`);
  }

  const start = toDate(startTime, "start time");
  const end = toDate(endTime, "end time");
  if (start.getTime() <= Date.now()) {
    throw new EventError("events/invalid-time", "The start time has to be in the future.");
  }
  if (end <= start) {
    throw new EventError("events/invalid-time", "The end time has to be after the start time.");
  }
  if (end.getTime() - start.getTime() > MAX_HOURS * 60 * 60 * 1000) {
    throw new EventError("events/invalid-time", `A game can last at most ${MAX_HOURS} hours.`);
  }

  const limitNumber = Number(playerLimit);
  if (!Number.isInteger(limitNumber) || limitNumber < MIN_PLAYERS || limitNumber > MAX_PLAYERS) {
    throw new EventError(
      "events/invalid-player-limit",
      `The player limit has to be a whole number from ${MIN_PLAYERS} to ${MAX_PLAYERS}.`,
    );
  }

  const name = String(location?.name ?? "").trim();
  const address = String(location?.address ?? "").trim();
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!name || name.length > MAX_PLACE_NAME) {
    throw new EventError("events/invalid-location", "Please name the place (park, court, or field).");
  }
  if (address.length > MAX_ADDRESS) {
    throw new EventError("events/invalid-location", `Keep the address under ${MAX_ADDRESS} characters.`);
  }
  if (
    location?.lat == null || location?.lng == null ||
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    Math.abs(lat) > 90 || Math.abs(lng) > 180
  ) {
    throw new EventError("events/invalid-location", "Please pick the spot on the map.");
  }

  return {
    sportId,
    title: cleanTitle,
    description: cleanDescription,
    skillLevel,
    startTime: Timestamp.fromDate(start),
    endTime: Timestamp.fromDate(end),
    location: { name, address, lat, lng },
    playerLimit: limitNumber,
  };
}

// Approximate rectangle around a circle, for the Firestore query. Results are
// then trimmed to the real circle by distance.
function boundingBox({ lat, lng, radiusKm }) {
  const kmPerDegree = 111.32;
  const dLat = radiusKm / kmPerDegree;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = cos < 0.01 ? 180 : radiusKm / (kmPerDegree * cos);
  return {
    south: Math.max(-90, lat - dLat),
    north: Math.min(90, lat + dLat),
    west: Math.max(-180, lng - dLng),
    east: Math.min(180, lng + dLng),
  };
}

// Build the Firestore query for listEvents/watchEvents, plus `refine`, which
// applies the filters Firestore can't do (exact distance, skill, open spots).
// Every combination here has an index in firestore.indexes.json.
function buildEventsQuery({
  sportId,
  from,
  to,
  bounds,
  near,
  skillLevel,
  openOnly = false,
  max = DEFAULT_MAX_RESULTS,
} = {}) {
  const parts = [where("status", "==", "scheduled")];

  const sports = Array.isArray(sportId) ? sportId : sportId ? [sportId] : [];
  if (sports.length > 30) {
    throw new EventError("events/invalid-sport", "Pick at most 30 sports at once.");
  }
  if (sports.length === 1) parts.push(where("sportId", "==", sports[0]));
  if (sports.length > 1) parts.push(where("sportId", "in", sports));

  const start = from ? toDate(from, "start of the time range") : new Date();
  parts.push(where("startTime", ">=", Timestamp.fromDate(start)));
  if (to) parts.push(where("startTime", "<", Timestamp.fromDate(toDate(to, "end of the time range"))));
  parts.push(orderBy("startTime"));

  if (near) {
    const ok = [near.lat, near.lng, near.radiusKm].every(Number.isFinite) && near.radiusKm > 0;
    if (!ok) throw new EventError("events/invalid-location", "Location filter needs lat, lng, and radiusKm.");
  }
  if (bounds && ![bounds.south, bounds.west, bounds.north, bounds.east].every(Number.isFinite)) {
    throw new EventError("events/invalid-location", "Map area filter needs south, west, north, and east.");
  }
  const box = near ? boundingBox(near) : bounds;
  if (box) {
    parts.push(
      where("location.lat", ">=", box.south),
      where("location.lat", "<=", box.north),
      where("location.lng", ">=", box.west),
      where("location.lng", "<=", box.east),
      orderBy("location.lat"),
      orderBy("location.lng"),
    );
  }

  parts.push(limit(max));

  const refine = (events) => {
    let result = events;
    if (near) {
      result = result
        .map((e) => ({ ...e, distanceKm: distanceKm(near, e.location) }))
        .filter((e) => e.distanceKm <= near.radiusKm);
    }
    if (skillLevel) result = result.filter((e) => e.skillLevel === skillLevel);
    if (openOnly) result = result.filter((e) => !e.isFull);
    return result;
  };

  return { q: query(eventsCol, ...parts), refine };
}
