// Matchmaking for Pickup-Finder (GitHub issue #13).
//
// Suggests upcoming games whose players have about the same sportsmanship
// score as you (see sportsmanship.js), so good sports end up playing with
// good sports. It runs in the page and needs no collection of its own.
//
// Usage:
//   import { recommendGames } from "../firebase/matchmaking.js";
//   const games = await recommendGames({ sportId: "soccer", near: { lat, lng, radiusKm: 10 } });

import { auth } from "./firebase-config.js";
import { EventError, listEvents } from "./events.js";
import { getSportsmanshipMany } from "./sportsmanship.js";

/**
 * Upcoming games with room for you, best match first.
 *
 * Takes the same filters as listEvents (sportId, from, to, near, bounds,
 * skillLevel, max), plus:
 *
 * @param {number} [filters.minScore]  skip games where any player's score is
 *        below this (0 to 100, default 0)
 * @returns {Promise<object[]>} games as listEvents returns them, plus
 *   averageScore (the players' average score), lowestScore, and scoreGap (how
 *   far averageScore is from your score). Sorted by scoreGap, then start time.
 *   Games you're already in and full games are left out.
 */
export async function recommendGames({ minScore = 0, ...filters } = {}) {
  const user = auth.currentUser;
  if (!user) throw new EventError("events/not-signed-in", "Please log in first.");
  if (typeof minScore !== "number" || !(minScore >= 0 && minScore <= 100)) {
    throw new EventError("matchmaking/invalid-min-score", "The minimum score has to be from 0 to 100.");
  }

  const games = (await listEvents({ ...filters, openOnly: true })).filter((game) => !game.isGoing);
  const players = [user.uid, ...games.flatMap((game) => game.participantIds)];
  const stats = await getSportsmanshipMany(players);
  const myScore = stats.get(user.uid).score;

  return games
    .map((game) => {
      const scores = game.participantIds.map((id) => stats.get(id).score);
      const averageScore = Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
      return {
        ...game,
        averageScore,
        lowestScore: Math.min(...scores),
        scoreGap: Math.abs(averageScore - myScore),
      };
    })
    .filter((game) => game.lowestScore >= minScore)
    .sort((a, b) => a.scoreGap - b.scoreGap || a.startTime - b.startTime);
}
