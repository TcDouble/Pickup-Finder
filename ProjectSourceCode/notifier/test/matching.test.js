// Tests for which new games count as a match for a player's alerts.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { distanceKm, fitsMatchAlert, sportsmanshipScore } from "../src/matching.js";

const BOULDER = { lat: 40.015, lng: -105.2705 };
const DENVER = { lat: 39.7392, lng: -104.9903 }; // about 40 km from Boulder
const now = new Date("2026-11-10T18:00:00Z");

const game = (overrides = {}) => ({
  sportId: "soccer",
  skillLevel: "casual",
  status: "scheduled",
  startTime: new Date("2026-11-12T01:00:00Z"),
  location: { name: "Scott Carpenter Park", address: "", ...BOULDER },
  playerLimit: 10,
  hostId: "alice",
  participantIds: ["alice", "bob"],
  ...overrides,
});
const alerts = (overrides = {}) => ({
  sportIds: ["soccer"],
  skillLevel: "any",
  near: { ...BOULDER, radiusKm: 10 },
  minScore: 0,
  ...overrides,
});
const fits = (g, a, more = {}) => fitsMatchAlert(g, a, { uid: "carol", now, lowestScore: 100, ...more });

describe("fitsMatchAlert", () => {
  test("matches an open game in a sport you follow, nearby", () => {
    assert.equal(fits(game(), alerts()), true);
    assert.equal(fits(game(), alerts({ near: null })), true); // anywhere
  });

  test("skips sports you don't follow, and alerts that are off", () => {
    assert.equal(fits(game({ sportId: "tennis" }), alerts()), false);
    assert.equal(fits(game(), alerts({ sportIds: [] })), false);
    assert.equal(fits(game(), undefined), false);
  });

  test("skips games too far away", () => {
    assert.equal(fits(game({ location: { name: "Denver", ...DENVER } }), alerts()), false);
    assert.equal(fits(game({ location: { name: "Denver", ...DENVER } }), alerts({ near: { ...BOULDER, radiusKm: 50 } })), true);
  });

  test("skips the wrong skill level, unless you said any", () => {
    assert.equal(fits(game({ skillLevel: "competitive" }), alerts({ skillLevel: "casual" })), false);
    assert.equal(fits(game({ skillLevel: "competitive" }), alerts({ skillLevel: "competitive" })), true);
    assert.equal(fits(game({ skillLevel: "competitive" }), alerts({ skillLevel: "any" })), true);
  });

  test("skips games with a player below your minimum sportsmanship score", () => {
    assert.equal(fits(game(), alerts({ minScore: 80 }), { lowestScore: 75 }), false);
    assert.equal(fits(game(), alerts({ minScore: 75 }), { lowestScore: 75 }), true);
  });

  test("skips full, cancelled, and started games, and games you're already in", () => {
    assert.equal(fits(game({ playerLimit: 2 }), alerts()), false);
    assert.equal(fits(game({ status: "cancelled" }), alerts()), false);
    assert.equal(fits(game({ startTime: new Date(now.getTime() - 1) }), alerts()), false);
    assert.equal(fits(game(), alerts(), { uid: "bob" }), false);
    assert.equal(fits(game(), alerts(), { uid: "alice" }), false);
  });
});

describe("copied helpers", () => {
  test("sportsmanshipScore gives the same scores as sportsmanship.js", () => {
    assert.equal(sportsmanshipScore({}), 100);
    assert.equal(sportsmanshipScore({ positive: 0, negative: 1 }), 75);
    assert.equal(sportsmanshipScore({ positive: 20, negative: 2 }), 92);
    assert.equal(sportsmanshipScore({ positive: 0, negative: 10 }), 23);
  });

  test("distanceKm gives about 40 km from Boulder to Denver", () => {
    const km = distanceKm(BOULDER, DENVER);
    assert.ok(km > 35 && km < 45, `got ${km}`);
  });
});
