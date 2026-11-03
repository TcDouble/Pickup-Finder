// Security rules tests: writes the app would never make on purpose, to prove
// Firestore itself refuses them.
import { after, before, beforeEach, describe, test } from "node:test";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  arrayRemove,
  arrayUnion,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { BOULDER, hoursFromNow, startTestEnv } from "./helpers.js";

let env;
const as = (uid) => env.authenticatedContext(uid).firestore();
const ts = (date) => Timestamp.fromDate(date);

// A valid new event document hosted by `uid`.
function newEvent(uid, overrides = {}) {
  return {
    sportId: "basketball",
    title: "5v5",
    description: "",
    skillLevel: "casual",
    startTime: ts(hoursFromNow(2)),
    endTime: ts(hoursFromNow(4)),
    location: { name: "North Boulder Park", address: "", ...BOULDER },
    playerLimit: 4,
    hostId: uid,
    hostName: "Alice",
    participantIds: [uid],
    status: "scheduled",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

// Put an event in the database directly, skipping the rules.
async function seed(id, overrides = {}) {
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), "events", id), {
      ...newEvent("alice"),
      createdAt: Timestamp.now(),
      ...overrides,
    }),
  );
}

before(async () => {
  env = await startTestEnv();
});
after(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
});

describe("reading events", () => {
  test("signed-in users can read events", async () => {
    await seed("e1");
    await assertSucceeds(getDoc(doc(as("bob"), "events/e1")));
  });

  test("signed-out visitors can't", async () => {
    await seed("e1");
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "events/e1")));
  });
});

describe("creating events", () => {
  test("a valid event hosted by yourself is allowed", async () => {
    await assertSucceeds(setDoc(doc(as("alice"), "events/e1"), newEvent("alice")));
  });

  const bad = {
    "hosted by someone else": { hostId: "bob" },
    "that starts with other players": { participantIds: ["alice", "bob"] },
    "that starts with no players": { participantIds: [] },
    "that starts out cancelled": { status: "cancelled" },
    "that starts in the past": { startTime: ts(hoursFromNow(-1)) },
    "that ends before it starts": { endTime: ts(hoursFromNow(1)) },
    "that lasts more than 12 hours": { endTime: ts(hoursFromNow(15)) },
    "with an unknown sport": { sportId: "quidditch" },
    "with a player limit of 1": { playerLimit: 1 },
    "with a player limit over 50": { playerLimit: 51 },
    "with a fractional player limit": { playerLimit: 2.5 },
    "with a client-side createdAt": { createdAt: Timestamp.now() },
    "with a latitude off the map": { location: { name: "X", address: "", lat: 100, lng: 0 } },
    "with a location without a name": { location: { name: "", address: "", ...BOULDER } },
    "with a location without coordinates": { location: { name: "X", address: "" } },
    "with an unknown skill level": { skillLevel: "pro" },
    "with a description over 500 characters": { description: "x".repeat(501) },
    "with an extra field": { secret: true },
  };
  for (const [label, overrides] of Object.entries(bad)) {
    test(`rejects an event ${label}`, async () => {
      await assertFails(setDoc(doc(as("alice"), "events/e1"), newEvent("alice", overrides)));
    });
  }

  test("rejects an event missing a field", async () => {
    const data = newEvent("alice");
    delete data.title;
    await assertFails(setDoc(doc(as("alice"), "events/e1"), data));
  });

  test("signed-out visitors can't create events", async () => {
    await assertFails(
      setDoc(doc(env.unauthenticatedContext().firestore(), "events/e1"), newEvent("alice")),
    );
  });
});

