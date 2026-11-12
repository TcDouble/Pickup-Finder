// Which new games a player hears about (match alerts), using the matchmaking
// settings they saved with saveNotificationSettings() in
// ../../firebase/notifications.js.
//
// The browser modules in ../../firebase/ load Firestore from a CDN, so Node
// can't import them. The two small helpers below are copies: keep them the same
// as sportsmanshipScore() in sportsmanship.js and distanceKm() in events.js.

export const STARTING_POSITIVES = 3;

/** Same as sportsmanshipScore() in ../../firebase/sportsmanship.js. */
export function sportsmanshipScore({ positive = 0, negative = 0 } = {}) {
  return Math.round((100 * (positive + STARTING_POSITIVES)) / (positive + negative + STARTING_POSITIVES));
}

/** Same as distanceKm() in ../../firebase/events.js. */
export function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Whether a newly posted game is a match for a player, the same way
 * recommendGames() in matchmaking.js picks games: it's open, it's a sport they
 * follow, it's close enough, it's their skill level, and every player in it has
 * at least the sportsmanship score they asked for.
 *
 * @param {object} game  an events document, with startTime as a Date
 * @param {object} alerts  the player's matchAlerts settings
 * @param {object} context
 * @param {string} context.uid  the player
 * @param {Date} context.now
 * @param {number} context.lowestScore  the lowest sportsmanship score among the game's players
 */
export function fitsMatchAlert(game, alerts, { uid, now, lowestScore }) {
  if (!alerts || !Array.isArray(alerts.sportIds)) return false;
  if (game.status !== "scheduled" || game.startTime <= now) return false;
  if (game.participantIds.length >= game.playerLimit) return false;
  if (game.hostId === uid || game.participantIds.includes(uid)) return false;
  if (!alerts.sportIds.includes(game.sportId)) return false;
  if (alerts.skillLevel && alerts.skillLevel !== "any" && alerts.skillLevel !== game.skillLevel) return false;
  if (alerts.near && distanceKm(alerts.near, game.location) > alerts.near.radiusKm) return false;
  return lowestScore >= (alerts.minScore ?? 0);
}
