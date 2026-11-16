// Unit tests for the Edit profile checks. validateProfile.js has no Firebase
// imports, so no browser, network, emulator or database is involved.
import { expect } from "chai";
import { validateProfile, MAX_BIO, MAX_CITY, MAX_NAME } from "../login-and-registration/validateProfile.js";

const full = {
  displayName: "  Riley  ",
  city: " Boulder ",
  sports: ["basketball", "soccer"],
  sportLevels: { basketball: "casual", soccer: "competitive", tennis: "casual" },
  bio: " Evenings, usually point guard. ",
};

describe("validateProfile (unit)", () => {
  it("accepts a full profile and returns it cleaned up", () => {
    const result = validateProfile(full);
    expect(result.valid).to.equal(true);
    expect(result.errors).to.deep.equal([]);
    expect(result.value).to.deep.equal({
      displayName: "Riley",
      city: "Boulder",
      sports: ["basketball", "soccer"],
      sportLevels: { basketball: "casual", soccer: "competitive" },
      bio: "Evenings, usually point guard.",
    });
  });

  it("drops levels for sports that aren't picked", () => {
    expect(validateProfile(full).value.sportLevels).to.not.have.property("tennis");
  });

  it("accepts a minimal profile with just a name", () => {
    const result = validateProfile({ displayName: "Riley" });
    expect(result.valid).to.equal(true);
    expect(result.value).to.deep.equal({ displayName: "Riley", city: "", sports: [], sportLevels: {}, bio: "" });
  });

  it("rejects a blank display name", () => {
    expect(validateProfile({ ...full, displayName: "   " }).errors).to.deep.equal(["Enter a display name."]);
  });

  it(`rejects a display name over ${MAX_NAME} characters`, () => {
    expect(validateProfile({ ...full, displayName: "x".repeat(MAX_NAME) }).valid).to.equal(true);
    expect(validateProfile({ ...full, displayName: "x".repeat(MAX_NAME + 1) }).errors).to.deep.equal([
      `Display name must be ${MAX_NAME} characters or fewer.`,
    ]);
  });

  it(`rejects a city over ${MAX_CITY} characters`, () => {
    expect(validateProfile({ ...full, city: "x".repeat(MAX_CITY + 1) }).errors).to.deep.equal([
      `City must be ${MAX_CITY} characters or fewer.`,
    ]);
  });

  it(`rejects an About over ${MAX_BIO} characters`, () => {
    expect(validateProfile({ ...full, bio: "x".repeat(MAX_BIO) }).valid).to.equal(true);
    expect(validateProfile({ ...full, bio: "x".repeat(MAX_BIO + 1) }).errors).to.deep.equal([
      `About must be ${MAX_BIO} characters or fewer.`,
    ]);
  });

  it("rejects a level other than casual or competitive", () => {
    const result = validateProfile({ ...full, sportLevels: { basketball: "pro" } });
    expect(result.errors).to.deep.equal(["Pick Casual or Competitive for each sport."]);
  });

  it("rejects a picture that isn't an image", () => {
    const result = validateProfile({ ...full, photo: { type: "text/plain", size: 10 } });
    expect(result.errors).to.deep.equal(["Profile picture must be a PNG, JPEG, WebP or GIF."]);
  });

  it("lists every problem in form order", () => {
    const result = validateProfile({
      photo: { type: "text/plain", size: 10 },
      displayName: "",
      city: "x".repeat(MAX_CITY + 1),
      bio: "x".repeat(MAX_BIO + 1),
    });
    expect(result.errors).to.deep.equal([
      "Profile picture must be a PNG, JPEG, WebP or GIF.",
      "Enter a display name.",
      `City must be ${MAX_CITY} characters or fewer.`,
      `About must be ${MAX_BIO} characters or fewer.`,
    ]);
  });
});
