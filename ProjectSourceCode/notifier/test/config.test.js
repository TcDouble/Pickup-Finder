// Tests for reading the notifier's settings from environment variables.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  test("defaults to the live project, Denver time, and a check every minute", () => {
    const config = loadConfig({});
    assert.equal(config.projectId, "sport-pick-up-app-team-4");
    assert.equal(config.usingEmulator, false);
    assert.equal(config.timeZone, "America/Denver");
    assert.equal(config.pollSeconds, 60);
    assert.equal(config.appUrl, "http://localhost:3000");
    assert.equal(config.email, null);
    assert.equal(config.sms, null);
    assert.equal(config.desktop, true);
  });

  test("uses the demo project and no desktop notifications on the emulators", () => {
    const config = loadConfig({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
    assert.equal(config.projectId, "demo-pickup-finder");
    assert.equal(config.usingEmulator, true);
    assert.equal(config.desktop, false);
  });

  test("turns on email and text messages only when their accounts are filled in", () => {
    const config = loadConfig({
      SMTP_URL: "smtps://me%40gmail.com:app-password@smtp.gmail.com:465",
      MAIL_FROM: "Pickup-Finder <me@gmail.com>",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_FROM: "+15005550006",
      APP_URL: "https://pickup.example.com/",
      DESKTOP_PUSH: "off",
    });
    assert.deepEqual(config.email, {
      smtpUrl: "smtps://me%40gmail.com:app-password@smtp.gmail.com:465",
      from: "Pickup-Finder <me@gmail.com>",
    });
    assert.deepEqual(config.sms, { accountSid: "AC123", authToken: "secret", from: "+15005550006" });
    assert.equal(config.appUrl, "https://pickup.example.com");
    assert.equal(config.desktop, false);
    assert.equal(loadConfig({ TWILIO_ACCOUNT_SID: "AC123" }).sms, null);
  });

  test("stops at startup on a bad time zone or check interval", () => {
    assert.throws(() => loadConfig({ TIME_ZONE: "Mars/Olympus" }), RangeError);
    assert.throws(() => loadConfig({ POLL_SECONDS: "1" }), /POLL_SECONDS/);
    assert.throws(() => loadConfig({ POLL_SECONDS: "soon" }), /POLL_SECONDS/);
  });
});
