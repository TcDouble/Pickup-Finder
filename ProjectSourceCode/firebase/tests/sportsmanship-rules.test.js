// Security rules tests for sportsmanship feedback (feedback and sportsmanship
// collections): writes the app would never make on purpose, to prove
// Firestore itself refuses them.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { BOULDER, hoursFromNow, startTestEnv } from "./helpers.js";

let env;
const as = (uid) => env.authenticatedContext(uid).firestore();
const ts = (date) => Timestamp.fromDate(date);
const DAY = 24;

// Put a game in the database directly, skipping the rules (they only allow
// games that start in the future). By default it ended an hour ago, and
// alice, bob, and carol played.
async function seedGame(id, overrides = {}) {
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), "events", id), {
      sportId: "basketball",
      title: "",
      description: "",
      skillLevel: "casual",
      startTime: ts(hoursFromNow(-3)),
      endTime: ts(hoursFromNow(-1)),
      location: { name: "North Boulder Park", address: "", ...BOULDER },
      playerLimit: 6,
      hostId: "alice",
      hostName: "Alice",
      participantIds: ["alice", "bob", "carol"],
      status: "scheduled",
      createdAt: Timestamp.now(),
      ...overrides,
    }),
  );
}

async function seed(path, data) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path), data));
}

async function read(path) {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore(), path))).data();
  });
  return data;
}

// What sportsmanship.js does: create the feedback and add to the player's
// totals in one batch. The options build the broken versions.
function rate(from, {
  eventId = "g1",
  to = "bob",
  rating = "positive",
  id = `${eventId}_${from}_${to}`,
  feedback = {},
  stats = {},
  statsFor = to,
  withFeedback = true,
  withStats = true,
} = {}) {
  const db = from ? as(from) : env.unauthenticatedContext().firestore();
  const batch = writeBatch(db);
  if (withFeedback) {
    batch.set(doc(db, "feedback", id), {
      eventId,
      sportId: "basketball",
      fromId: from,
      toId: to,
      rating,
      comment: "",
      createdAt: serverTimestamp(),
      ...feedback,
    });
  }
  if (withStats) {
    batch.set(
      doc(db, "sportsmanship", statsFor),
      {
        positive: increment(rating === "positive" ? 1 : 0),
        negative: increment(rating === "negative" ? 1 : 0),
        lastFeedbackId: id,
        updatedAt: serverTimestamp(),
        ...stats,
      },
      { merge: true },
    );
  }
  return batch.commit();
}

before(async () => {
  env = await startTestEnv();
});
after(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedGame("g1");
});

describe("leaving feedback", () => {
  test("a player can rate another player after the game, which starts their totals", async () => {
    await assertSucceeds(rate("alice", { to: "bob", rating: "positive", feedback: { comment: "Good game!" } }));
    const stats = await read("sportsmanship/bob");
    assert.equal(stats.positive, 1);
    assert.equal(stats.negative, 0);
  });

  test("later feedback adds to the existing totals", async () => {
    await seed("sportsmanship/bob", { positive: 4, negative: 1, lastFeedbackId: "old", updatedAt: Timestamp.now() });
    await assertSucceeds(rate("carol", { to: "bob", rating: "negative" }));
    const stats = await read("sportsmanship/bob");
    assert.equal(stats.positive, 4);
    assert.equal(stats.negative, 2);
  });

  test("a player can rate each of the other players once", async () => {
    await assertSucceeds(rate("alice", { to: "bob" }));
    await assertSucceeds(rate("alice", { to: "carol", rating: "negative" }));
    await assertSucceeds(rate("bob", { to: "alice" }));
  });

  test("rating feedback is allowed up to 14 days after the game", async () => {
    await seedGame("g2", { startTime: ts(hoursFromNow(-13 * DAY - 2)), endTime: ts(hoursFromNow(-13 * DAY)) });
    await assertSucceeds(rate("alice", { eventId: "g2", to: "bob" }));
  });

  test("rating the same player twice for the same game is denied", async () => {
    await assertSucceeds(rate("alice", { to: "bob" }));
    await assertFails(rate("alice", { to: "bob", rating: "negative" }));
  });

  test("rating yourself is denied", async () => {
    await assertFails(rate("alice", { to: "alice" }));
  });

  test("someone who wasn't in the game can't rate", async () => {
    await assertFails(rate("dave", { to: "bob" }));
  });

  test("you can't rate someone who wasn't in the game", async () => {
    await assertFails(rate("alice", { to: "dave" }));
  });

  test("you can't rate before the game is over", async () => {
    await seedGame("playing", { startTime: ts(hoursFromNow(-1)), endTime: ts(hoursFromNow(1)) });
    await seedGame("later", { startTime: ts(hoursFromNow(2)), endTime: ts(hoursFromNow(4)) });
    await assertFails(rate("alice", { eventId: "playing", to: "bob" }));
    await assertFails(rate("alice", { eventId: "later", to: "bob" }));
  });

  test("you can't rate players in a cancelled game", async () => {
    await seedGame("off", { status: "cancelled" });
    await assertFails(rate("alice", { eventId: "off", to: "bob" }));
  });

  test("you can't rate more than 14 days after the game", async () => {
    await seedGame("old", { startTime: ts(hoursFromNow(-15 * DAY - 2)), endTime: ts(hoursFromNow(-15 * DAY)) });
    await assertFails(rate("alice", { eventId: "old", to: "bob" }));
  });

  test("you can't rate a game that doesn't exist", async () => {
    await assertFails(rate("alice", { eventId: "nope", to: "bob" }));
  });

  test("you can't leave feedback in someone else's name", async () => {
    await assertFails(rate("alice", { id: "g1_carol_bob", feedback: { fromId: "carol" } }));
  });

  test("signed-out visitors can't leave feedback", async () => {
    await assertFails(rate(null, { id: "g1_alice_bob", feedback: { fromId: "alice" } }));
  });

  const bad = {
    "an ID that doesn't match the game and players": { id: "my-own-id" },
    "a rating other than positive or negative": { feedback: { rating: "neutral" } },
    "a comment over 300 characters": { feedback: { comment: "x".repeat(301) } },
    "a comment that isn't text": { feedback: { comment: 5 } },
    "the wrong sport": { feedback: { sportId: "soccer" } },
    "a made-up time": { feedback: { createdAt: ts(hoursFromNow(-1)) } },
    "an extra field": { feedback: { score: 100 } },
  };
  for (const [what, options] of Object.entries(bad)) {
    test(`feedback with ${what} is denied`, async () => {
      await assertFails(rate("alice", options));
    });
  }
});

