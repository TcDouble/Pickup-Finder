// Tests for events.js, run against the emulators with the real security rules.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import {
  BOULDER,
  DENVER,
  closeAll,
  gameInput,
  hoursFromNow,
  signedInAs,
  signedOut,
  startTestEnv,
} from "./helpers.js";

let env, alice, bob, carol, dave, erin, nobody;

before(async () => {
  env = await startTestEnv();
  await env.clearFirestore();
  [alice, bob, carol, dave, erin] = await Promise.all(
    ["Alice", "Bob", "Carol", "Dave", "Erin"].map(signedInAs),
  );
  nobody = await signedOut();
});

after(async () => {
  await closeAll([alice, bob, carol, dave, erin, nobody]);
  await env.cleanup();
});

// Expect a promise to reject with an EventError carrying `code`.
async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    return true;
  });
}

describe("createEvent", () => {
  test("saves the game with the signed-in user as host and first player", async () => {
    const id = await alice.createEvent(gameInput({ title: "  5v5  " }));
    const game = await alice.getEvent(id);

    assert.equal(game.sportId, "basketball");
    assert.equal(game.title, "5v5");
    assert.equal(game.hostId, alice.uid);
    assert.equal(game.hostName, "Alice");
    assert.deepEqual(game.participantIds, [alice.uid]);
    assert.equal(game.status, "scheduled");
    assert.ok(game.startTime instanceof Date);
    assert.ok(game.createdAt instanceof Date);
    assert.equal(game.playerCount, 1);
    assert.equal(game.spotsLeft, 9);
    assert.equal(game.isFull, false);
    assert.equal(game.isHost, true);
    assert.equal(game.isGoing, true);

    const asBob = await bob.getEvent(id);
    assert.equal(asBob.isHost, false);
    assert.equal(asBob.isGoing, false);
  });

  test("accepts datetime-local strings and numeric strings from form inputs", async () => {
    const pad = (n) => String(n).padStart(2, "0");
    const local = (d) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const id = await alice.createEvent(
      gameInput({
        startTime: local(hoursFromNow(24)),
        endTime: local(hoursFromNow(26)),
        playerLimit: "8",
        location: { name: "Valmont", lat: "40.03", lng: "-105.24" },
      }),
    );
    const game = await alice.getEvent(id);
    assert.equal(game.playerLimit, 8);
    assert.equal(game.location.lat, 40.03);
    assert.equal(game.location.address, "");
  });

  const invalid = {
    "events/invalid-sport": { sportId: "quidditch" },
    "events/invalid-time": { startTime: hoursFromNow(-1) },
    "events/invalid-player-limit": { playerLimit: 1 },
    "events/invalid-location": { location: { name: "Somewhere" } },
    "events/invalid-details": { skillLevel: "pro" },
  };
  for (const [code, overrides] of Object.entries(invalid)) {
    test(`rejects bad input with ${code}`, async () => {
      await rejectsWith(alice.createEvent(gameInput(overrides)), code);
    });
  }

  test("rejects an end time before the start time", async () => {
    await rejectsWith(
      alice.createEvent(gameInput({ startTime: hoursFromNow(3), endTime: hoursFromNow(2) })),
      "events/invalid-time",
    );
  });

  test("needs someone signed in", async () => {
    await rejectsWith(nobody.createEvent(gameInput()), "events/not-signed-in");
  });
});

describe("RSVPs", () => {
  test("rsvpToEvent and cancelRsvp add and remove the signed-in user", async () => {
    const id = await alice.createEvent(gameInput());

    const joined = await bob.rsvpToEvent(id);
    assert.equal(joined.isGoing, true);
    assert.equal(joined.playerCount, 2);
    assert.deepEqual((await alice.getEvent(id)).participantIds, [alice.uid, bob.uid]);

    // A second RSVP does nothing.
    await bob.rsvpToEvent(id);
    assert.equal((await alice.getEvent(id)).playerCount, 2);

    const left = await bob.cancelRsvp(id);
    assert.equal(left.isGoing, false);
    assert.deepEqual((await alice.getEvent(id)).participantIds, [alice.uid]);
  });

  test("a full game says so", async () => {
    const id = await alice.createEvent(gameInput({ playerLimit: 2 }));
    await bob.rsvpToEvent(id);
    await rejectsWith(carol.rsvpToEvent(id), "events/full");
  });

  test("when four people race for the last two spots, exactly two get in", async () => {
    const id = await alice.createEvent(gameInput({ playerLimit: 3 }));
    const results = await Promise.allSettled(
      [bob, carol, dave, erin].map((user) => user.rsvpToEvent(id)),
    );

    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    assert.equal(ok.length, 2);
    assert.equal(failed.length, 2);
    for (const r of failed) assert.equal(r.reason.code, "events/full");

    const game = await alice.getEvent(id);
    assert.equal(game.playerCount, 3);
    assert.equal(game.isFull, true);
  });

  test("the host can't leave their own game", async () => {
    const id = await alice.createEvent(gameInput());
    await rejectsWith(alice.cancelRsvp(id), "events/host-cannot-leave");
  });

  test("unknown games say so", async () => {
    await rejectsWith(bob.rsvpToEvent("no-such-game"), "events/not-found");
  });

  test("you can't RSVP to a game that has started", async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), "events/started"), {
        ...gameInput(),
        startTime: Timestamp.fromDate(hoursFromNow(-1)),
        endTime: Timestamp.fromDate(hoursFromNow(1)),
        hostId: alice.uid,
        hostName: "Alice",
        participantIds: [alice.uid],
        status: "scheduled",
        createdAt: Timestamp.now(),
      }),
    );
    await rejectsWith(bob.rsvpToEvent("started"), "events/started");
  });
});

