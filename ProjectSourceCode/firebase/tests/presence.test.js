// Tests for presence.js (who's online now) and its security rules, run
// against the emulators with the real rules.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from "firebase/firestore";
import { closeAll, signedInAs, signedOut, startTestEnv } from "./helpers.js";

let env, alice, bob, carol, erin, nobody;
const MINUTE = 60 * 1000;
const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await startTestEnv();
  await env.clearFirestore();
  [alice, bob, carol, erin] = await Promise.all(["Alice", "Bob", "Carol", "Erin"].map(signedInAs));
  nobody = await signedOut();
});

// Everyone but Erin has a profile. Nobody is online at the start of a test.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", alice.uid), { displayName: "Alice", city: "Boulder" });
    await setDoc(doc(db, "users", bob.uid), { displayName: "Bob" });
    await setDoc(doc(db, "users", carol.uid), { displayName: "Carol" });
    await setDoc(doc(db, "users", "rules-alice"), { displayName: "Alice" });
  });
});

after(async () => {
  await closeAll([alice, bob, carol, erin, nobody]);
  await env.cleanup();
});

async function seedPresence(uid, data) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "presence", uid), data));
}

async function readPresence(uid) {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore(), "presence", uid))).data();
  });
  return data;
}

// Wait until check() returns true, for live updates.
async function eventually(check, what) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("presence rules", () => {
  const write = (uid, data, owner = uid) => setDoc(doc(as(uid), "presence", owner), data);
  const online = { state: "online", lastSeen: serverTimestamp() };

  test("you can check in, check out, and hide, with the server's time", async () => {
    await assertSucceeds(write("rules-alice", online));
    await assertSucceeds(write("rules-alice", { state: "offline", lastSeen: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as("rules-alice"), "presence", "rules-alice"), { state: "online", lastSeen: serverTimestamp() }));
    await assertSucceeds(write("rules-alice", { state: "hidden", lastSeen: null }));
  });

  test("you can't write someone else's presence", async () => {
    await assertFails(write("rules-alice", online, alice.uid));
    await assertFails(setDoc(doc(anon(), "presence", "rules-alice"), online));
  });

  test("the time must be the server's, and hidden players keep no time", async () => {
    await assertFails(write("rules-alice", { state: "online", lastSeen: Timestamp.now() }));
    await assertFails(write("rules-alice", { state: "online", lastSeen: Timestamp.fromMillis(Date.now() + 60 * MINUTE) }));
    await assertFails(write("rules-alice", { state: "online", lastSeen: null }));
    await assertFails(write("rules-alice", { state: "hidden", lastSeen: serverTimestamp() }));
  });

  test("only the known states and fields", async () => {
    await assertFails(write("rules-alice", { state: "away", lastSeen: serverTimestamp() }));
    await assertFails(write("rules-alice", { state: "online" }));
    await assertFails(write("rules-alice", { ...online, location: "Boulder" }));
  });

  test("you need a profile to show up", async () => {
    await assertFails(write("rules-nobody", online));
  });

  test("signed-in players can read anyone's presence; visitors can't", async () => {
    await seedPresence("rules-alice", { state: "online", lastSeen: Timestamp.now() });
    await assertSucceeds(getDoc(doc(as("rules-bob"), "presence", "rules-alice")));
    await assertFails(getDoc(doc(anon(), "presence", "rules-alice")));
  });

  test("only you can delete yours", async () => {
    await seedPresence("rules-alice", { state: "online", lastSeen: Timestamp.now() });
    await assertFails(deleteDoc(doc(as("rules-bob"), "presence", "rules-alice")));
    await assertSucceeds(deleteDoc(doc(as("rules-alice"), "presence", "rules-alice")));
  });
});

describe("checking in and out", () => {
  test("checkIn marks you online, checkOut marks you offline", async () => {
    await alice.checkIn();
    let seen = await bob.getPresence([alice.uid]);
    assert.equal(seen.get(alice.uid).state, "online");
    assert.equal(seen.get(alice.uid).online, true);
    assert.ok(seen.get(alice.uid).lastSeen instanceof Date);

    await alice.checkOut();
    seen = await bob.getPresence([alice.uid, carol.uid]);
    assert.equal(seen.get(alice.uid).state, "offline");
    assert.equal(seen.get(alice.uid).online, false);
    assert.ok(seen.get(alice.uid).lastSeen instanceof Date);
    assert.equal(seen.has(carol.uid), false); // never opened the app
  });

  test("hiding keeps no time, and checking out while hidden changes nothing", async () => {
    await alice.checkIn();
    await alice.setShowOnline(false);
    assert.equal(await alice.getShowOnline(), false);
    assert.deepEqual(await readPresence(alice.uid), { state: "hidden", lastSeen: null });

    await alice.checkOut();
    assert.deepEqual(await readPresence(alice.uid), { state: "hidden", lastSeen: null });

    await alice.setShowOnline(true);
    assert.equal(await alice.getShowOnline(), true);
    assert.equal((await readPresence(alice.uid)).state, "online");
  });

  test("players who never checked in show up by default", async () => {
    assert.equal(await carol.getShowOnline(), true);
  });

  test("you can't check in without a profile", async () => {
    await assert.rejects(erin.checkIn(), { code: "permission-denied" });
  });

  test("signed-out visitors get a clear error", async () => {
    await assert.rejects(nobody.checkIn(), { code: "events/not-signed-in" });
  });
});

describe("watchOnlinePlayers", () => {
  test("lists other players online now, with their profiles, live", async () => {
    let latest = null;
    const stop = bob.watchOnlinePlayers((players) => {
      latest = players;
    });
    try {
      await bob.checkIn(); // you aren't in your own list
      await eventually(() => latest !== null, "the first list");
      assert.deepEqual(latest, []);

      await alice.checkIn();
      await eventually(() => latest.length === 1, "Alice to come online");
      assert.equal(latest[0].userId, alice.uid);
      assert.equal(latest[0].displayName, "Alice");
      assert.equal(latest[0].city, "Boulder");
      assert.ok(latest[0].lastSeen instanceof Date);

      await alice.checkOut();
      await eventually(() => latest.length === 0, "Alice to go offline");
    } finally {
      stop();
    }
  });

  test("leaves out players who stopped checking in, hid, or have no profile", async () => {
    await seedPresence(alice.uid, { state: "online", lastSeen: Timestamp.fromMillis(Date.now() - 10 * MINUTE) });
    await seedPresence(carol.uid, { state: "hidden", lastSeen: null });
    await seedPresence("deleted-player", { state: "online", lastSeen: Timestamp.now() });

    let latest = null;
    const stop = bob.watchOnlinePlayers((players) => {
      latest = players;
    });
    try {
      await eventually(() => latest !== null, "the first list");
      assert.deepEqual(latest, []);
    } finally {
      stop();
    }
  });
});
