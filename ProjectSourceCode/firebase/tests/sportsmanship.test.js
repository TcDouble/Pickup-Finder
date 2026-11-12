// Tests for sportsmanship.js, run against the emulators with the real security rules.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { BOULDER, closeAll, hoursFromNow, signedInAs, signedOut, startTestEnv } from "./helpers.js";

let env, alice, bob, carol, dave, nobody;
const DAY = 24;
const ts = (date) => Timestamp.fromDate(date);

before(async () => {
  env = await startTestEnv();
  await env.clearFirestore();
  [alice, bob, carol, dave] = await Promise.all(["Alice", "Bob", "Carol", "Dave"].map(signedInAs));
  nobody = await signedOut();
  // Profiles for display names. Carol has none, like an account that never
  // finished signing up.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore(); // call firestore() only once per context
    await setDoc(doc(db, "users", alice.uid), { displayName: "Alice" });
    await setDoc(doc(db, "users", bob.uid), { displayName: "Bob" });
    await setDoc(doc(db, "users", dave.uid), { displayName: "Dave" });
  });
});

after(async () => {
  await closeAll([alice, bob, carol, dave, nobody]);
  await env.cleanup();
});

// Put a game in the database directly (the rules only allow creating games
// that start in the future). By default alice, bob, and carol played and it
// ended an hour ago. Returns its id.
let gameCount = 0;
async function seedGame(overrides = {}) {
  const id = `game${++gameCount}`;
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), "events", id), {
      sportId: "basketball",
      title: "",
      description: "",
      skillLevel: "casual",
      startTime: ts(hoursFromNow(-3)),
      endTime: ts(hoursFromNow(-1)),
      location: { name: "North Boulder Park", address: "", ...BOULDER },
      playerLimit: 10,
      hostId: alice.uid,
      hostName: "Alice",
      participantIds: [alice.uid, bob.uid, carol.uid],
      status: "scheduled",
      createdAt: Timestamp.now(),
      ...overrides,
    }),
  );
  return id;
}

// Expect a promise to reject with an error carrying `code`.
async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    return true;
  });
}

describe("sportsmanshipScore", () => {
  test("starts new players at 100 and counts three extra positive ratings", () => {
    assert.equal(alice.sportsmanshipScore({}), 100);
    assert.equal(alice.sportsmanshipScore({ positive: 5, negative: 0 }), 100);
    assert.equal(alice.sportsmanshipScore({ positive: 0, negative: 1 }), 75);
    assert.equal(alice.sportsmanshipScore({ positive: 20, negative: 2 }), 92);
    assert.equal(alice.sportsmanshipScore({ positive: 0, negative: 10 }), 23);
  });
});

