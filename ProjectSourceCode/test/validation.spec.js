// Lab 10 unit test: the sign-up checks on their own. No browser, network,
// emulator, or database is involved; validateRegistration.js has no imports.
import { expect } from "chai";
import {
  validateRegistration,
  MIN_PASSWORD_LENGTH,
} from "../login-and-registration/validateRegistration.js";

const good = {
  displayName: "  Riley  ",
  email: " riley@example.com ",
  password: "correct-horse-1",
  confirm: "correct-horse-1",
  city: " Boulder ",
  sports: ["basketball", "soccer"],
};

describe("validateRegistration (unit)", () => {
  it("accepts a complete sign-up and returns the cleaned-up profile without the password", () => {
    const result = validateRegistration(good);
    expect(result.valid).to.equal(true);
    expect(result.errors).to.deep.equal([]);
    expect(result.value).to.deep.equal({
      displayName: "Riley",
      email: "riley@example.com",
      city: "Boulder",
      sports: ["basketball", "soccer"],
    });
    expect(result.value).to.not.have.property("password");
  });

  it("rejects a missing password", () => {
    const result = validateRegistration({ ...good, password: "", confirm: "" });
    expect(result.valid).to.equal(false);
    expect(result.errors).to.deep.equal(["Enter a password."]);
  });

  it(`rejects a password shorter than ${MIN_PASSWORD_LENGTH} characters`, () => {
    const result = validateRegistration({ ...good, password: "short", confirm: "short" });
    expect(result.valid).to.equal(false);
    expect(result.errors).to.deep.equal([`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`]);
  });

  it("rejects passwords that don't match", () => {
    const result = validateRegistration({ ...good, confirm: "correct-horse-2" });
    expect(result.valid).to.equal(false);
    expect(result.errors).to.deep.equal(["Passwords don't match."]);
  });

  it("rejects a badly formed email", () => {
    const result = validateRegistration({ ...good, email: "riley@example" });
    expect(result.valid).to.equal(false);
    expect(result.errors).to.deep.equal(["Please enter a valid email address."]);
  });

  it("rejects a blank display name, listing every problem in form order", () => {
    const result = validateRegistration({ displayName: "   ", email: "", password: "" });
    expect(result.valid).to.equal(false);
    expect(result.errors).to.deep.equal(["Enter a display name.", "Enter your email.", "Enter a password."]);
  });

  it("skips email and password when an already signed-in user is finishing their profile", () => {
    const result = validateRegistration({ displayName: "Riley" }, { needsCredentials: false });
    expect(result.valid).to.equal(true);
  });
});
