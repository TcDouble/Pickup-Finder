import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PAGE_DIRS, addShellScript, isPageFile, mapsConfigSource, patchFirebaseConfig } from "../scripts/build-web.js";

test("copies the files pages load, not tests, packages, rules or keys", () => {
  assert.equal(isPageFile("login-and-registration/home.html"), true);
  assert.equal(isPageFile("firebase/events.js"), true);
  assert.equal(isPageFile("assets/style.css"), true);
  assert.equal(isPageFile("assets/no-profile-picture-icon.svg"), true);

  assert.equal(isPageFile("firebase/tests/events.test.js"), false);
  assert.equal(isPageFile("firebase/node_modules/firebase/app.js"), false);
  assert.equal(isPageFile("firebase/firestore.rules"), false);
  assert.equal(isPageFile("firebase/package.json"), false);
  assert.equal(isPageFile("login-and-registration/MAPS_SETUP.md"), false);
  assert.equal(isPageFile("login-and-registration/maps-config.local.js"), false);
  assert.equal(isPageFile("assets/.DS_Store"), false);
});

// index.js isn't imported here: it needs express, which only the website installs.
test("copies the same page folders the website's server serves", () => {
  const server = readFileSync(new URL("../../index.js", import.meta.url), "utf8");
  const list = server.match(/const PUBLIC_DIRS = \[([^\]]*)\]/);
  assert.ok(list, "index.js has no PUBLIC_DIRS list");
  const served = [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...PAGE_DIRS].sort(), served.sort());
});

test("loads the app shell script once, before the page's own scripts", () => {
  const page = '<html><head><title>x</title></head><body><script type="module" src="home.js"></script></body></html>';
  const once = addShellScript(page);
  assert.match(once, /<script type="module" src="\/native\/app-shell.js"><\/script>\n<\/head>/);
  assert.ok(once.indexOf("app-shell.js") < once.indexOf("home.js"));
  assert.equal(addShellScript(once), once);
  assert.throws(() => addShellScript("<p>no head</p>"));
});

test("writes the Maps key like the website's server does", () => {
  assert.equal(mapsConfigSource(" abc "), 'export const MAPS_API_KEY = "abc";\n');
  assert.match(mapsConfigSource(""), /export const MAPS_API_KEY = "";/);
  assert.match(mapsConfigSource(undefined), /console\.warn/);
});

test("starts Firebase Auth without the popup helper that hangs inside the app", async () => {
  const { readFileSync } = await import("node:fs");
  const site = readFileSync(new URL("../../firebase/firebase-config.js", import.meta.url), "utf8");
  const app = patchFirebaseConfig(site);
  assert.match(app, /import \{ initializeAuth, indexedDBLocalPersistence, browserLocalPersistence \} from "https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-auth\.js";/);
  assert.match(app, /export const auth = initializeAuth\(app, \{ persistence: \[indexedDBLocalPersistence, browserLocalPersistence\] \}\);/);
  assert.doesNotMatch(app, /getAuth/);
  assert.throws(() => patchFirebaseConfig("export const auth = something;"), /firebase-config\.js changed/);
});
