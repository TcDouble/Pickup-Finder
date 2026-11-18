// Edit profile form checks, kept free of Firebase imports so they can be unit
// tested on their own. The home page and profile.js both use this. Keep the
// limits in sync with the users rule in firebase/firestore.rules.
import { MAX_CITY, MAX_NAME, photoError } from "./validateRegistration.js";

export { MAX_CITY, MAX_NAME };
export const MAX_BIO = 300;
export const LEVELS = ["casual", "competitive"];

/**
 * Check the Edit profile form.
 *
 * input: { photo, removePhoto, displayName, city, sports, sportLevels, bio }
 *   photo is a new picture (File, or anything with `type` and `size`) or null.
 *   sportLevels maps a sport ID to "casual" or "competitive"; levels for
 *   sports that aren't in `sports` are dropped.
 *
 * Returns { valid, errors, value }. `errors` lists messages in form order.
 * `value` is the cleaned-up profile: trimmed text, the sports list, and the
 * levels for those sports only.
 */
export function validateProfile(input = {}) {
  const displayName = String(input.displayName ?? "").trim();
  const city = String(input.city ?? "").trim();
  const bio = String(input.bio ?? "").trim();
  const sports = Array.isArray(input.sports) ? [...new Set(input.sports.map(String))] : [];
  const levels = input.sportLevels ?? {};
  const sportLevels = Object.fromEntries(
    sports.filter((sport) => levels[sport] !== undefined).map((sport) => [sport, String(levels[sport])]),
  );

  const errors = [];
  const badPhoto = photoError(input.photo);
  if (badPhoto) errors.push(badPhoto);
  if (!displayName) errors.push("Enter a display name.");
  else if (displayName.length > MAX_NAME) errors.push(`Display name must be ${MAX_NAME} characters or fewer.`);
  if (city.length > MAX_CITY) errors.push(`City must be ${MAX_CITY} characters or fewer.`);
  if (Object.values(sportLevels).some((level) => !LEVELS.includes(level))) {
    errors.push("Pick Casual or Competitive for each sport.");
  }
  if (bio.length > MAX_BIO) errors.push(`About must be ${MAX_BIO} characters or fewer.`);

  return { valid: errors.length === 0, errors, value: { displayName, city, sports, sportLevels, bio } };
}
