// Security rules tests for the friends list (friendships collection): writes
// the app would never make on purpose, to prove Firestore itself refuses them.
import { after, before, beforeEach, describe, test } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { startTestEnv } from "./helpers.js";

let env;
const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await startTestEnv();
});

// alice, bob, and carol have profiles; dave signed up but never made one.
beforeEach(async () => {
  await env.clearFirestore();
  for (const name of ["alice", "bob", "carol"]) {
    await seed(`users/${name}`, { displayName: name[0].toUpperCase() + name.slice(1) });
  }
});

after(async () => {
  await env.cleanup();
});

async function seed(path, data) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path), data));
}

// A request as friends.js sends it, from `from` to `to`; override any field.
function request(from, to, overrides = {}) {
  return {
    userIds: from < to ? [from, to] : [to, from],
    requesterId: from,
    addresseeId: to,
    status: "pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

const pair = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const ask = (from, to, overrides = {}, id = pair(from, to)) =>
  setDoc(doc(as(from), "friendships", id), request(from, to, overrides));

// alice asked bob, and he hasn't answered yet.
async function seedRequest(status = "pending") {
  await seed("friendships/alice_bob", {
    ...request("alice", "bob"),
    createdAt: Timestamp.now(),
    status,
    ...(status === "accepted" ? { acceptedAt: Timestamp.now() } : {}),
  });
}

describe("friendships rules: asking", () => {
  test("you can ask another player with a profile", async () => {
    await assertSucceeds(ask("alice", "bob"));
    await assertSucceeds(ask("carol", "bob")); // the other ID order
  });

  test("the document ID must be the two players, sorted", async () => {
    await assertFails(ask("alice", "bob", {}, "bob_alice"));
    await assertFails(ask("alice", "bob", {}, "alice_carol"));
    await assertFails(ask("alice", "bob", {}, "random-id"));
  });

  test("you can't ask for someone else, or ask yourself", async () => {
    await assertFails(setDoc(doc(as("carol"), "friendships", "alice_bob"), request("alice", "bob")));
    await assertFails(ask("alice", "alice", {}, "alice_alice"));
  });

  test("you can't ask a player who has no profile", async () => {
    await assertFails(ask("alice", "dave"));
  });

  test("a request starts out pending, with the server's time and sorted IDs", async () => {
    await assertFails(ask("alice", "bob", { status: "accepted" }));
    await assertFails(ask("alice", "bob", { createdAt: Timestamp.fromDate(new Date()) }));
    await assertFails(ask("alice", "bob", { userIds: ["bob", "alice"] }));
    await assertFails(ask("alice", "bob", { userIds: ["alice", "carol"] }));
  });

  test("a request has exactly the expected fields", async () => {
    await assertFails(ask("alice", "bob", { note: "hi" }));
    await assertFails(ask("alice", "bob", { acceptedAt: serverTimestamp() }));
    const { createdAt, ...missing } = request("alice", "bob");
    await assertFails(setDoc(doc(as("alice"), "friendships", "alice_bob"), missing));
  });

  test("you can't ask again once there's a document", async () => {
    await seedRequest();
    await assertFails(ask("alice", "bob"));
    await assertFails(ask("bob", "alice"));
  });

  test("signed-out visitors can't ask anyone", async () => {
    await assertFails(setDoc(doc(anon(), "friendships", "alice_bob"), request("alice", "bob")));
  });
});

describe("friendships rules: answering", () => {
  const accept = (uid, overrides = {}) =>
    updateDoc(doc(as(uid), "friendships", "alice_bob"), {
      status: "accepted",
      acceptedAt: serverTimestamp(),
      ...overrides,
    });

  test("the player who was asked can accept", async () => {
    await seedRequest();
    await assertSucceeds(accept("bob"));
  });

  test("nobody else can accept, including the one who asked", async () => {
    await seedRequest();
    await assertFails(accept("alice"));
    await assertFails(accept("carol"));
  });

  test("accepting changes only the status and acceptedAt, with the server's time", async () => {
    await seedRequest();
    await assertFails(accept("bob", { acceptedAt: Timestamp.fromDate(new Date()) }));
    await assertFails(accept("bob", { requesterId: "bob" }));
    await assertFails(accept("bob", { status: "blocked" }));
    await assertFails(updateDoc(doc(as("bob"), "friendships", "alice_bob"), { status: "accepted" }));
  });

  test("friends can't be turned back into a request", async () => {
    await seedRequest("accepted");
    await assertFails(
      updateDoc(doc(as("bob"), "friendships", "alice_bob"), { status: "pending", acceptedAt: serverTimestamp() }),
    );
  });

  test("either player can delete it, nobody else can", async () => {
    await seedRequest();
    await assertFails(deleteDoc(doc(as("carol"), "friendships", "alice_bob")));
    await assertFails(deleteDoc(doc(anon(), "friendships", "alice_bob")));
    await assertSucceeds(deleteDoc(doc(as("bob"), "friendships", "alice_bob"))); // decline
    await seedRequest("accepted");
    await assertSucceeds(deleteDoc(doc(as("alice"), "friendships", "alice_bob"))); // unfriend
  });
});

describe("friendships rules: reading", () => {
  test("only the two players can read their friendship", async () => {
    await seedRequest();
    await assertSucceeds(getDoc(doc(as("alice"), "friendships", "alice_bob")));
    await assertSucceeds(getDoc(doc(as("bob"), "friendships", "alice_bob")));
    await assertFails(getDoc(doc(as("carol"), "friendships", "alice_bob")));
    await assertFails(getDoc(doc(anon(), "friendships", "alice_bob")));
  });

  test("you can check for a request that doesn't exist yet, if it would be yours", async () => {
    await assertSucceeds(getDoc(doc(as("alice"), "friendships", "alice_carol")));
    await assertFails(getDoc(doc(as("alice"), "friendships", "bob_carol")));
  });

  test("lists must ask for your own friendships", async () => {
    await seedRequest();
    const mine = (uid, who = uid) =>
      getDocs(query(collection(as(uid), "friendships"), where("userIds", "array-contains", who)));
    await assertSucceeds(mine("alice"));
    await assertSucceeds(mine("carol"));
    await assertFails(mine("carol", "alice"));
    await assertFails(getDocs(collection(as("alice"), "friendships")));
    await assertFails(
      getDocs(query(collection(as("bob"), "friendships"), where("addresseeId", "==", "bob"))),
    );
  });
});
