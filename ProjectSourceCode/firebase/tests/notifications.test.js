// Tests for notifications.js, run against the emulators with the real security rules.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { BOULDER, closeAll, signedInAs, signedOut, startTestEnv } from "./helpers.js";

let env, alice, bob, nobody;

before(async () => {
  env = await startTestEnv();
  await env.clearFirestore();
  [alice, bob] = await Promise.all(["Alice", "Bob"].map(signedInAs));
  nobody = await signedOut();
});

after(async () => {
  await closeAll([alice, bob, nobody]);
  await env.cleanup();
});

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    return true;
  });
}

async function readSettings(uid) {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore(), "notificationSettings", uid))).data();
  });
  return data;
}

// What the notifier writes for each message it sends.
let sent = 0;
async function seedNotification(uid, overrides = {}) {
  const id = `reminder_game${++sent}_${uid}`;
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), "notifications", id), {
      uid,
      type: "reminder",
      eventId: `game${sent}`,
      sportId: "basketball",
      title: "Basketball starts in about an hour",
      body: "North Boulder Park, 6:00 PM. 4 players going.",
      link: `http://localhost:3000/game.html?id=game${sent}`,
      createdAt: Timestamp.fromMillis(Date.now() - (100 - sent) * 1000),
      readAt: null,
      delivery: { email: "sent", sms: "off", desktop: "off" },
      ...overrides,
    }),
  );
  return id;
}

describe("notification settings", () => {
  test("start as inbox-only reminders and no match alerts", async () => {
    const settings = await alice.getNotificationSettings();
    assert.deepEqual(settings.channels, { email: false, sms: false, desktop: false });
    assert.equal(settings.gameReminders, true);
    assert.equal(settings.feedbackReminders, true);
    assert.deepEqual(settings.matchAlerts, { sportIds: [], skillLevel: "any", near: null, minScore: 0 });
    assert.equal(settings.phone, "");
    assert.equal(settings.desktopDevices, 0);
    assert.equal(settings.updatedAt, null);
  });

  test("save only what changed and keep the rest", async () => {
    await alice.saveNotificationSettings({ channels: { email: true }, phone: "(303) 555-0100" });
    await alice.saveNotificationSettings({
      channels: { sms: true },
      gameReminders: false,
      matchAlerts: { sportIds: ["soccer", "tennis", "soccer"], near: { ...BOULDER, radiusKm: 10 } },
    });
    const saved = await alice.saveNotificationSettings({ matchAlerts: { minScore: 70 } });

    assert.deepEqual(saved.channels, { email: true, sms: true, desktop: false });
    assert.equal(saved.phone, "+13035550100"); // a 10-digit number is taken as US
    assert.equal(saved.gameReminders, false);
    assert.equal(saved.feedbackReminders, true);
    assert.deepEqual(saved.matchAlerts, {
      sportIds: ["soccer", "tennis"],
      skillLevel: "any",
      near: { ...BOULDER, radiusKm: 10 },
      minScore: 70,
    });

    const reread = await alice.getNotificationSettings();
    assert.deepEqual(reread.matchAlerts, saved.matchAlerts);
    assert.ok(reread.updatedAt instanceof Date);
  });

  test("are private to their owner", async () => {
    await alice.saveNotificationSettings({ phone: "+44 20 7946 0958" });
    assert.equal((await readSettings(alice.uid)).phone, "+442079460958");
    // Bob reads his own settings (defaults), never Alice's.
    assert.equal((await bob.getNotificationSettings()).phone, "");
  });

  test("need a phone number for text messages", async () => {
    await rejectsWith(
      bob.saveNotificationSettings({ channels: { sms: true } }),
      "notifications/no-phone",
    );
    await rejectsWith(
      bob.saveNotificationSettings({ phone: "555-0100" }),
      "notifications/invalid-phone",
    );
    await rejectsWith(
      alice.saveNotificationSettings({ phone: "" }), // Alice has texts on from the test above
      "notifications/no-phone",
    );
  });

  test("need a browser set up before desktop notifications", async () => {
    await rejectsWith(
      bob.saveNotificationSettings({ channels: { desktop: true } }),
      "notifications/no-desktop-device",
    );
  });

  test("reject bad match alert settings", async () => {
    await rejectsWith(
      bob.saveNotificationSettings({ matchAlerts: { sportIds: ["curling"] } }),
      "notifications/invalid-sport",
    );
    await rejectsWith(
      bob.saveNotificationSettings({ matchAlerts: { skillLevel: "pro" } }),
      "notifications/invalid-skill",
    );
    await rejectsWith(
      bob.saveNotificationSettings({ matchAlerts: { near: { ...BOULDER, radiusKm: 500 } } }),
      "notifications/invalid-area",
    );
    await rejectsWith(
      bob.saveNotificationSettings({ matchAlerts: { near: { lat: 120, lng: 0, radiusKm: 5 } } }),
      "notifications/invalid-area",
    );
    await rejectsWith(
      bob.saveNotificationSettings({ matchAlerts: { minScore: 101 } }),
      "notifications/invalid-min-score",
    );
  });

  test("can't be used to change anything else", async () => {
    await rejectsWith(
      bob.saveNotificationSettings({ desktopTokens: ["someone-elses-token"] }),
      "notifications/not-editable",
    );
  });

  test("need someone signed in", async () => {
    await rejectsWith(nobody.getNotificationSettings(), "events/not-signed-in");
    await rejectsWith(nobody.saveNotificationSettings({ gameReminders: false }), "events/not-signed-in");
  });
});

