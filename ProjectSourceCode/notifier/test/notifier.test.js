// Tests for one notifier pass (runOnce), against the Firestore and Auth
// emulators with the Admin SDK, like the real notifier. The email, text, and
// desktop services are fakes that record what they were asked to send.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { MAX_MATCH_ALERTS_PER_DAY, runOnce } from "../src/notifier.js";

const PROJECT_ID = "demo-pickup-finder";
const BOULDER = { lat: 40.015, lng: -105.2705 };
const DENVER = { lat: 39.7392, lng: -104.9903 }; // about 40 km from Boulder
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const config = { appUrl: "https://pickup.example.com", timeZone: "America/Denver" };

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("Run these with `npm test`, which starts the emulators.");
}
// Same as index.js on the emulators: don't look for a Google Cloud login server.
process.env.METADATA_SERVER_DETECTION ??= "none";

let app, db, auth;
const uid = {};

before(async () => {
  app = initializeApp({ projectId: PROJECT_ID }, "notifier-tests");
  db = getFirestore(app);
  auth = getAuth(app);
  // Real Auth accounts, so the notifier can look up email addresses. Erin
  // signed up without an email address.
  for (const name of ["alice", "bob", "carol", "dave", "erin"]) {
    const user = await auth.createUser(name === "erin" ? {} : { email: `${name}@example.com` });
    uid[name] = user.uid;
  }
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const res = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.ok(res.ok, "couldn't clear the Firestore emulator");
});

// Fake email, text, and desktop services. `fail` makes one throw.
function fakeChannels({ fail = [], deadTokens = [] } = {}) {
  const sent = { email: [], sms: [], desktop: [] };
  const make = (name, result) => ({
    async send(message) {
      if (fail.includes(name)) throw new Error(`${name} is down`);
      sent[name].push(message);
      return result(message);
    },
  });
  return {
    sent,
    channels: {
      email: make("email", () => ({})),
      sms: make("sms", () => ({})),
      desktop: make("desktop", (m) => ({
        sent: m.tokens.filter((t) => !deadTokens.includes(t)).length,
        deadTokens: m.tokens.filter((t) => deadTokens.includes(t)),
      })),
    },
  };
}

async function pass(channels, now = new Date()) {
  const summary = await runOnce({ db, auth, channels, config, now, log: () => {} });
  assert.deepEqual(summary.errors, []);
  return summary;
}

let gameCount = 0;
async function seedGame(overrides = {}) {
  const id = `game${++gameCount}`;
  const now = Date.now();
  await db.doc(`events/${id}`).set({
    sportId: "basketball",
    title: "",
    description: "",
    skillLevel: "casual",
    startTime: Timestamp.fromMillis(now + 50 * MINUTE),
    endTime: Timestamp.fromMillis(now + 170 * MINUTE),
    location: { name: "North Boulder Park", address: "", ...BOULDER },
    playerLimit: 10,
    hostId: uid.alice,
    hostName: "Alice",
    participantIds: [uid.alice, uid.bob],
    status: "scheduled",
    createdAt: Timestamp.fromMillis(now - 30 * MINUTE), // posted before the notifier's first look
    ...overrides,
  });
  return id;
}

