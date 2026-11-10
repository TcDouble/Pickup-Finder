// Security rules tests for notifications (notificationSettings, notifications,
// and notifier collections): writes the app would never make on purpose, to
// prove Firestore itself refuses them.
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
import { BOULDER, startTestEnv } from "./helpers.js";

let env;
const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await startTestEnv();
});

beforeEach(async () => {
  await env.clearFirestore();
});

after(async () => {
  await env.cleanup();
});

async function seed(path, data) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path), data));
}

// Settings as notifications.js saves them; override any field.
function settings(overrides = {}) {
  return {
    channels: { email: true, sms: false, desktop: false },
    phone: "",
    desktopTokens: [],
    gameReminders: true,
    feedbackReminders: true,
    matchAlerts: { sportIds: ["soccer"], skillLevel: "any", near: { ...BOULDER, radiusKm: 10 }, minScore: 0 },
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

const alerts = (overrides) => settings({ matchAlerts: { ...settings().matchAlerts, ...overrides } });
const save = (uid, data, owner = uid) => setDoc(doc(as(uid), "notificationSettings", owner), data);

describe("notificationSettings rules", () => {
  test("you can save and read your own settings", async () => {
    await assertSucceeds(save("alice", settings()));
    await assertSucceeds(getDoc(doc(as("alice"), "notificationSettings", "alice")));
    await assertSucceeds(
      save("alice", settings({
        channels: { email: false, sms: true, desktop: true },
        phone: "+13035550100",
        desktopTokens: ["t1"],
      })),
    );
    await assertSucceeds(save("alice", alerts({ near: null, sportIds: [] })));
    await assertSucceeds(deleteDoc(doc(as("alice"), "notificationSettings", "alice")));
  });

  test("nobody else can read or change them", async () => {
    await seed("notificationSettings/alice", { ...settings(), phone: "+13035550100", updatedAt: Timestamp.now() });
    await assertFails(getDoc(doc(as("bob"), "notificationSettings", "alice")));
    await assertFails(getDoc(doc(anon(), "notificationSettings", "alice")));
    await assertFails(save("bob", settings(), "alice"));
    await assertFails(deleteDoc(doc(as("bob"), "notificationSettings", "alice")));
    await assertFails(setDoc(doc(anon(), "notificationSettings", "alice"), settings()));
  });

  test("text messages need a valid phone number", async () => {
    await assertFails(save("alice", settings({ channels: { email: false, sms: true, desktop: false } })));
    await assertFails(save("alice", settings({ phone: "303-555-0100" })));
    await assertFails(save("alice", settings({ phone: "+0123456789" })));
    await assertFails(save("alice", settings({ phone: 3035550100 })));
  });

  test("desktop notifications need a browser, and at most five", async () => {
    await assertFails(save("alice", settings({ channels: { email: false, sms: false, desktop: true } })));
    await assertFails(save("alice", settings({ desktopTokens: ["1", "2", "3", "4", "5", "6"] })));
    await assertFails(save("alice", settings({ desktopTokens: "t1" })));
  });

  test("channels and switches have to be true or false", async () => {
    await assertFails(save("alice", settings({ channels: { email: "yes", sms: false, desktop: false } })));
    await assertFails(save("alice", settings({ channels: { email: true, sms: false } })));
    await assertFails(save("alice", settings({ channels: { email: true, sms: false, desktop: false, pigeon: true } })));
    await assertFails(save("alice", settings({ gameReminders: 1 })));
  });

  test("match alerts must use real sports, skill levels, areas, and scores", async () => {
    await assertFails(save("alice", alerts({ sportIds: ["curling"] })));
    await assertFails(save("alice", alerts({ sportIds: "soccer" })));
    await assertFails(save("alice", alerts({ skillLevel: "pro" })));
    await assertFails(save("alice", alerts({ near: { ...BOULDER, radiusKm: 0 } })));
    await assertFails(save("alice", alerts({ near: { ...BOULDER, radiusKm: 101 } })));
    await assertFails(save("alice", alerts({ near: { lat: 91, lng: 0, radiusKm: 5 } })));
    await assertFails(save("alice", alerts({ near: { ...BOULDER } })));
    await assertFails(save("alice", alerts({ minScore: -1 })));
    await assertFails(save("alice", alerts({ minScore: "high" })));
    await assertFails(save("alice", alerts({ everyHour: true })));
  });

  test("every field has to be there, with nothing extra and the server's time", async () => {
    const noPhone = settings();
    delete noPhone.phone;
    await assertFails(save("alice", noPhone));
    await assertFails(save("alice", settings({ email: "someone@else.com" })));
    await assertFails(save("alice", settings({ updatedAt: Timestamp.fromMillis(0) })));
  });
});

describe("notifications rules", () => {
  beforeEach(async () => {
    await seed("notifications/n1", {
      uid: "alice",
      type: "reminder",
      eventId: "g1",
      sportId: "basketball",
      title: "Basketball starts in about an hour",
      body: "North Boulder Park, 6:00 PM.",
      link: "http://localhost:3000/game.html?id=g1",
      createdAt: Timestamp.now(),
      readAt: null,
      delivery: { email: "sent", sms: "off", desktop: "off" },
    });
  });

  test("you can read and list your own", async () => {
    await assertSucceeds(getDoc(doc(as("alice"), "notifications", "n1")));
    await assertSucceeds(getDocs(query(collection(as("alice"), "notifications"), where("uid", "==", "alice"))));
  });

  test("nobody else can read them, and lists must ask for your own", async () => {
    await assertFails(getDoc(doc(as("bob"), "notifications", "n1")));
    await assertFails(getDoc(doc(anon(), "notifications", "n1")));
    await assertFails(getDocs(collection(as("alice"), "notifications")));
    await assertFails(getDocs(query(collection(as("bob"), "notifications"), where("uid", "==", "alice"))));
  });

  test("you can only mark your own read, with the server's time", async () => {
    await assertFails(updateDoc(doc(as("bob"), "notifications", "n1"), { readAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as("alice"), "notifications", "n1"), { readAt: Timestamp.fromMillis(0) }));
    await assertFails(
      updateDoc(doc(as("alice"), "notifications", "n1"), { readAt: serverTimestamp(), title: "Free money" }),
    );
    await assertFails(updateDoc(doc(as("alice"), "notifications", "n1"), { uid: "bob" }));
    await assertSucceeds(updateDoc(doc(as("alice"), "notifications", "n1"), { readAt: serverTimestamp() }));
  });

  test("only the notifier creates them, and nobody deletes them", async () => {
    await assertFails(
      setDoc(doc(as("alice"), "notifications", "n2"), {
        uid: "bob",
        type: "match",
        title: "Click this link",
        createdAt: serverTimestamp(),
        readAt: null,
      }),
    );
    await assertFails(deleteDoc(doc(as("alice"), "notifications", "n1")));
  });
});

describe("notifier rules", () => {
  test("no browser can read or change the notifier's own records", async () => {
    await seed("notifier/state", { matchCursor: Timestamp.now() });
    await assertFails(getDoc(doc(as("alice"), "notifier", "state")));
    await assertFails(setDoc(doc(as("alice"), "notifier", "state"), { matchCursor: Timestamp.fromMillis(0) }));
  });
});