describe("desktop notifications", () => {
  test("saving a browser's token turns them on", async () => {
    const saved = await bob.saveDesktopToken("token-laptop");
    assert.equal(saved.channels.desktop, true);
    assert.deepEqual(saved.desktopTokens, ["token-laptop"]);
    assert.equal(saved.desktopDevices, 1);
  });

  test("keep the five most recent browsers, once each", async () => {
    for (const t of ["t1", "t2", "t3", "t4", "t5", "t1", "t6"]) await bob.saveDesktopToken(t);
    const { desktopTokens } = await bob.getNotificationSettings();
    assert.deepEqual(desktopTokens, ["t3", "t4", "t5", "t1", "t6"]);
  });

  test("can be turned off without forgetting the browsers", async () => {
    const saved = await bob.saveNotificationSettings({ channels: { desktop: false } });
    assert.equal(saved.channels.desktop, false);
    assert.equal(saved.desktopDevices, 5);
  });

  test("need a real token", async () => {
    await rejectsWith(bob.saveDesktopToken(""), "notifications/invalid-token");
  });

  test("say so when nobody has set up the push key yet", async () => {
    await rejectsWith(bob.enableDesktopNotifications(), "notifications/not-set-up");
  });

  test("say so when the browser can't show them", async () => {
    // Node has no Notification API, like an old browser.
    await rejectsWith(bob.enableDesktopNotifications({ vapidKey: "key" }), "notifications/unsupported");
  });
});

describe("inbox", () => {
  test("lists your own notifications, newest first", async () => {
    const older = await seedNotification(alice.uid);
    const newer = await seedNotification(alice.uid, { type: "feedback", title: "How was basketball?" });
    await seedNotification(bob.uid);

    const inbox = await alice.listMyNotifications();
    assert.deepEqual(inbox.map((n) => n.id), [newer, older]);
    assert.equal(inbox[0].type, "feedback");
    assert.equal(inbox[0].title, "How was basketball?");
    assert.equal(inbox[0].read, false);
    assert.ok(inbox[0].createdAt instanceof Date);
    assert.equal("delivery" in inbox[0], false);
  });

  test("marks one read, and can show only unread ones", async () => {
    const first = await seedNotification(bob.uid);
    const second = await seedNotification(bob.uid);
    await bob.markNotificationRead(first);
    await bob.markNotificationRead(first); // twice is fine

    const all = await bob.listMyNotifications();
    assert.equal(all.find((n) => n.id === first).read, true);
    const unread = await bob.listMyNotifications({ unreadOnly: true });
    assert.ok(unread.some((n) => n.id === second));
    assert.ok(!unread.some((n) => n.id === first));
  });

  test("can't mark someone else's notification", async () => {
    const id = await seedNotification(alice.uid);
    await rejectsWith(bob.markNotificationRead(id), "notifications/not-found");
    await rejectsWith(bob.markNotificationRead("no-such-id"), "notifications/not-found");
  });

  test("updates live", async () => {
    const seen = [];
    let wake;
    const nextSnapshot = () => new Promise((resolve) => (wake = resolve));
    let waiting = nextSnapshot();
    const stop = bob.watchMyNotifications((items) => {
      seen.push(items.length);
      wake();
    });
    await waiting;
    waiting = nextSnapshot();
    await seedNotification(bob.uid, { createdAt: Timestamp.now() });
    await waiting;
    stop();
    assert.equal(seen[1], seen[0] + 1);
  });
});