function settings(overrides = {}) {
  return {
    channels: { email: true, sms: false, desktop: false },
    phone: "",
    desktopTokens: [],
    gameReminders: true,
    feedbackReminders: true,
    matchAlerts: { sportIds: [], skillLevel: "any", near: null, minScore: 0 },
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}
const saveSettings = (who, overrides) => db.doc(`notificationSettings/${uid[who]}`).set(settings(overrides));

async function inbox(who) {
  const snap = await db.collection("notifications").where("uid", "==", uid[who]).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

describe("game reminders", () => {
  test("go to every player in a game starting within the hour, on the channels they chose", async () => {
    await saveSettings("alice", { channels: { email: true, sms: true, desktop: false }, phone: "+13035550100" });
    const game = await seedGame();
    await seedGame({ startTime: Timestamp.fromMillis(Date.now() + 2 * HOUR), endTime: Timestamp.fromMillis(Date.now() + 3 * HOUR) });
    const { sent, channels } = fakeChannels();

    const summary = await pass(channels);

    assert.equal(summary.reminder, 2); // Alice and Bob, not the later game
    assert.equal(sent.email.length, 1);
    assert.equal(sent.email[0].to, "alice@example.com");
    assert.equal(sent.email[0].subject, "Basketball starts in about an hour");
    assert.equal(sent.sms.length, 1);
    assert.equal(sent.sms[0].to, "+13035550100");
    assert.match(sent.sms[0].body, /^Pickup-Finder: Basketball starts in about an hour\./);
    assert.equal(sent.desktop.length, 0);

    const [alices] = await inbox("alice");
    assert.equal(alices.type, "reminder");
    assert.equal(alices.eventId, game);
    assert.equal(alices.readAt, null);
    assert.equal(alices.link, `https://pickup.example.com/game.html?id=${game}`);
    assert.deepEqual(alices.delivery, { email: "sent", sms: "sent", desktop: "off" });
    // Bob never saved settings, so his reminder is only in his inbox.
    const [bobs] = await inbox("bob");
    assert.deepEqual(bobs.delivery, { email: "off", sms: "off", desktop: "off" });
  });

  test("are sent once, even over many passes", async () => {
    await saveSettings("alice");
    await seedGame();
    const { sent, channels } = fakeChannels();
    await pass(channels);
    const second = await pass(channels);
    assert.equal(second.reminder, 0);
    assert.equal(sent.email.length, 1);
    assert.equal((await inbox("alice")).length, 1);
  });

  test("are sent again when the host moves the game", async () => {
    await saveSettings("alice");
    const game = await seedGame();
    const { sent, channels } = fakeChannels();
    await pass(channels);

    const later = Date.now() + 3 * HOUR;
    await db.doc(`events/${game}`).update({
      startTime: Timestamp.fromMillis(later),
      endTime: Timestamp.fromMillis(later + 2 * HOUR),
    });
    await pass(channels); // too early for the new time
    assert.equal(sent.email.length, 1);
    await pass(channels, new Date(later - 50 * MINUTE));
    assert.equal(sent.email.length, 2);
  });

  test("skip cancelled games and players who turned reminders off", async () => {
    await saveSettings("alice", { gameReminders: false });
    await seedGame();
    await seedGame({ status: "cancelled", participantIds: [uid.alice, uid.carol] });
    const { channels } = fakeChannels();
    const summary = await pass(channels);
    assert.equal(summary.reminder, 1); // only Bob, for the game that's on
    assert.equal((await inbox("alice")).length, 0);
    assert.equal((await inbox("carol")).length, 0);
  });
});

describe("feedback requests", () => {
  const ended = (minutesAgo, overrides = {}) =>
    seedGame({
      startTime: Timestamp.fromMillis(Date.now() - (minutesAgo + 120) * MINUTE),
      endTime: Timestamp.fromMillis(Date.now() - minutesAgo * MINUTE),
      ...overrides,
    });

  test("go to every player once a game ends, with the rating deadline", async () => {
    await saveSettings("bob");
    const game = await ended(5, { participantIds: [uid.alice, uid.bob, uid.carol] });
    const { sent, channels } = fakeChannels();

    const summary = await pass(channels);

    assert.equal(summary.feedback, 3);
    assert.equal(sent.email.length, 1);
    assert.equal(sent.email[0].to, "bob@example.com");
    assert.equal(sent.email[0].subject, "How was basketball at North Boulder Park?");
    assert.match(sent.email[0].text, /^Rate the other players by /);
    assert.match(sent.email[0].text, new RegExp(`rate-players\\.html\\?id=${game}`));
    assert.equal((await pass(channels)).feedback, 0);
  });

  test("skip games with nobody else to rate, old games, cancelled games, and players who opted out", async () => {
    await saveSettings("carol", { feedbackReminders: false });
    await ended(5, { participantIds: [uid.alice] });
    await ended(3 * 24 * 60);
    await ended(5, { status: "cancelled" });
    await ended(5, { participantIds: [uid.dave, uid.carol] });
    const { channels } = fakeChannels();
    const summary = await pass(channels);
    assert.equal(summary.feedback, 1); // only Dave
    assert.equal((await inbox("dave")).length, 1);
    assert.equal((await inbox("carol")).length, 0);
  });
});

describe("match alerts", () => {
  // A soccer game in Boulder, posted after the notifier's first look.
  const newGame = (overrides = {}) =>
    seedGame({
      sportId: "soccer",
      startTime: Timestamp.fromMillis(Date.now() + 26 * HOUR),
      endTime: Timestamp.fromMillis(Date.now() + 28 * HOUR),
      participantIds: [uid.alice],
      createdAt: Timestamp.now(),
      ...overrides,
    });
  const soccerNearBoulder = (overrides = {}) => ({
    matchAlerts: { sportIds: ["soccer"], skillLevel: "any", near: { ...BOULDER, radiusKm: 10 }, minScore: 0, ...overrides },
  });

  test("tell players about a new game that fits their matchmaking settings", async () => {
    await saveSettings("bob", soccerNearBoulder());
    await saveSettings("carol", { matchAlerts: { sportIds: ["tennis"], skillLevel: "any", near: null, minScore: 0 } });
    await saveSettings("dave", soccerNearBoulder({ near: { ...DENVER, radiusKm: 5 } }));
    await saveSettings("alice", soccerNearBoulder()); // the host
    const game = await newGame();
    const { sent, channels } = fakeChannels();

    const summary = await pass(channels);

    assert.equal(summary.match, 1);
    assert.equal(sent.email.length, 1);
    assert.equal(sent.email[0].to, "bob@example.com");
    assert.equal(sent.email[0].subject, "New game for you: Soccer at North Boulder Park");
    assert.match(sent.email[0].text, /9 spots left\. The players' average sportsmanship score is 100\./);
    const [bobs] = await inbox("bob");
    assert.equal(bobs.id, `match_${game}_${uid.bob}`);
    assert.equal((await pass(channels)).match, 0);
  });

  test("respect the lowest sportsmanship score a player will play with", async () => {
    await db.doc(`sportsmanship/${uid.alice}`).set({ positive: 0, negative: 1, lastFeedbackId: "x", updatedAt: Timestamp.now() }); // 75
    await saveSettings("bob", soccerNearBoulder({ minScore: 80 }));
    await saveSettings("carol", soccerNearBoulder({ minScore: 70 }));
    await newGame();
    const { sent, channels } = fakeChannels();
    await pass(channels);
    assert.deepEqual(sent.email.map((m) => m.to), ["carol@example.com"]);
    assert.match(sent.email[0].text, /average sportsmanship score is 75/);
  });

  test(`send at most ${MAX_MATCH_ALERTS_PER_DAY} a day to one player`, async () => {
    await saveSettings("bob", soccerNearBoulder());
    for (let i = 0; i < MAX_MATCH_ALERTS_PER_DAY + 2; i++) await newGame();
    const { sent, channels } = fakeChannels();
    const summary = await pass(channels);
    assert.equal(summary.match, MAX_MATCH_ALERTS_PER_DAY);
    assert.equal(sent.email.length, MAX_MATCH_ALERTS_PER_DAY);
  });

  test("skip full games, games already under way, and games posted before the notifier started", async () => {
    await saveSettings("bob", soccerNearBoulder());
    await newGame({ playerLimit: 2, participantIds: [uid.alice, uid.carol] });
    await newGame({ startTime: Timestamp.fromMillis(Date.now() - MINUTE) });
    await newGame({ createdAt: Timestamp.fromMillis(Date.now() - 2 * HOUR) });
    const { channels } = fakeChannels();
    assert.equal((await pass(channels)).match, 0);
  });

  test("pick up where they left off, so only new games count", async () => {
    await saveSettings("bob", soccerNearBoulder());
    const { sent, channels } = fakeChannels();
    await newGame();
    await pass(channels);
    await db.collection("notifications").get().then((s) => Promise.all(s.docs.map((d) => d.ref.delete())));
    await pass(channels); // the same game isn't looked at again
    assert.equal(sent.email.length, 1);
    await newGame();
    await pass(channels);
    assert.equal(sent.email.length, 2);
  });
});

describe("delivery", () => {
  test("a failing channel doesn't stop the others, and the inbox records what happened", async () => {
    await saveSettings("alice", { channels: { email: true, sms: true, desktop: false }, phone: "+13035550100" });
    await seedGame();
    const { sent, channels } = fakeChannels({ fail: ["email"] });
    await pass(channels);
    assert.equal(sent.sms.length, 1);
    const [alices] = await inbox("alice");
    assert.deepEqual(alices.delivery, { email: "failed", sms: "sent", desktop: "off" });
  });

  test("desktop notifications go to every browser, and browsers that are gone are forgotten", async () => {
    await saveSettings("alice", { channels: { email: false, sms: false, desktop: true }, desktopTokens: ["laptop", "old-phone"] });
    await saveSettings("bob", { channels: { email: false, sms: false, desktop: true }, desktopTokens: ["gone"] });
    const game = await seedGame();
    const { sent, channels } = fakeChannels({ deadTokens: ["old-phone", "gone"] });

    await pass(channels);

    const toAlice = sent.desktop.find((m) => m.tokens.includes("laptop"));
    assert.deepEqual(toAlice.tokens, ["laptop", "old-phone"]);
    assert.equal(toAlice.title, "Basketball starts in about an hour");
    assert.equal(toAlice.link, `https://pickup.example.com/game.html?id=${game}`);

    const alice = (await db.doc(`notificationSettings/${uid.alice}`).get()).data();
    assert.deepEqual(alice.desktopTokens, ["laptop"]);
    assert.equal(alice.channels.desktop, true);
    assert.equal((await inbox("alice"))[0].delivery.desktop, "sent");

    // Bob's only browser is gone, so desktop is turned off for him.
    const bob = (await db.doc(`notificationSettings/${uid.bob}`).get()).data();
    assert.deepEqual(bob.desktopTokens, []);
    assert.equal(bob.channels.desktop, false);
    assert.equal((await inbox("bob"))[0].delivery.desktop, "no-device");
  });

  test("emails go only to the address on the player's account", async () => {
    await saveSettings("erin"); // email on, but her account has no address
    await seedGame({ participantIds: [uid.alice, uid.erin] });
    const { sent, channels } = fakeChannels();
    await pass(channels);
    assert.equal(sent.email.length, 0);
    assert.equal((await inbox("erin"))[0].delivery.email, "no-address");
  });

  test("channels that aren't set up are recorded as logged", async () => {
    await saveSettings("alice");
    await seedGame();
    const logged = { send: async () => ({ logged: true, sent: 1, deadTokens: [] }), logged: true };
    await pass({ email: logged, sms: logged, desktop: logged });
    assert.equal((await inbox("alice"))[0].delivery.email, "logged");
  });
});
