// Unit tests for the map pins on the home page (issue #19). No browser, Google
// Maps, emulator, or database is involved: these are the functions in
// map-pins.js that decide which games get pins, where, and what the popup says.
import { expect } from "chai";
import {
  MIXED_ICON,
  SPORT_ICONS,
  gameCountText,
  gameDetails,
  groupIntoPins,
  pinLook,
  pinPosition,
  pinTitle,
} from "../login-and-registration/map-pins.js";

// Times are checked in Boulder's time zone so the tests pass anywhere.
const timeZone = "America/Denver";
// Newer Node versions put a narrow no-break space before AM/PM.
const plain = (text) => text.replace(/ /g, " ");

const NORTH_BOULDER_PARK = { name: "North Boulder Park", address: "3195 4th St, Boulder, CO", lat: 40.0335, lng: -105.2815 };
const VALMONT = { name: "Valmont Bike Park", address: "", lat: 40.0291, lng: -105.2299 };

// A game as watchEvents hands it to home.js (after toEvent in events.js).
function game(id, fields = {}) {
  return {
    id,
    sportId: "basketball",
    title: "5v5",
    skillLevel: "casual",
    startTime: new Date("2026-11-22T01:00:00Z"), // Sat, Nov 21, 6:00 PM in Boulder
    endTime: new Date("2026-11-22T03:00:00Z"),
    location: { ...NORTH_BOULDER_PARK },
    playerLimit: 10,
    participantIds: ["host", "a", "b", "c"],
    playerCount: 4,
    ...fields,
  };
}

