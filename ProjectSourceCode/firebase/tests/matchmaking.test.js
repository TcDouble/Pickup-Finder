// Tests for matchmaking.js, run against the emulators with the real security rules.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { BOULDER, closeAll, hoursFromNow, signedInAs, signedOut, startTestEnv } from "./helpers.js";

let env, newbie, good, good2, okay, rough, nobody;
const ts = (date) => Timestamp.fromDate(date);
const games = {};

// Put a document in the database directly, skipping the rules.
async function seed(path, data) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path), data));
}

async function seedGame(name, host, players, overrides = {}) {
  games[name] = name;
  await seed(`events/${name}`, {
    sportId: "basketball",
    title: name,
    description: "",
    skillLevel: "casual",
    startTime: ts(hoursFromNow(2)),
    endTime: ts(hoursFromNow(4)),
    location: { name: "North Boulder Park", address: "", ...BOULDER },
    playerLimit: 10,
    hostId: host.uid,
    hostName: host.name,
    participantIds: players.map((p) => p.uid),
    status: "scheduled",
    createdAt: Timestamp.now(),
    ...overrides,
  });
}

async function seedTotals(person, positive, negative) {
  await seed(`sportsmanship/${person.uid}`, {
    positive,
    negative,
    lastFeedbackId: "seeded",
    updatedAt: Timestamp.now(),
  });
}

before(async () => {
  env = await startTestEnv();
  await env.clearFirestore();
  [newbie, good, good2, okay, rough] = await Promise.all(
    ["Newbie", "Good", "Good2", "Okay", "Rough"].map(async (name) => ({ ...(await signedInAs(name)), name })),
  );
  nobody = await signedOut();

  // Scores: newbie 100 (no ratings yet), good 100, good2 92, okay 75, rough 33.
  await seedTotals(good, 12, 0);
  await seedTotals(good2, 20, 2);
  await seedTotals(okay, 6, 3);
  await seedTotals(rough, 0, 6);

  await seedGame("goodGame", good, [good, good2], { startTime: ts(hoursFromNow(5)), endTime: ts(hoursFromNow(6)) });
  await seedGame("okayGame", okay, [okay]);
  await seedGame("roughGame", rough, [rough, okay]);
  await seedGame("earlyGoodGame", good2, [good2, good], { startTime: ts(hoursFromNow(1)), endTime: ts(hoursFromNow(2)) });
  await seedGame("soccerGame", good, [good], { sportId: "soccer" });
  // Never recommended: full, cancelled, or already joined by newbie.
  await seedGame("fullGame", good, [good, good2], { playerLimit: 2 });
  await seedGame("cancelledGame", good, [good], { status: "cancelled" });
  await seedGame("joinedGame", good, [good, newbie]);
});

after(async () => {
  await closeAll([newbie, good, good2, okay, rough, nobody]);
  await env.cleanup();
});

const titles = (list) => list.map((g) => g.title);

describe("recommendGames", () => {
  test("puts games whose players are closest to your score first", async () => {
    const result = await newbie.recommendGames({ sportId: "basketball" });
    // newbie's score is 100. goodGame and earlyGoodGame both average 96,
    // so the earlier one comes first.
    assert.deepEqual(titles(result), ["earlyGoodGame", "goodGame", "okayGame", "roughGame"]);

    const goodGame = result.find((g) => g.title === "goodGame");
    assert.equal(goodGame.averageScore, 96);
    assert.equal(goodGame.lowestScore, 92);
    assert.equal(goodGame.scoreGap, 4);
    assert.equal(goodGame.isGoing, false);

    const roughGame = result.find((g) => g.title === "roughGame");
    assert.equal(roughGame.averageScore, 54);
    assert.equal(roughGame.lowestScore, 33);
    assert.equal(roughGame.scoreGap, 46);
  });

  test("matches a player with a low score to games near their own score", async () => {
    const result = await rough.recommendGames({ sportId: "basketball" });
    // rough's score is 33 and roughGame is their own game, so it's left out.
    assert.deepEqual(titles(result), ["okayGame", "earlyGoodGame", "goodGame", "joinedGame"]);
  });

  test("leaves out full games, cancelled games, and games you're in", async () => {
    const result = await newbie.recommendGames();
    const shown = titles(result);
    for (const hidden of ["fullGame", "cancelledGame", "joinedGame"]) {
      assert.ok(!shown.includes(hidden), `${hidden} shouldn't be recommended`);
    }
    assert.ok(shown.includes("soccerGame"));
  });

  test("minScore skips games with any player below it", async () => {
    const result = await newbie.recommendGames({ sportId: "basketball", minScore: 70 });
    assert.deepEqual(titles(result), ["earlyGoodGame", "goodGame", "okayGame"]);
  });

  test("passes the usual filters on to listEvents", async () => {
    const result = await newbie.recommendGames({ sportId: "soccer", near: { ...BOULDER, radiusKm: 5 } });
    assert.deepEqual(titles(result), ["soccerGame"]);
    assert.equal(typeof result[0].distanceKm, "number");
  });

  test("rejects a minScore outside 0 to 100", async () => {
    await assert.rejects(newbie.recommendGames({ minScore: 120 }), { code: "matchmaking/invalid-min-score" });
    await assert.rejects(newbie.recommendGames({ minScore: "high" }), { code: "matchmaking/invalid-min-score" });
  });

  test("needs a signed-in user", async () => {
    await assert.rejects(nobody.recommendGames(), { code: "events/not-signed-in" });
  });
});