describe("host actions", () => {
  test("the host can edit details; the limit can't go below the players going", async () => {
    const id = await alice.createEvent(gameInput({ playerLimit: 4 }));
    await bob.rsvpToEvent(id);
    await carol.rsvpToEvent(id);

    await alice.updateEvent(id, { description: "Court 2 tonight", playerLimit: 6 });
    const game = await alice.getEvent(id);
    assert.equal(game.description, "Court 2 tonight");
    assert.equal(game.playerLimit, 6);
    assert.equal(game.playerCount, 3);

    await rejectsWith(alice.updateEvent(id, { playerLimit: 2 }), "events/limit-below-players");
    await rejectsWith(alice.updateEvent(id, { sportId: "soccer" }), "events/not-editable");
    await rejectsWith(bob.updateEvent(id, { description: "mine" }), "events/not-host");
  });

  test("only the host can cancel, and nobody can RSVP afterwards", async () => {
    const id = await alice.createEvent(gameInput());
    await rejectsWith(bob.cancelEvent(id), "events/not-host");

    await alice.cancelEvent(id);
    assert.equal((await bob.getEvent(id)).status, "cancelled");
    await rejectsWith(bob.rsvpToEvent(id), "events/cancelled");
  });
});

describe("finding games", () => {
  const ids = {};
  const found = (events) => events.map((e) => Object.keys(ids).find((k) => ids[k] === e.id)).sort();

  before(async () => {
    await env.clearFirestore();
    const at = (place, name) => ({ name, address: "", ...place });
    ids.hoopsSoon = await alice.createEvent(
      gameInput({ startTime: hoursFromNow(2), endTime: hoursFromNow(3), location: at(BOULDER, "North Boulder Park") }),
    );
    ids.soccerTomorrow = await alice.createEvent(
      gameInput({
        sportId: "soccer",
        startTime: hoursFromNow(26),
        endTime: hoursFromNow(28),
        location: at({ lat: 40.0, lng: -105.25 }, "CU fields"),
      }),
    );
    ids.hoopsDenver = await bob.createEvent(
      gameInput({ startTime: hoursFromNow(3), endTime: hoursFromNow(4), location: at(DENVER, "City Park") }),
    );
    ids.pickleballCompetitive = await bob.createEvent(
      gameInput({
        sportId: "pickleball",
        skillLevel: "competitive",
        playerLimit: 2,
        startTime: hoursFromNow(48),
        endTime: hoursFromNow(50),
        location: at({ lat: 40.02, lng: -105.26 }, "East Boulder Rec"),
      }),
    );
    await carol.rsvpToEvent(ids.pickleballCompetitive); // now full
    const cancelled = await alice.createEvent(gameInput({ startTime: hoursFromNow(5), endTime: hoursFromNow(6) }));
    await alice.cancelEvent(cancelled); // never listed
  });

  test("with no filters: every scheduled upcoming game, soonest first", async () => {
    const events = await bob.listEvents();
    assert.deepEqual(found(events), ["hoopsDenver", "hoopsSoon", "pickleballCompetitive", "soccerTomorrow"]);
    const times = events.map((e) => e.startTime.getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  test("by sport", async () => {
    assert.deepEqual(found(await bob.listEvents({ sportId: "basketball" })), ["hoopsDenver", "hoopsSoon"]);
    assert.deepEqual(
      found(await bob.listEvents({ sportId: ["soccer", "pickleball"] })),
      ["pickleballCompetitive", "soccerTomorrow"],
    );
  });

  test("by time range", async () => {
    assert.deepEqual(
      found(await bob.listEvents({ from: new Date(), to: hoursFromNow(6) })),
      ["hoopsDenver", "hoopsSoon"],
    );
    assert.deepEqual(
      found(await bob.listEvents({ from: hoursFromNow(24), to: hoursFromNow(72) })),
      ["pickleballCompetitive", "soccerTomorrow"],
    );
  });

  test("near a point, with distances", async () => {
    const events = await bob.listEvents({ near: { ...BOULDER, radiusKm: 10 } });
    assert.deepEqual(found(events), ["hoopsSoon", "pickleballCompetitive", "soccerTomorrow"]);
    for (const e of events) assert.ok(e.distanceKm >= 0 && e.distanceKm <= 10);
  });

  test("inside a map rectangle", async () => {
    const aroundDenver = { south: 39.6, north: 39.9, west: -105.1, east: -104.8 };
    assert.deepEqual(found(await bob.listEvents({ bounds: aroundDenver })), ["hoopsDenver"]);
  });

  test("sport, time, and location together", async () => {
    const events = await bob.listEvents({
      sportId: "basketball",
      from: new Date(),
      to: hoursFromNow(12),
      near: { ...BOULDER, radiusKm: 10 },
    });
    assert.deepEqual(found(events), ["hoopsSoon"]);
  });

  test("by skill level, and only games with room", async () => {
    assert.deepEqual(found(await bob.listEvents({ skillLevel: "competitive" })), ["pickleballCompetitive"]);
    assert.ok(!found(await bob.listEvents({ openOnly: true })).includes("pickleballCompetitive"));
  });

  test("watchEvents sends updates as games change", async () => {
    const updates = [];
    let notify;
    const unsubscribe = bob.watchEvents({ sportId: "soccer" }, (events) => {
      updates.push(events);
      notify?.();
    });
    const waitForUpdate = () => new Promise((resolve) => (notify = resolve));

    await waitForUpdate();
    assert.equal(updates.at(-1)[0].playerCount, 1);

    const next = waitForUpdate();
    await carol.rsvpToEvent(ids.soccerTomorrow);
    await next;
    unsubscribe();
    assert.equal(updates.at(-1)[0].playerCount, 2);
  });

  test("listMyEvents: games you joined and games you host", async () => {
    assert.deepEqual(found(await carol.listMyEvents()), ["pickleballCompetitive", "soccerTomorrow"]);
    assert.deepEqual(found(await bob.listMyEvents({ role: "hosting" })), ["hoopsDenver", "pickleballCompetitive"]);
    // Cancelled games still show up for the people in them.
    assert.equal((await alice.listMyEvents({ role: "hosting" })).length, 3);
  });

  test("listMyEvents: past games, most recent first", async () => {
    const past = (h) => Timestamp.fromDate(hoursFromNow(h));
    for (const [id, h] of [["lastWeek", -168], ["yesterday", -24]]) {
      await env.withSecurityRulesDisabled((ctx) =>
        setDoc(doc(ctx.firestore(), "events", id), {
          ...gameInput(),
          startTime: past(h),
          endTime: past(h + 1),
          hostId: alice.uid,
          hostName: "Alice",
          participantIds: [alice.uid, dave.uid],
          status: "scheduled",
          createdAt: Timestamp.now(),
        }),
      );
    }
    const events = await dave.listMyEvents({ when: "past" });
    assert.deepEqual(events.map((e) => e.id), ["yesterday", "lastWeek"]);
  });
});

describe("timeRange", () => {
  // Wednesday 2026-11-04, 3 PM local time
  const wednesday = new Date(2026, 10, 4, 15, 0);

  test("today and tonight", async () => {
    const today = alice.timeRange("today", wednesday);
    assert.deepEqual([today.from, today.to], [wednesday, new Date(2026, 10, 5)]);
    const tonight = alice.timeRange("tonight", wednesday);
    assert.deepEqual([tonight.from, tonight.to], [new Date(2026, 10, 4, 17), new Date(2026, 10, 5)]);
  });

  test("weekend from a weekday and from Saturday", async () => {
    const fromWeekday = alice.timeRange("weekend", wednesday);
    assert.deepEqual([fromWeekday.from, fromWeekday.to], [new Date(2026, 10, 7), new Date(2026, 10, 9)]);
    const saturdayNoon = new Date(2026, 10, 7, 12);
    const fromSaturday = alice.timeRange("weekend", saturdayNoon);
    assert.deepEqual([fromSaturday.from, fromSaturday.to], [saturdayNoon, new Date(2026, 10, 9)]);
  });
});
