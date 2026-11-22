// Tests for friends.js, run against the emulators with the real security rules.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { BOULDER, closeAll, hoursFromNow, signedInAs, signedOut, startTestEnv } from "./helpers.js";

let env, alice, bob, carol, dave, erin, nobody;
const ts = (date) => Timestamp.fromDate(date);

before(async () => {
  env = await startTestEnv();
  await env.clearFirestore();
  [alice, bob, carol, dave, erin] = await Promise.all(["Alice", "Bob", "Carol", "Dave", "Erin"].map(signedInAs));
  nobody = await signedOut();
});

// Everyone but Erin has a profile, like an account that never finished
// signing up. Each test starts with no friendships.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore(); // call firestore() only once per context
    await setDoc(doc(db, "users", alice.uid), { displayName: "Alice", city: "Boulder", sports: ["soccer"] });
    await setDoc(doc(db, "users", bob.uid), { displayName: "Bob", city: "Denver", sports: ["tennis"] });
    await setDoc(doc(db, "users", carol.uid), { displayName: "Carol" });
    await setDoc(doc(db, "users", dave.uid), { displayName: "Dave" });
  });
});

after(async () => {
  await closeAll([alice, bob, carol, dave, erin, nobody]);
  await env.cleanup();
});

// Expect a promise to reject with an error carrying `code`.
async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    return true;
  });
}

const ids = (list) => list.map((item) => item.userId);

// Wait until check() returns true, for live updates.
async function eventually(check, what) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("friend requests", () => {
  test("sending one shows it to both players, with names", async () => {
    assert.equal(await alice.sendFriendRequest(bob.uid), "outgoing");

    const mine = await alice.listFriends();
    assert.deepEqual(ids(mine.outgoing), [bob.uid]);
    assert.equal(mine.outgoing[0].displayName, "Bob");
    assert.equal(mine.outgoing[0].city, "Denver");
    assert.deepEqual(mine.outgoing[0].sports, ["tennis"]);
    assert.equal(mine.outgoing[0].relation, "outgoing");
    assert.ok(mine.outgoing[0].createdAt instanceof Date);
    assert.deepEqual(mine.friends, []);

    const theirs = await bob.listFriends();
    assert.deepEqual(ids(theirs.incoming), [alice.uid]);
    assert.equal(theirs.incoming[0].displayName, "Alice");
    assert.deepEqual(theirs.outgoing, []);
  });

  test("sending twice is fine", async () => {
    await alice.sendFriendRequest(bob.uid);
    assert.equal(await alice.sendFriendRequest(bob.uid), "outgoing");
    assert.equal((await bob.listFriends()).incoming.length, 1);
  });

  test("you can't ask yourself, or a player without a profile", async () => {
    await rejectsWith(alice.sendFriendRequest(alice.uid), "friends/self");
    await rejectsWith(alice.sendFriendRequest(erin.uid), "friends/not-found");
    await rejectsWith(alice.sendFriendRequest("no-such-player"), "friends/not-found");
    await rejectsWith(alice.sendFriendRequest(""), "friends/not-found");
  });

  test("accepting makes you friends on both sides", async () => {
    await alice.sendFriendRequest(bob.uid);
    assert.equal(await bob.acceptFriendRequest(alice.uid), "friend");

    const mine = await alice.listFriends();
    assert.deepEqual(ids(mine.friends), [bob.uid]);
    assert.ok(mine.friends[0].acceptedAt instanceof Date);
    assert.deepEqual(mine.outgoing, []);
    assert.deepEqual(ids((await bob.listFriends()).friends), [alice.uid]);
    assert.equal(await bob.acceptFriendRequest(alice.uid), "friend"); // twice is fine
    assert.equal(await alice.sendFriendRequest(bob.uid), "friend"); // already friends
  });

  test("only the player who was asked can accept", async () => {
    await alice.sendFriendRequest(bob.uid);
    await rejectsWith(alice.acceptFriendRequest(bob.uid), "friends/not-yours");
    await rejectsWith(carol.acceptFriendRequest(alice.uid), "friends/no-request");
  });

  test("asking someone who already asked you accepts their request", async () => {
    await carol.sendFriendRequest(dave.uid);
    assert.equal(await dave.sendFriendRequest(carol.uid), "friend");
    assert.deepEqual(ids((await carol.listFriends()).friends), [dave.uid]);
  });

  test("two players asking each other at the same moment end up friends", async () => {
    const results = await Promise.all([alice.sendFriendRequest(bob.uid), bob.sendFriendRequest(alice.uid)]);
    assert.ok(results.includes("friend"), `got ${results}`);
    assert.deepEqual(ids((await alice.listFriends()).friends), [bob.uid]);
    assert.deepEqual(ids((await bob.listFriends()).friends), [alice.uid]);
  });

  test("removeFriend declines, cancels, and unfriends", async () => {
    await alice.sendFriendRequest(bob.uid);
    await bob.removeFriend(alice.uid); // decline
    assert.deepEqual((await alice.listFriends()).outgoing, []);

    await alice.sendFriendRequest(carol.uid);
    await alice.removeFriend(carol.uid); // cancel
    assert.deepEqual((await carol.listFriends()).incoming, []);

    await alice.sendFriendRequest(dave.uid);
    await dave.acceptFriendRequest(alice.uid);
    await dave.removeFriend(alice.uid); // unfriend
    assert.deepEqual((await alice.listFriends()).friends, []);

    await alice.removeFriend(dave.uid); // nothing left to remove: fine
  });

  test("friends are sorted by name, requests newest first", async () => {
    await dave.sendFriendRequest(alice.uid);
    await bob.sendFriendRequest(alice.uid);
    await alice.acceptFriendRequest(dave.uid);
    await alice.acceptFriendRequest(bob.uid);
    await carol.sendFriendRequest(alice.uid);
    assert.deepEqual(ids((await alice.listFriends()).friends), [bob.uid, dave.uid]);
    assert.deepEqual(ids((await alice.listFriends()).incoming), [carol.uid]);
  });

  test("signed-out visitors get a clear error", async () => {
    await rejectsWith(nobody.sendFriendRequest(bob.uid), "events/not-signed-in");
    assert.throws(() => nobody.watchFriends(() => {}), { code: "events/not-signed-in" });
  });
});