describe("leaveFeedback", () => {
  test("saves the feedback and adds it to the player's totals", async () => {
    const game = await seedGame();
    const before = await alice.getSportsmanship(carol.uid);
    assert.deepEqual(before, { userId: carol.uid, positive: 0, negative: 0, feedbackCount: 0, score: 100 });

    const id = await alice.leaveFeedback(game, carol.uid, { rating: "positive", comment: "  Great passer  " });
    assert.equal(id, `${game}_${alice.uid}_${carol.uid}`);
    await bob.leaveFeedback(game, carol.uid, { rating: "negative" });

    const after = await dave.getSportsmanship(carol.uid);
    assert.deepEqual(after, { userId: carol.uid, positive: 1, negative: 1, feedbackCount: 2, score: 80 });
  });

  test("shows up on the player's profile, newest first, with who left it", async () => {
    const game = await seedGame();
    await alice.leaveFeedback(game, bob.uid, { rating: "positive", comment: "Fun to play with" });
    await carol.leaveFeedback(game, bob.uid, { rating: "negative", comment: "Argued every call" });

    const feedback = await dave.listFeedbackFor(bob.uid);
    assert.equal(feedback.length, 2);
    assert.equal(feedback[0].fromId, carol.uid);
    assert.equal(feedback[0].fromName, null); // Carol has no profile
    assert.equal(feedback[0].rating, "negative");
    assert.equal(feedback[0].comment, "Argued every call");
    assert.equal(feedback[0].sportId, "basketball");
    assert.equal(feedback[0].eventId, game);
    assert.ok(feedback[0].createdAt instanceof Date);
    assert.equal(feedback[1].fromName, "Alice");
    assert.equal(feedback[1].comment, "Fun to play with");

    assert.equal((await dave.listFeedbackFor(bob.uid, { max: 1 })).length, 1);
  });

  test("rejects a rating that isn't positive or negative", async () => {
    const game = await seedGame();
    await rejectsWith(alice.leaveFeedback(game, bob.uid, { rating: "neutral" }), "sportsmanship/invalid-rating");
  });

  test("rejects a comment that's too long", async () => {
    const game = await seedGame();
    const comment = "x".repeat(alice.MAX_COMMENT + 1);
    await rejectsWith(
      alice.leaveFeedback(game, bob.uid, { rating: "positive", comment }),
      "sportsmanship/invalid-comment",
    );
  });

  test("won't let you rate yourself", async () => {
    const game = await seedGame();
    await rejectsWith(alice.leaveFeedback(game, alice.uid, { rating: "positive" }), "sportsmanship/self");
  });

  test("only players in the game can rate, and only each other", async () => {
    const game = await seedGame();
    await rejectsWith(dave.leaveFeedback(game, bob.uid, { rating: "negative" }), "sportsmanship/not-in-game");
    await rejectsWith(alice.leaveFeedback(game, dave.uid, { rating: "negative" }), "sportsmanship/not-a-player");
  });

  test("waits until the game is over", async () => {
    const game = await seedGame({ startTime: ts(hoursFromNow(-1)), endTime: ts(hoursFromNow(1)) });
    await rejectsWith(alice.leaveFeedback(game, bob.uid, { rating: "positive" }), "sportsmanship/not-finished");
  });

  test("closes 14 days after the game", async () => {
    const game = await seedGame({
      startTime: ts(hoursFromNow(-15 * DAY - 2)),
      endTime: ts(hoursFromNow(-15 * DAY)),
    });
    await rejectsWith(alice.leaveFeedback(game, bob.uid, { rating: "positive" }), "sportsmanship/too-late");
  });

  test("doesn't rate cancelled or missing games", async () => {
    const game = await seedGame({ status: "cancelled" });
    await rejectsWith(alice.leaveFeedback(game, bob.uid, { rating: "positive" }), "sportsmanship/cancelled");
    await rejectsWith(alice.leaveFeedback("no-such-game", bob.uid, { rating: "positive" }), "sportsmanship/not-found");
  });

  test("allows one rating per player per game", async () => {
    const game = await seedGame();
    await alice.leaveFeedback(game, bob.uid, { rating: "positive" });
    const before = await alice.getSportsmanship(bob.uid);
    await rejectsWith(alice.leaveFeedback(game, bob.uid, { rating: "negative" }), "sportsmanship/already-rated");
    assert.deepEqual(await alice.getSportsmanship(bob.uid), before);
  });

  test("needs a signed-in user", async () => {
    const game = await seedGame();
    await rejectsWith(nobody.leaveFeedback(game, bob.uid, { rating: "positive" }), "events/not-signed-in");
    await rejectsWith(nobody.getSportsmanship(bob.uid), "events/not-signed-in");
  });

  test("errors work with friendlyEventError", async () => {
    const game = await seedGame();
    await assert.rejects(alice.leaveFeedback(game, alice.uid, { rating: "positive" }), (err) => {
      assert.equal(alice.friendlyEventError(err), "You can't rate yourself.");
      return true;
    });
  });
});

describe("playersToRate", () => {
  test("lists the other players and who you've rated", async () => {
    const game = await seedGame({ participantIds: [alice.uid, bob.uid, carol.uid, dave.uid] });
    await bob.leaveFeedback(game, carol.uid, { rating: "negative" });

    const result = await bob.playersToRate(game);
    assert.equal(result.canRate, true);
    assert.equal(result.whyNot, null);
    assert.equal(result.sportId, "basketball");
    assert.equal(result.deadline.getTime() - result.endTime.getTime(), 14 * DAY * 60 * 60 * 1000);
    assert.deepEqual(result.players, [
      { userId: alice.uid, displayName: "Alice", rated: false, rating: null },
      { userId: carol.uid, displayName: null, rated: true, rating: "negative" },
      { userId: dave.uid, displayName: "Dave", rated: false, rating: null },
    ]);
  });

  test("says why you can't rate yet", async () => {
    const game = await seedGame({ startTime: ts(hoursFromNow(1)), endTime: ts(hoursFromNow(3)) });
    const result = await bob.playersToRate(game);
    assert.equal(result.canRate, false);
    assert.equal(result.whyNot, "You can rate players once the game is over.");
    assert.equal(result.players.length, 2);
  });
});

describe("games played", () => {
  test("counts finished games the player was in, not upcoming or cancelled ones", async () => {
    const erin = await signedInAs("Erin");
    try {
      const players = [alice.uid, erin.uid];
      await seedGame({ participantIds: players });
      await seedGame({ participantIds: players, startTime: ts(hoursFromNow(-50)), endTime: ts(hoursFromNow(-48)) });
      await seedGame({ participantIds: players, status: "cancelled" });
      await seedGame({ participantIds: players, startTime: ts(hoursFromNow(2)), endTime: ts(hoursFromNow(4)) });
      await seedGame({ participantIds: [alice.uid, bob.uid] });

      assert.equal(await bob.countGamesPlayed(erin.uid), 2);

      const game = await seedGame({ participantIds: [alice.uid, erin.uid] });
      await alice.leaveFeedback(game, erin.uid, { rating: "positive", comment: "On time" });
      const stats = await bob.getPlayerStats(erin.uid);
      assert.deepEqual(stats, {
        userId: erin.uid,
        positive: 1,
        negative: 0,
        feedbackCount: 1,
        score: 100,
        gamesPlayed: 3,
      });
    } finally {
      await closeAll([erin]);
    }
  });
});
