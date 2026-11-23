// Unit tests for the Settings checks. validateSettings.js has no Firebase
// imports, so no browser, network, emulator or database is involved.
import { expect } from "chai";
import { DEFAULT_SETTINGS, validateSettings } from "../login-and-registration/validateSettings.js";
import { MAX_CITY } from "../login-and-registration/validateRegistration.js";

describe("validateSettings (unit)", () => {
  it("accepts every setting with a good value", () => {
    const result = validateSettings({
      showCity: false,
      privateCity: " Boulder ",
      homeArea: { label: " Folsom Field ", lat: 40.0092, lng: -105.2669 },
      units: "km",
      startSports: ["soccer", "tennis", "soccer"],
      friendRequests: "nobody",
    });
    expect(result.valid).to.equal(true);
    expect(result.value).to.deep.equal({
      showCity: false,
      privateCity: "Boulder",
      homeArea: { label: "Folsom Field", lat: 40.0092, lng: -105.2669 },
      units: "km",
      startSports: ["soccer", "tennis"],
      friendRequests: "nobody",
    });
  });

  it("checks only the settings being saved", () => {
    expect(validateSettings({ units: "mi" })).to.deep.equal({ valid: true, errors: [], value: { units: "mi" } });
  });

  it("accepts the defaults", () => {
    const { homeArea, ...rest } = DEFAULT_SETTINGS;
    expect(validateSettings({ ...rest, homeArea }).valid).to.equal(true);
  });

  it("accepts clearing the home area", () => {
    expect(validateSettings({ homeArea: null }).value).to.deep.equal({ homeArea: null });
  });

  it("rejects a unit other than miles or kilometers", () => {
    expect(validateSettings({ units: "ft" }).errors).to.deep.equal(["Pick miles or kilometers."]);
  });

  it("rejects a sport that isn't in the list", () => {
    expect(validateSettings({ startSports: ["quidditch"] }).errors).to.deep.equal(["Pick sports from the list."]);
  });

  it("rejects an unknown friend request choice", () => {
    expect(validateSettings({ friendRequests: "friends-of-friends" }).errors).to.deep.equal([
      "Pick who can send you friend requests.",
    ]);
  });

  it("rejects a home area off the map", () => {
    for (const area of [{ label: "x", lat: 91, lng: 0 }, { label: "x", lat: 0, lng: -181 }, { label: "x" }]) {
      expect(validateSettings({ homeArea: area }).errors).to.deep.equal(["That home area isn't a valid place."]);
    }
  });

  it(`rejects a private city over ${MAX_CITY} characters`, () => {
    expect(validateSettings({ privateCity: "x".repeat(MAX_CITY + 1) }).errors).to.deep.equal([
      `City must be ${MAX_CITY} characters or fewer.`,
    ]);
  });

  it("rejects a show-city value that isn't on or off", () => {
    expect(validateSettings({ showCity: "yes" }).errors).to.deep.equal(["Show my city must be on or off."]);
  });
});
