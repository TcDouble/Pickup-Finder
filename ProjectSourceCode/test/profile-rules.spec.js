// Tests the users rule in firebase/firestore.rules directly: who can read,
// change and delete a profile, and which fields and values are allowed.
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { startTestEnv } from "./emulator.js";

describe("firestore.rules (user profiles)", () => {
  let testEnv;

  before(async () => {
    testEnv = await startTestEnv();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled((ctx) =>
      ctx.firestore().doc("users/alice").set({ displayName: "Alice", createdAt: new Date("2026-11-01") }),
    );
  });

  after(async () => {
    await testEnv?.clearFirestore();
    await testEnv?.cleanup();
  });

  const as = (uid) => testEnv.authenticatedContext(uid).firestore();
  const alice = () => doc(as("alice"), "users/alice");

  it("lets you update your own profile", async () => {
    await assertSucceeds(
      updateDoc(alice(), {
        displayName: "Alice A",
        city: "Boulder",
        sports: ["soccer"],
        sportLevels: { soccer: "competitive" },
        bio: "Hi",
        photoURL: null,
      }),
    );
  });

  it("still allows a profile with just a display name", async () => {
    await assertSucceeds(setDoc(doc(as("bob"), "users/bob"), { displayName: "Bob" }));
  });

  it("won't let you change someone else's profile", async () => {
    await assertFails(updateDoc(doc(as("bob"), "users/alice"), { bio: "hacked" }));
  });

  it("rejects fields that aren't part of a profile", async () => {
    await assertFails(updateDoc(alice(), { email: "alice@example.com" }));
  });

  it("rejects an empty or too-long display name", async () => {
    await assertFails(updateDoc(alice(), { displayName: "" }));
    await assertFails(updateDoc(alice(), { displayName: "x".repeat(31) }));
  });

  it("rejects a city over 60 characters or an About over 300", async () => {
    await assertFails(updateDoc(alice(), { city: "x".repeat(61) }));
    await assertFails(updateDoc(alice(), { bio: "x".repeat(301) }));
  });

  it("rejects an unknown sport or level", async () => {
    await assertFails(updateDoc(alice(), { sports: ["quidditch"] }));
    await assertFails(updateDoc(alice(), { sportLevels: { quidditch: "casual" } }));
    await assertFails(updateDoc(alice(), { sportLevels: { soccer: "pro" } }));
  });

  it("won't let you change when you joined", async () => {
    await assertFails(updateDoc(alice(), { createdAt: new Date("2020-01-01") }));
  });

  it("lets you delete your own profile", async () => {
    await assertSucceeds(deleteDoc(alice()));
  });

  it("won't let you delete someone else's profile", async () => {
    await assertFails(deleteDoc(doc(as("bob"), "users/alice")));
  });

  it("won't let a signed-out visitor read profiles", async () => {
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "users/alice")));
  });

  it("lets any signed-in player read profiles", async () => {
    await assertSucceeds(getDoc(doc(as("bob"), "users/alice")));
  });
});
