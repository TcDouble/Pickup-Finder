// Tests the settings rule in firebase/firestore.rules directly, and the
// friendships rule's check of the "Friend requests from" setting.
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { startTestEnv } from "./emulator.js";

describe("firestore.rules (settings)", () => {
  let testEnv;

  before(async () => {
    testEnv = await startTestEnv();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc("users/alice").set({ displayName: "Alice" });
      await db.doc("users/bob").set({ displayName: "Bob" });
    });
  });

  after(async () => {
    await testEnv?.clearFirestore();
    await testEnv?.cleanup();
  });

  const as = (uid) => testEnv.authenticatedContext(uid).firestore();
  const mine = (uid = "alice") => doc(as(uid), `settings/${uid}`);
  const save = (data, uid = "alice") => setDoc(mine(uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });

  it("lets you save every setting", async () => {
    await assertSucceeds(
      save({
        showCity: false,
        privateCity: "Boulder",
        homeArea: { label: "Folsom Field", lat: 40.0092, lng: -105.2669 },
        units: "km",
        startSports: ["soccer"],
        friendRequests: "nobody",
      }),
    );
  });

  it("lets you read and delete your own settings", async () => {
    await save({ units: "km" });
    await assertSucceeds(getDoc(mine()));
    await assertSucceeds(deleteDoc(mine()));
  });

  it("won't let anyone else read, change or delete them", async () => {
    await save({ units: "km" });
    await assertFails(getDoc(doc(as("bob"), "settings/alice")));
    await assertFails(setDoc(doc(as("bob"), "settings/alice"), { units: "mi", updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(as("bob"), "settings/alice")));
  });

  it("won't let a signed-out visitor read them", async () => {
    await save({ units: "km" });
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "settings/alice")));
  });

  it("rejects fields that aren't settings", async () => {
    await assertFails(save({ isAdmin: true }));
  });

  it("rejects bad values", async () => {
    await assertFails(save({ units: "ft" }));
    await assertFails(save({ startSports: ["quidditch"] }));
    await assertFails(save({ friendRequests: "maybe" }));
    await assertFails(save({ showCity: "yes" }));
    await assertFails(save({ privateCity: "x".repeat(61) }));
    await assertFails(save({ homeArea: { label: "x", lat: 91, lng: 0 } }));
    await assertFails(save({ homeArea: { label: "x", lat: 0, lng: 0, extra: 1 } }));
  });

  it("requires the server's time on every save", async () => {
    await assertFails(setDoc(mine(), { units: "km", updatedAt: new Date("2020-01-01") }));
  });

  describe("friend requests", () => {
    const request = (from, to) =>
      setDoc(doc(as(from), "friendships", [from, to].sort().join("_")), {
        userIds: [from, to].sort(),
        requesterId: from,
        addresseeId: to,
        status: "pending",
        createdAt: serverTimestamp(),
      });

    it("go through to a player with no settings", async () => {
      await assertSucceeds(request("alice", "bob"));
    });

    it("go through to a player who allows everyone", async () => {
      await save({ friendRequests: "everyone" }, "bob");
      await assertSucceeds(request("alice", "bob"));
    });

    it("are refused for a player who turned them off", async () => {
      await save({ friendRequests: "nobody" }, "bob");
      await assertFails(request("alice", "bob"));
    });
  });
});