describe("watchFriends", () => {
  test("shows requests as they arrive and when they're accepted", async () => {
    let latest = null;
    const stop = bob.watchFriends((value) => {
      latest = value;
    });
    try {
      await eventually(() => latest !== null, "the first list");
      assert.deepEqual(latest, { friends: [], incoming: [], outgoing: [] });

      await alice.sendFriendRequest(bob.uid);
      await eventually(() => latest.incoming.length === 1, "the request");
      assert.equal(latest.incoming[0].displayName, "Alice");

      await bob.acceptFriendRequest(alice.uid);
      await eventually(() => latest.friends.length === 1 && latest.incoming.length === 0, "the friend");
      assert.equal(latest.friends[0].userId, alice.uid);
    } finally {
      stop();
    }
  });
});

describe("findPlayers", () => {
  test("finds players by the start of their name, whatever the first letter's case", async () => {
    assert.deepEqual(ids(await alice.findPlayers("Bo")), [bob.uid]);
    assert.deepEqual(ids(await alice.findPlayers("bob")), [bob.uid]);
    assert.deepEqual(ids(await alice.findPlayers("  car ")), [carol.uid]);
    const [found] = await alice.findPlayers("Bob");
    assert.deepEqual(found, { userId: bob.uid, displayName: "Bob", photoURL: null, city: "Denver", sports: ["tennis"] });
  });

  test("leaves you out, and finds nothing for blank text", async () => {
    assert.deepEqual(ids(await alice.findPlayers("Al")), []);
    assert.deepEqual(await alice.findPlayers("   "), []);
    assert.deepEqual(await alice.findPlayers("Zed"), []);
  });
});

describe("listFriendsGames", () => {
  let count = 0;
  async function seedGame(overrides = {}) {
    const id = `game${++count}`;
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), "events", id), {
        sportId: "soccer",
        title: "",
        description: "",
        skillLevel: "casual",
        startTime: ts(hoursFromNow(2)),
        endTime: ts(hoursFromNow(4)),
        location: { name: "North Boulder Park", address: "", ...BOULDER },
        playerLimit: 10,
        hostId: carol.uid,
        hostName: "Carol",
        participantIds: [carol.uid],
        status: "scheduled",
        createdAt: Timestamp.now(),
        ...overrides,
      }),
    );
    return id;
  }

  test("lists upcoming games your friends are going to, soonest first", async () => {
    const later = await seedGame({ participantIds: [carol.uid, bob.uid, dave.uid], startTime: ts(hoursFromNow(30)), endTime: ts(hoursFromNow(31)) });
    const soon = await seedGame({ participantIds: [carol.uid, bob.uid] });
    await seedGame({ participantIds: [carol.uid, bob.uid], status: "cancelled" });
    await seedGame({ participantIds: [carol.uid, bob.uid], startTime: ts(hoursFromNow(-3)), endTime: ts(hoursFromNow(-1)) });
    await seedGame({ participantIds: [carol.uid] }); // no friends in it

    const games = await alice.listFriendsGames([bob.uid, dave.uid]);
    assert.deepEqual(games.map((g) => g.id), [soon, later]);
    assert.deepEqual(games[0].friendIds, [bob.uid]);
    assert.deepEqual(games[1].friendIds, [bob.uid, dave.uid]);
    assert.equal(games[0].playerCount, 2);
    assert.equal(games[0].isGoing, false);
    assert.ok(games[0].startTime instanceof Date);
  });

  test("returns nothing without friends", async () => {
    assert.deepEqual(await alice.listFriendsGames([]), []);
  });
});