describe("map pins (unit)", () => {
  describe("pinPosition", () => {
    it("places the pin at the game's saved lat and lng", () => {
      expect(pinPosition(game("g1"))).to.deep.equal({ lat: 40.0335, lng: -105.2815 });
    });

    it("accepts the edges of the globe, and 0", () => {
      expect(pinPosition(game("g", { location: { name: "x", lat: -90, lng: 180 } }))).to.deep.equal({ lat: -90, lng: 180 });
      expect(pinPosition(game("g", { location: { name: "x", lat: 0, lng: 0 } }))).to.deep.equal({ lat: 0, lng: 0 });
    });

    it("returns null for games without a usable location instead of throwing", () => {
      const bad = [
        game("no-location", { location: undefined }),
        game("null-location", { location: null }),
        game("no-lat", { location: { name: "x", lng: -105 } }),
        game("null-lng", { location: { name: "x", lat: 40, lng: null } }),
        game("text", { location: { name: "x", lat: "40.03", lng: "-105.28" } }),
        game("nan", { location: { name: "x", lat: NaN, lng: -105 } }),
        game("infinite", { location: { name: "x", lat: 40, lng: Infinity } }),
        game("lat-too-big", { location: { name: "x", lat: 91, lng: -105 } }),
        game("lng-too-big", { location: { name: "x", lat: 40, lng: -181 } }),
        null,
        undefined,
      ];
      for (const event of bad) expect(pinPosition(event), event?.id ?? String(event)).to.equal(null);
    });
  });

  describe("groupIntoPins", () => {
    it("gives each game at a different spot its own pin", () => {
      const { pins, skipped } = groupIntoPins([game("g1"), game("g2", { location: { ...VALMONT } })]);
      expect(pins.map((pin) => pin.events.map((e) => e.id))).to.deep.equal([["g1"], ["g2"]]);
      expect(pins[1].position).to.deep.equal({ lat: 40.0291, lng: -105.2299 });
      expect(skipped).to.deep.equal([]);
    });

    it("puts games at the same spot on one pin, soonest first, so none hides under another", () => {
      const later = game("later", { startTime: new Date("2026-11-23T01:00:00Z") });
      const sooner = game("sooner", { location: { ...NORTH_BOULDER_PARK, lat: 40.033500001 } });
      const { pins } = groupIntoPins([later, sooner]);
      expect(pins).to.have.length(1);
      expect(pins[0].events.map((e) => e.id)).to.deep.equal(["sooner", "later"]);
    });

    it("keeps games a few meters apart on separate pins", () => {
      // 0.0001 degrees of latitude is about 11 m.
      const { pins } = groupIntoPins([game("g1"), game("g2", { location: { ...NORTH_BOULDER_PARK, lat: 40.0336 } })]);
      expect(pins).to.have.length(2);
    });

    it("leaves out games without a valid location and lists them, without stopping the others", () => {
      const broken = game("broken", { location: { name: "Somewhere" } });
      const { pins, skipped } = groupIntoPins([broken, game("g1"), null]);
      expect(pins.map((pin) => pin.events.map((e) => e.id))).to.deep.equal([["g1"]]);
      expect(skipped).to.deep.equal([broken, null]);
    });

    it("gives the same spot the same key on every update, so home.js can update pins in place", () => {
      const first = groupIntoPins([game("g1")]).pins[0].key;
      const again = groupIntoPins([game("g1", { playerCount: 5 }), game("g2")]).pins[0].key;
      expect(again).to.equal(first);
    });

    it("handles no games, and puts games without a start time last", () => {
      expect(groupIntoPins([])).to.deep.equal({ pins: [], skipped: [] });
      expect(groupIntoPins(undefined)).to.deep.equal({ pins: [], skipped: [] });
      const { pins } = groupIntoPins([game("no-time", { startTime: null }), game("g1")]);
      expect(pins[0].events.map((e) => e.id)).to.deep.equal(["g1", "no-time"]);
    });
  });

  describe("pinLook and pinTitle", () => {
    it("shows the sport's icon on a pin with one game", () => {
      const [pin] = groupIntoPins([game("g1")]).pins;
      expect(pinLook(pin)).to.deep.equal({ icon: SPORT_ICONS.basketball, count: 1 });
      expect(pinTitle(pin)).to.equal("Basketball · 5v5 at North Boulder Park");
    });

    it("has an icon for every sport", () => {
      for (const sport of ["basketball", "soccer", "volleyball", "tennis", "pickleball", "football"]) {
        expect(SPORT_ICONS[sport], sport).to.be.a("string").and.not.equal("");
      }
    });

    it("counts the games at a shared spot, with the sport's icon when they're all one sport", () => {
      const [pin] = groupIntoPins([game("g1"), game("g2", { title: "" })]).pins;
      expect(pinLook(pin)).to.deep.equal({ icon: SPORT_ICONS.basketball, count: 2 });
      expect(pinTitle(pin)).to.equal("2 games at North Boulder Park");
    });

    it("uses the mixed icon when a spot has games of different sports", () => {
      const [pin] = groupIntoPins([game("g1"), game("g2", { sportId: "soccer" })]).pins;
      expect(pinLook(pin)).to.deep.equal({ icon: MIXED_ICON, count: 2 });
    });
  });

  describe("gameDetails (the popup)", () => {
    it("shows the game's name, place, address, date, and time", () => {
      const details = gameDetails(game("g1"), { timeZone });
      expect({ ...details, time: plain(details.time) }).to.deep.equal({
        id: "g1",
        name: "Basketball · 5v5",
        place: "North Boulder Park",
        address: "3195 4th St, Boulder, CO",
        date: "Sat, Nov 21",
        time: "6:00 PM – 8:00 PM",
        players: "4/10 players · 6 spots left",
        skill: "Casual",
      });
    });

    it("uses the sport as the name when the game has no title", () => {
      expect(gameDetails(game("g1", { title: "" }), { timeZone }).name).to.equal("Basketball");
    });

    it("says when a game is full", () => {
      const full = game("g1", { playerLimit: 4 });
      expect(gameDetails(full, { timeZone }).players).to.equal("4/4 players · Full");
      const oneLeft = game("g2", { playerLimit: 5 });
      expect(gameDetails(oneLeft, { timeZone }).players).to.equal("4/5 players · 1 spot left");
    });

    it("fills in gaps instead of showing undefined", () => {
      const sparse = gameDetails(
        {
          id: "g1",
          sportId: "tennis",
          location: { lat: 40, lng: -105 },
          startTime: null,
          participantIds: ["host"],
        },
        { timeZone },
      );
      expect(sparse).to.deep.equal({
        id: "g1",
        name: "Tennis",
        place: "Unnamed spot",
        address: "",
        date: "Date not set",
        time: "Time not set",
        players: "1 player",
        skill: "",
      });
      expect(JSON.stringify(sparse)).to.not.include("undefined");
    });

    it("shows only the start time when the end time is missing", () => {
      expect(plain(gameDetails(game("g1", { endTime: null }), { timeZone }).time)).to.equal("6:00 PM");
    });

    it("shows a late game that ends after midnight", () => {
      const late = game("g1", {
        startTime: new Date("2026-11-22T05:00:00Z"), // 10 PM
        endTime: new Date("2026-11-22T08:00:00Z"), // 1 AM
      });
      expect(plain(gameDetails(late, { timeZone }).time)).to.equal("10:00 PM – 1:00 AM");
    });
  });

  describe("gameCountText", () => {
    it("counts the games on the map", () => {
      expect(gameCountText(0)).to.equal("No upcoming games yet");
      expect(gameCountText(1)).to.equal("1 game available");
      expect(gameCountText(12)).to.equal("12 games available");
    });
  });
});
