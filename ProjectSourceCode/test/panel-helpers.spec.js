// Unit tests for the helpers behind the Notifications, Recommended, and Rate
// players panels on the home page. No browser, emulator, or database is
// involved: these are the functions in panel-helpers.js that don't touch the page.
import { expect } from "chai";
import {
  gameName,
  initials,
  kmToMiles,
  matchNote,
  milesToKm,
  notificationTarget,
  plural,
  rateableGames,
  scoreSummary,
  timeAgo,
} from "../assets/panel-helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-20T18:00:00Z");
const ago = (ms) => new Date(now.getTime() - ms);

describe("panel helpers (unit)", () => {
  describe("rateableGames", () => {
    const game = (id, fields) => ({
      id,
      status: "scheduled",
      participantIds: ["me", "riley"],
      startTime: ago(2 * DAY + 2 * 60 * 60 * 1000),
      endTime: ago(2 * DAY),
      ...fields,
    });

    it("keeps finished games with other players from the last 14 days, most recent first", () => {
      const games = [game("older", { endTime: ago(5 * DAY) }), game("newer", { endTime: ago(1 * DAY) })];
      const result = rateableGames(games, { uid: "me", windowDays: 14, now });
      expect(result.map((g) => g.id)).to.deep.equal(["newer", "older"]);
    });

    it("leaves out cancelled games, games still going, solo games, and games past the window", () => {
      const games = [
        game("ok"),
        game("cancelled", { status: "cancelled" }),
        game("still going", { endTime: new Date(now.getTime() + 30 * 60 * 1000) }),
        game("solo", { participantIds: ["me"] }),
        game("too old", { endTime: ago(14 * DAY) }),
      ];
      const result = rateableGames(games, { uid: "me", windowDays: 14, now });
      expect(result.map((g) => g.id)).to.deep.equal(["ok"]);
    });

    it("counts a game that ended exactly now as finished", () => {
      const result = rateableGames([game("just ended", { endTime: now })], { uid: "me", windowDays: 14, now });
      expect(result).to.have.length(1);
    });
  });

  describe("notificationTarget", () => {
    it("opens Rate players for rating requests and Recommended for match alerts", () => {
      expect(notificationTarget({ type: "feedback", eventId: "g1" })).to.deep.equal({ name: "rate", gameId: "g1" });
      expect(notificationTarget({ type: "match", eventId: "g2" })).to.deep.equal({
        name: "recommended",
        gameId: "g2",
      });
    });

    it("has nowhere else to go for reminders or items without a game", () => {
      expect(notificationTarget({ type: "reminder", eventId: "g1" })).to.equal(null);
      expect(notificationTarget({ type: "feedback" })).to.equal(null);
      expect(notificationTarget(null)).to.equal(null);
    });
  });

  describe("timeAgo", () => {
    it("gives minutes, hours, and days, then the date", () => {
      expect(timeAgo(ago(20 * 1000), now)).to.equal("now");
      expect(timeAgo(ago(5 * 60 * 1000), now)).to.equal("5m");
      expect(timeAgo(ago(3 * 60 * 60 * 1000), now)).to.equal("3h");
      expect(timeAgo(ago(2 * DAY), now)).to.equal("2d");
      expect(timeAgo(new Date(2026, 10, 3, 12), now)).to.equal("Nov 3");
    });

    it("is empty for a notification the server hasn't timestamped yet", () => {
      expect(timeAgo(null, now)).to.equal("");
    });
  });

  describe("miles and kilometers", () => {
    it("round-trips every distance on the pages", () => {
      for (const miles of [1, 3, 5, 10, 25, 50]) {
        expect(kmToMiles(milesToKm(miles))).to.equal(miles);
      }
    });

    it("stays inside the 1 to 100 km the back end allows", () => {
      expect(milesToKm(1)).to.be.at.least(1);
      expect(milesToKm(50)).to.be.at.most(100);
    });
  });

  describe("text", () => {
    it("names games with and without a title", () => {
      expect(gameName({ sportId: "basketball", title: "5v5" })).to.equal("Basketball · 5v5");
      expect(gameName({ sportId: "pickleball", title: "" })).to.equal("Pickleball");
    });

    it("summarizes a score with how many ratings it's based on", () => {
      expect(scoreSummary({ score: 92, feedbackCount: 12 })).to.equal("92 from 12 ratings");
      expect(scoreSummary({ score: 75, feedbackCount: 1 })).to.equal("75 from 1 rating");
      expect(scoreSummary({ score: 100, feedbackCount: 0 })).to.equal("100 (no ratings yet)");
    });

    it("calls a game a close match when its players' average is within 5 of your score", () => {
      expect(matchNote(95, 92)).to.match(/^Close match/);
      expect(matchNote(80, 92)).to.match(/^Good match/);
      expect(matchNote(60, 92)).to.match(/^Sportsmanship/);
    });

    it("makes initials from a display name", () => {
      expect(initials("Riley Park")).to.equal("RP");
      expect(initials("  jun ")).to.equal("J");
      expect(initials(null)).to.equal("?");
    });

    it("pluralizes", () => {
      expect(plural(1, "spot")).to.equal("1 spot");
      expect(plural(3, "spot")).to.equal("3 spots");
    });
  });
});
