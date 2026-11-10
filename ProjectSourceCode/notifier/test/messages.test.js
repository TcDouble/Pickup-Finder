// Tests for the text of each notification.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildMessage, formatDayTime } from "../src/messages.js";

const options = { appUrl: "https://pickup.example.com", timeZone: "America/Denver" };
// 6:00 PM in Boulder on Friday, November 13, 2026 (UTC-7 in November).
const game = {
  id: "game 1",
  sportId: "basketball",
  title: "5v5",
  location: { name: "North Boulder Park" },
  startTime: new Date("2026-11-14T01:00:00Z"),
  endTime: new Date("2026-11-14T03:00:00Z"),
  playerLimit: 10,
  participantIds: ["a", "b", "c", "d"],
};

describe("buildMessage", () => {
  test("match alerts say what, where, when, and how many spots are left", () => {
    const m = buildMessage("match", game, { ...options, averageScore: 94 });
    assert.equal(m.title, "New game for you: Basketball at North Boulder Park");
    assert.equal(
      m.body,
      "Basketball (5v5) on Fri, Nov 13, 6:00 PM, 6 spots left. The players' average sportsmanship score is 94.",
    );
    assert.equal(m.link, "https://pickup.example.com/game.html?id=game%201");
  });

  test("reminders give the local start time and the player count", () => {
    const m = buildMessage("reminder", { ...game, title: "", participantIds: ["a"] }, options);
    assert.equal(m.title, "Basketball starts in about an hour");
    assert.equal(m.body, "Basketball at North Boulder Park, 6:00 PM. 1 player going.");
  });

  test("feedback requests say when rating closes and link to the rating page", () => {
    const deadline = new Date("2026-11-28T03:00:00Z"); // Nov 27 in Denver
    const m = buildMessage("feedback", game, { ...options, deadline });
    assert.equal(m.title, "How was basketball at North Boulder Park?");
    assert.match(m.body, /^Rate the other players by Fri, Nov 27\./);
    assert.equal(m.link, "https://pickup.example.com/rate-players.html?id=game%201");
  });

  test("text messages fit in two texts and use only plain characters", () => {
    for (const type of ["match", "reminder", "feedback"]) {
      const m = buildMessage(type, game, { ...options, averageScore: 100, deadline: game.endTime });
      assert.ok(m.sms.startsWith("Pickup-Finder: "));
      assert.ok(m.sms.endsWith(m.link));
      assert.ok(m.sms.length <= 306, `${type} text is ${m.sms.length} characters`);
      assert.match(m.sms, /^[\x20-\x7e]+$/, `${type} text has a character that isn't plain ASCII`);
      assert.ok(!m.sms.includes("?."), "no doubled punctuation");
    }
  });

  test("emails include the link and how to turn them off", () => {
    const m = buildMessage("reminder", game, options);
    assert.ok(m.emailText.startsWith(m.body));
    assert.ok(m.emailText.includes(m.link));
    assert.match(m.emailText, /notification settings/);
  });

  test("times use the configured time zone, not the server's", () => {
    assert.equal(formatDayTime(game.startTime, "America/Denver"), "Fri, Nov 13, 6:00 PM");
    assert.equal(formatDayTime(game.startTime, "America/New_York"), "Fri, Nov 13, 8:00 PM");
  });

  test("refuses an unknown kind", () => {
    assert.throws(() => buildMessage("birthday", game, options), /Unknown notification type/);
  });
});