describe("totals can't be faked", () => {
  test("feedback has to update the player's totals", async () => {
    await assertFails(rate("alice", { withStats: false }));
  });

  test("totals can't go up without new feedback", async () => {
    await assertFails(rate("alice", { withFeedback: false }));
  });

  test("totals can't go up twice for the same feedback", async () => {
    await assertSucceeds(rate("alice", { to: "bob" }));
    await assertFails(rate("alice", { to: "bob", withFeedback: false }));
  });

  test("negative feedback can't add to the positive count", async () => {
    await assertFails(
      rate("alice", { rating: "negative", stats: { positive: increment(1), negative: increment(0) } }),
    );
  });

  test("one feedback adds exactly one", async () => {
    await assertFails(rate("alice", { stats: { positive: increment(2) } }));
  });

  test("one feedback can't also erase old negatives", async () => {
    await seed("sportsmanship/bob", { positive: 4, negative: 3, lastFeedbackId: "old", updatedAt: Timestamp.now() });
    await assertFails(rate("alice", { stats: { negative: 0 } }));
  });

  test("feedback for one player can't change another player's totals", async () => {
    await assertFails(rate("alice", { to: "bob", statsFor: "carol" }));
  });

  test("totals can't have extra fields", async () => {
    await assertFails(rate("alice", { stats: { score: 100 } }));
  });

  test("players can't edit or set their own totals", async () => {
    await seed("sportsmanship/bob", { positive: 4, negative: 3, lastFeedbackId: "old", updatedAt: Timestamp.now() });
    await assertFails(updateDoc(doc(as("bob"), "sportsmanship/bob"), { negative: 0 }));
    await assertFails(
      setDoc(doc(as("carol"), "sportsmanship/carol"), {
        positive: 100,
        negative: 0,
        lastFeedbackId: "x",
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe("feedback is permanent", () => {
  beforeEach(async () => {
    await assertSucceeds(rate("alice", { to: "bob", rating: "negative", feedback: { comment: "Late" } }));
  });

  test("the rater can't change it", async () => {
    await assertFails(updateDoc(doc(as("alice"), "feedback/g1_alice_bob"), { rating: "positive" }));
    await assertFails(updateDoc(doc(as("alice"), "feedback/g1_alice_bob"), { comment: "" }));
  });

  test("nobody can delete feedback or totals", async () => {
    await assertFails(deleteDoc(doc(as("alice"), "feedback/g1_alice_bob")));
    await assertFails(deleteDoc(doc(as("bob"), "feedback/g1_alice_bob")));
    await assertFails(deleteDoc(doc(as("bob"), "sportsmanship/bob")));
  });
});

describe("reading feedback", () => {
  beforeEach(async () => {
    await assertSucceeds(rate("alice", { to: "bob" }));
  });

  test("feedback and totals are public to signed-in users", async () => {
    await assertSucceeds(getDoc(doc(as("dave"), "feedback/g1_alice_bob")));
    await assertSucceeds(getDoc(doc(as("dave"), "sportsmanship/bob")));
  });

  test("signed-out visitors can't read them", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "feedback/g1_alice_bob")));
    await assertFails(getDoc(doc(db, "sportsmanship/bob")));
  });
});
