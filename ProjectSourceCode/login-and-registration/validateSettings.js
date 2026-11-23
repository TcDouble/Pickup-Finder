// Settings checks, kept free of Firebase imports so they can be unit tested on
// their own. Keep in sync with the settings rule in firebase/firestore.rules.
import { MAX_CITY } from "./validateRegistration.js";

// Same IDs as SPORTS in firebase/events.js.
export const SPORT_IDS = ["basketball", "soccer", "volleyball", "tennis", "pickleball", "football"];
export const UNITS = ["mi", "km"];
export const FRIEND_REQUESTS = ["everyone", "nobody"];
export const MAX_HOME_LABEL = 100;

export const DEFAULT_SETTINGS = {
  showCity: true,
  privateCity: "",
  homeArea: null,
  units: "mi",
  startSports: [],
  friendRequests: "everyone",
};

function validHomeArea(area) {
  if (area === null) return true;
  return (
    typeof area === "object" &&
    typeof area.label === "string" &&
    area.label.length <= MAX_HOME_LABEL &&
    Number.isFinite(area.lat) && area.lat >= -90 && area.lat <= 90 &&
    Number.isFinite(area.lng) && area.lng >= -180 && area.lng <= 180
  );
}

/**
 * Check a set of setting changes. Only the keys present are checked, so the
 * Settings screen can save one switch at a time.
 *
 * Returns { valid, errors, value }, where `value` holds the cleaned changes.
 */
export function validateSettings(changes = {}) {
  const errors = [];
  const value = {};

  if ("showCity" in changes) {
    if (typeof changes.showCity === "boolean") value.showCity = changes.showCity;
    else errors.push("Show my city must be on or off.");
  }
  if ("privateCity" in changes) {
    const city = String(changes.privateCity ?? "").trim();
    if (city.length > MAX_CITY) errors.push(`City must be ${MAX_CITY} characters or fewer.`);
    else value.privateCity = city;
  }
  if ("homeArea" in changes) {
    const area = changes.homeArea ?? null;
    if (!validHomeArea(area)) errors.push("That home area isn't a valid place.");
    else value.homeArea = area && { label: area.label.trim(), lat: area.lat, lng: area.lng };
  }
  if ("units" in changes) {
    if (UNITS.includes(changes.units)) value.units = changes.units;
    else errors.push("Pick miles or kilometers.");
  }
  if ("startSports" in changes) {
    const sports = Array.isArray(changes.startSports) ? [...new Set(changes.startSports)] : null;
    if (!sports || sports.some((sport) => !SPORT_IDS.includes(sport))) errors.push("Pick sports from the list.");
    else value.startSports = sports;
  }
  if ("friendRequests" in changes) {
    if (FRIEND_REQUESTS.includes(changes.friendRequests)) value.friendRequests = changes.friendRequests;
    else errors.push("Pick who can send you friend requests.");
  }

  return { valid: errors.length === 0, errors, value };
}
