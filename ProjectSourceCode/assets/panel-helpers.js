// Small helpers shared by the Notifications, Recommended, Rate players,
// Friends, and Online now panels on the home page. Nothing here talks to
// Firebase, so the formatting and filtering are unit tested on their own
// (../test/panel-helpers.spec.js).

import { isOnline } from "../firebase/social-helpers.js";

export const SPORT_NAMES = {
  basketball: "Basketball",
  soccer: "Soccer",
  volleyball: "Volleyball",
  tennis: "Tennis",
  pickleball: "Pickleball",
  football: "Football",
};

export const KM_PER_MILE = 1.609344;
const DAY_MS = 24 * 60 * 60 * 1000;

export const sportName = (sportId) => SPORT_NAMES[sportId] ?? String(sportId ?? "Game");

/** "Basketball · 5v5", or just "Basketball" when the game has no title. */
export function gameName(game) {
  const sport = sportName(game?.sportId);
  return game?.title ? `${sport} · ${game.title}` : sport;
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Distances are stored in km; the pages show miles, rounded to 0.1. */
export const milesToKm = (miles) => Math.round(miles * KM_PER_MILE * 10) / 10;
export const kmToMiles = (km) => Math.round((km / KM_PER_MILE) * 10) / 10;

/** "Sat, Nov 21, 6:00 PM" in the browser's time zone. */
export function formatDayTime(date) {
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Sat, Nov 21" in the browser's time zone. */
export function formatDay(date) {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** { month: "NOV", day: "21" } for the black date box on game cards. */
export function dateBoxParts(date) {
  return {
    month: date.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    day: String(date.getDate()),
  };
}

/** How old an inbox item is: "now", "5m", "3h", "2d", then the date ("Nov 3"). */
export function timeAgo(date, now = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const minutes = Math.floor((now - date) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Up to two capital letters for a player without a photo: "Riley Park" -> "RP". */
export function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
  return (first + last).toUpperCase();
}

/**
 * The past games the player can still rate the others in: the game ended,
 * wasn't cancelled, had someone else in it, and ended less than `windowDays`
 * ago. Most recently ended first. `games` are as listMyEvents returns them.
 * sportsmanship.js and the rules check all of this again when rating.
 */
export function rateableGames(games, { uid, windowDays, now = new Date() }) {
  return games
    .filter(
      (game) =>
        game.status !== "cancelled" &&
        game.endTime instanceof Date &&
        game.endTime <= now &&
        now - game.endTime < windowDays * DAY_MS &&
        (game.participantIds ?? []).some((id) => id !== uid),
    )
    .sort((a, b) => b.endTime - a.endTime);
}

/** "92 from 12 ratings", or "100 (no ratings yet)" for a new player. */
export function scoreSummary({ score, feedbackCount }) {
  return feedbackCount ? `${score} from ${plural(feedbackCount, "rating")}` : `${score} (no ratings yet)`;
}

/**
 * One line on how well a recommended game fits: how its players' average
 * sportsmanship score compares with yours.
 */
export function matchNote(averageScore, myScore) {
  const gap = Math.abs(averageScore - myScore);
  const scores = `players average ${averageScore}, you're ${myScore}`;
  if (gap <= 5) return `Close match: ${scores}`;
  if (gap <= 15) return `Good match: ${scores}`;
  return `Sportsmanship: ${scores}`;
}

/**
 * Where tapping an inbox notification takes you, as { name, gameId } for
 * showPanel: rating requests open Rate players for that game, and match
 * alerts open Recommended with that game on top. Reminders only need marking
 * read, so they return null.
 */
export function notificationTarget(item) {
  if (!item?.eventId) return null;
  if (item.type === "feedback") return { name: "rate", gameId: item.eventId };
  if (item.type === "match") return { name: "recommended", gameId: item.eventId };
  return null;
}

/**
 * How recently a player was on, for the friends list: "Online now", "Active
 * 5m ago", "Active 3h ago", "Active Nov 3". Empty for players who hid
 * themselves or never opened the app. `presence` is { state, lastSeen }.
 */
export function activityText(presence, now = new Date()) {
  if (!presence || presence.state === "hidden" || !(presence.lastSeen instanceof Date)) return "";
  if (isOnline(presence, now)) return "Online now";
  const ago = timeAgo(presence.lastSeen, now);
  if (ago === "now") return "Active just now";
  return /^\d/.test(ago) ? `Active ${ago} ago` : `Active ${ago}`;
}

/** "Boulder · Soccer, Tennis": a player's city and sports, for player lists. */
export function playerDetails({ city = "", sports = [] } = {}) {
  const sportList = (sports ?? []).map(sportName).join(", ");
  return [city, sportList].filter(Boolean).join(" · ");
}

/**
 * Who's going, for a friends' game: "Riley is going", "Riley and Sam are
 * going", "Riley, Sam, and 2 more are going".
 */
export function friendsGoingText(names) {
  const list = names.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return `${list[0]} is going`;
  if (list.length === 2) return `${list[0]} and ${list[1]} are going`;
  return `${list[0]}, ${list[1]}, and ${list.length - 2} more are going`;
}

// ---------------------------------------------------------------------------
// DOM helpers (browser only)
// ---------------------------------------------------------------------------

/**
 * Make an element: el("span", { class: "muted" }, "text", otherElement).
 * Strings are always added as text, never as HTML, so names and comments
 * that players typed can't inject markup. `on<event>` attributes that are
 * functions become listeners; null, undefined, and false attributes are left out.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  node.append(...children.flat().filter((child) => child != null && child !== false && child !== ""));
  return node;
}

/** The black month-and-day box from the game cards. */
export function dateBox(date) {
  const { month, day } = dateBoxParts(date);
  return el("div", { class: "date-box", "aria-hidden": "true" }, el("span", {}, month), el("span", {}, day));
}

/**
 * Open a home page panel from any script. home.js listens for this event and
 * opens the panel; the panel's own script gets the same detail (for example
 * which game to show) through onPanelOpen.
 */
export function showPanel(name, gameId = null) {
  document.dispatchEvent(new CustomEvent("pickup:show-panel", { detail: { name, gameId } }));
}

/**
 * Call onOpen({ name, gameId }) each time the named panel is opened, from its
 * sidebar button (gameId is null) or from showPanel.
 */
export function onPanelOpen(name, onOpen) {
  const panel = document.getElementById(`panel-${name}`);
  // home.js's click handler runs first and shows or hides the panel.
  document.querySelector(`.sidebar [data-panel="${name}"]`)?.addEventListener("click", () => {
    if (!panel.hidden) onOpen({ name, gameId: null });
  });
  document.addEventListener("pickup:show-panel", (event) => {
    if (event.detail?.name === name) onOpen({ name, gameId: event.detail.gameId ?? null });
  });
}
