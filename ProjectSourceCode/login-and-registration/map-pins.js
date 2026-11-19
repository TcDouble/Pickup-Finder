// Turns the games from watchEvents (../firebase/events.js) into pins for the
// home page map. Nothing here touches Google Maps or Firebase, so it's unit
// tested on its own (../test/map-pins.spec.js); home.js draws the pins.

import { gameName, plural } from "../assets/panel-helpers.js";

/** The icon on a pin for each sport (same IDs as SPORTS in firebase/events.js). */
export const SPORT_ICONS = {
  basketball: "🏀",
  soccer: "⚽",
  volleyball: "🏐",
  tennis: "🎾",
  pickleball: "🏓", // no pickleball emoji yet; a paddle is closest
  football: "🏈",
};

/** For a spot with games of different sports, or a sport without an icon. */
export const MIXED_ICON = "🏅";

const SKILL_NAMES = { casual: "Casual", competitive: "Competitive" };

/**
 * The game's saved spot as { lat, lng }, or null when it can't go on the map:
 * no location, lat or lng missing or not a number, or off the globe.
 */
export function pinPosition(event) {
  const lat = event?.location?.lat;
  const lng = event?.location?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Sort games into pins, one per spot. Games saved within about a meter of each
 * other (the same court or field) share a pin, so no game hides under another.
 *
 * Returns { pins, skipped }. Each pin is { key, position, events }: key stays
 * the same while the spot does (home.js uses it to update pins in place), and
 * events are soonest first. skipped lists the games with no valid location.
 */
export function groupIntoPins(events) {
  const byKey = new Map();
  const skipped = [];
  for (const event of events ?? []) {
    const position = pinPosition(event);
    if (!position) {
      skipped.push(event);
      continue;
    }
    // About 1.1 m of latitude. String(-0) is "0", so -0 and 0 share a key.
    const key = `${Math.round(position.lat * 1e5)},${Math.round(position.lng * 1e5)}`;
    if (!byKey.has(key)) byKey.set(key, { key, position, events: [] });
    byKey.get(key).events.push(event);
  }
  const pins = [...byKey.values()];
  for (const pin of pins) pin.events.sort((a, b) => startMs(a) - startMs(b) || 0);
  return { pins, skipped };
}

/** The icon on the pin, and how many games are there (a badge shows when it's more than 1). */
export function pinLook(pin) {
  const sports = new Set(pin.events.map((event) => event?.sportId));
  const [sport] = sports;
  const icon = sports.size === 1 ? (SPORT_ICONS[sport] ?? MIXED_ICON) : MIXED_ICON;
  return { icon, count: pin.events.length };
}

/** Hover text and the name screen readers hear: "Basketball · 5v5 at North Boulder Park". */
export function pinTitle(pin) {
  const place = placeName(pin.events[0]);
  return pin.events.length === 1
    ? `${gameName(pin.events[0])} at ${place}`
    : `${plural(pin.events.length, "game")} at ${place}`;
}

/**
 * What the pin's popup says about one game: its name, place, address, date,
 * time, players, and skill level. Times are in the browser's time zone unless
 * `timeZone` is given (the tests pass one).
 */
export function gameDetails(event, { timeZone } = {}) {
  const start = validDate(event?.startTime);
  const end = validDate(event?.endTime);
  return {
    id: event?.id ?? null,
    name: gameName(event),
    place: placeName(event),
    address: String(event?.location?.address ?? "").trim(),
    date: start ? formatDate(start, timeZone) : "Date not set",
    time: start ? formatTimeRange(start, end, timeZone) : "Time not set",
    players: playersText(event),
    skill: SKILL_NAMES[event?.skillLevel] ?? "",
  };
}

/** The box above the map: "3 games available". */
export function gameCountText(count) {
  return count === 0 ? "No upcoming games yet" : `${plural(count, "game")} available`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function placeName(event) {
  return String(event?.location?.name ?? "").trim() || "Unnamed spot";
}

function validDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

// Games with no start time go last.
function startMs(event) {
  return validDate(event?.startTime)?.getTime() ?? Infinity;
}

/** "Sat, Nov 21" */
function formatDate(date, timeZone) {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
}

/** "6:00 PM – 8:00 PM", or just "6:00 PM" without an end time. */
function formatTimeRange(start, end, timeZone) {
  const time = (date) => date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  return end && end > start ? `${time(start)} – ${time(end)}` : time(start);
}

/** "4/10 players · 6 spots left", "10/10 players · Full", or "4 players" without a limit. */
function playersText(event) {
  const count = Array.isArray(event?.participantIds)
    ? event.participantIds.length
    : Number(event?.playerCount) || 0;
  const limit = Number(event?.playerLimit);
  if (!Number.isInteger(limit) || limit <= 0) return plural(count, "player");
  const left = Math.max(0, limit - count);
  return `${count}/${limit} players · ${left === 0 ? "Full" : `${plural(left, "spot")} left`}`;
}