describe("RSVPs", () => {
  beforeEach(async () => {
    await seed("e1", { participantIds: ["alice", "carol"], playerLimit: 3 });
  });
  const ref = (uid) => doc(as(uid), "events/e1");

  test("you can RSVP yourself", async () => {
    await assertSucceeds(updateDoc(ref("bob"), { participantIds: arrayUnion("bob") }));
  });

  test("you can't RSVP someone else", async () => {
    await assertFails(updateDoc(ref("bob"), { participantIds: arrayUnion("dave") }));
  });

  test("you can't add yourself and someone else", async () => {
    await assertFails(updateDoc(ref("bob"), { participantIds: ["alice", "carol", "bob", "dave"] }));
  });

  test("you can't swap someone out for yourself", async () => {
    await assertFails(updateDoc(ref("bob"), { participantIds: ["alice", "bob"] }));
  });

  test("you can't add yourself twice", async () => {
    await assertFails(updateDoc(ref("carol"), { participantIds: ["alice", "carol", "carol"] }));
  });

  test("you can't change anything else while RSVPing", async () => {
    await assertFails(
      updateDoc(ref("bob"), { participantIds: arrayUnion("bob"), description: "mine now" }),
    );
  });

  test("you can't RSVP to a full game", async () => {
    await assertSucceeds(updateDoc(ref("bob"), { participantIds: arrayUnion("bob") }));
    await assertFails(updateDoc(ref("dave"), { participantIds: arrayUnion("dave") }));
  });

  test("you can't RSVP to a cancelled game", async () => {
    await seed("e1", { status: "cancelled" });
    await assertFails(updateDoc(ref("bob"), { participantIds: arrayUnion("bob") }));
  });

  test("you can't RSVP once the game has started", async () => {
    await seed("e1", { startTime: ts(hoursFromNow(-1)), endTime: ts(hoursFromNow(1)) });
    await assertFails(updateDoc(ref("bob"), { participantIds: arrayUnion("bob") }));
  });

  test("you can cancel your own RSVP", async () => {
    await assertSucceeds(updateDoc(ref("carol"), { participantIds: arrayRemove("carol") }));
  });

  test("you can't remove someone else", async () => {
    await assertFails(updateDoc(ref("bob"), { participantIds: arrayRemove("carol") }));
  });

  test("the host can't leave their own game", async () => {
    await assertFails(updateDoc(ref("alice"), { participantIds: arrayRemove("alice") }));
  });

  test("the host can't remove players", async () => {
    await assertFails(updateDoc(ref("alice"), { participantIds: arrayRemove("carol") }));
  });
});

describe("host edits", () => {
  beforeEach(async () => {
    await seed("e1", { participantIds: ["alice", "carol", "dave"], playerLimit: 4 });
  });
  const ref = (uid) => doc(as(uid), "events/e1");

  test("the host can change the details", async () => {
    await assertSucceeds(
      updateDoc(ref("alice"), {
        description: "Moved to court 2",
        playerLimit: 6,
        startTime: ts(hoursFromNow(3)),
        endTime: ts(hoursFromNow(5)),
      }),
    );
  });

  test("the host can cancel", async () => {
    await assertSucceeds(updateDoc(ref("alice"), { status: "cancelled" }));
  });

  test("other players can't change the details", async () => {
    await assertFails(updateDoc(ref("carol"), { description: "hi" }));
  });

  test("other players can't cancel", async () => {
    await assertFails(updateDoc(ref("carol"), { status: "cancelled" }));
  });

  test("the host can't hand the game to someone else", async () => {
    await assertFails(updateDoc(ref("alice"), { hostId: "carol" }));
  });

  test("the host can't change the sport", async () => {
    await assertFails(updateDoc(ref("alice"), { sportId: "soccer" }));
  });

  test("the host can't set the limit below the players already going", async () => {
    await assertFails(updateDoc(ref("alice"), { playerLimit: 2 }));
  });

  test("the host can't move the game into the past", async () => {
    await assertFails(
      updateDoc(ref("alice"), { startTime: ts(hoursFromNow(-2)), endTime: ts(hoursFromNow(-1)) }),
    );
  });

  test("a cancelled game can't be edited or brought back", async () => {
    await seed("e1", { status: "cancelled" });
    await assertFails(updateDoc(ref("alice"), { description: "back on" }));
    await assertFails(updateDoc(ref("alice"), { status: "scheduled" }));
  });

  test("nobody can delete a game, not even the host", async () => {
    await assertFails(deleteDoc(ref("alice")));
  });
});

describe("user profiles", () => {
  test("you can write your own profile", async () => {
    await assertSucceeds(setDoc(doc(as("alice"), "users/alice"), { displayName: "Alice" }));
  });

  test("you can't write someone else's", async () => {
    await assertFails(setDoc(doc(as("alice"), "users/bob"), { displayName: "Bob" }));
  });

  test("signed-out visitors can't read profiles", async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "users/alice")));
  });
});
