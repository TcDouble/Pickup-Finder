import assert from "node:assert/strict";
import { test } from "node:test";
import { isNativeApp, shareMessage } from "../native/app-shell.js";

test("does nothing outside the iOS app", () => {
  assert.equal(isNativeApp(), false);
});

test("shares a game's sport, time, place and spots, without the sharer's distance", () => {
  const message = shareMessage({
    name: "Basketball",
    when: "Sat, Nov 21, 5:00 PM · Valmont Park",
    details: "3 spots left · 2.1 mi away · Casual",
  });
  assert.equal(message.title, "Basketball on PickupFinder");
  assert.equal(
    message.text,
    "Join me for pickup basketball on PickupFinder: Sat, Nov 21, 5:00 PM · Valmont Park. 3 spots left · Casual.",
  );
  assert.equal(message.url, undefined);
});

test("links to the website once it has an address", () => {
  const message = shareMessage({ name: "Soccer", when: "Sun · Field 2", siteUrl: "https://pickup.example.com/" });
  assert.equal(message.text, "Join me for pickup soccer on PickupFinder: Sun · Field 2.");
  assert.equal(message.url, "https://pickup.example.com/login-and-registration/home.html");
});
