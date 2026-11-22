// Builds mobile/www, the web content the iOS app shows, from the website's pages.
//
// The app runs the same pages as the website (same Firebase project, same
// features), so this script only copies them, adds the Maps key, and loads
// native/app-shell.js on every page for the iOS-only extras (the share sheet).
// It never changes the website's own files.
//
//   npm run build:web                  # copy the pages into www/
//   MAPS_API_KEY=<key> npm run build:web   # same, with the Google Maps key
//
// `npm run sync` runs this and then `cap sync ios`, which copies www/ into the
// Xcode project.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_DIR = path.resolve(MOBILE_DIR, "..");
const OUT_DIR = path.join(MOBILE_DIR, "www");

// The same folders ProjectSourceCode/index.js serves to browsers
// (test/build-web.test.js checks that the two lists match).
export const PAGE_DIRS = [
  "assets",
  "create-game",
  "edit-game",
  "firebase",
  "login-and-registration",
  "notifications",
  "rate-players",
  "recommended",
  "social",
];

// The page the app opens on. Like the website's "/", it sends signed-out users to login.
export const START_PAGE = "login-and-registration/home.html";

const MAPS_CONFIG = "login-and-registration/maps-config.local.js";
const SHELL_SCRIPT = '<script type="module" src="/native/app-shell.js"></script>';
const COPIED_TYPES = new Set([".html", ".js", ".css", ".png", ".svg", ".jpg", ".jpeg", ".gif", ".webp", ".ico"]);

const isSkippedDir = (name) => name === "node_modules" || name === "test" || name === "tests" || name.startsWith(".");

/** True for files the pages load; false for tests, packages, rules, docs and local keys. */
export function isPageFile(relPath) {
  const parts = relPath.split(/[\\/]/);
  if (parts.slice(0, -1).some(isSkippedDir) || parts.at(-1).startsWith(".")) return false;
  if (parts.join("/") === MAPS_CONFIG) return false;
  return COPIED_TYPES.has(path.extname(relPath).toLowerCase());
}

/** Load the app shell script on a page, before its own scripts run. */
export function addShellScript(html) {
  if (html.includes(SHELL_SCRIPT)) return html;
  if (!/<\/head>/i.test(html)) throw new Error("Page has no </head> to add the app shell script to");
  return html.replace(/<\/head>/i, `  ${SHELL_SCRIPT}\n</head>`);
}

/**
 * Start Firebase Auth without its popup and redirect sign-in helper.
 *
 * On iOS, getAuth() first loads that helper in a hidden frame from the
 * firebaseapp.com domain. Inside the app that frame never loads, so Auth never
 * finishes starting and every page stays blank. The site only uses email and
 * password sign-in, so the app doesn't need the helper.
 */
export function patchFirebaseConfig(source) {
  const importLine = /import \{ getAuth \} from "(https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-auth\.js)";/;
  const authLine = "export const auth = getAuth(app);";
  if (!importLine.test(source) || !source.includes(authLine)) {
    throw new Error("firebase/firebase-config.js changed: update patchFirebaseConfig in mobile/scripts/build-web.js");
  }
  return source
    .replace(
      importLine,
      'import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence } from "$1";',
    )
    .replace(
      authLine,
      "// iOS app: no popup/redirect helper (see mobile/scripts/build-web.js).\n" +
        "export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });",
    );
}

/** The maps-config.local.js the home page imports, like index.js builds it for the website. */
export function mapsConfigSource(key) {
  const trimmed = key?.trim();
  if (trimmed) return `export const MAPS_API_KEY = ${JSON.stringify(trimmed)};\n`;
  return (
    'console.warn("No Google Maps key: run `MAPS_API_KEY=<key> npm run sync` in ProjectSourceCode/mobile.");\n' +
    'export const MAPS_API_KEY = "";\n'
  );
}

function listFiles(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) return isSkippedDir(entry.name) ? [] : listFiles(path.join(dir, entry.name), rel);
    return isPageFile(rel) ? [rel] : [];
  });
}

export function buildWeb({ mapsApiKey = process.env.MAPS_API_KEY, log = console.log } = {}) {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  let count = 0;
  for (const dir of PAGE_DIRS) {
    for (const rel of listFiles(path.join(SITE_DIR, dir), dir)) {
      const from = path.join(SITE_DIR, rel);
      const to = path.join(OUT_DIR, rel);
      mkdirSync(path.dirname(to), { recursive: true });
      if (rel.endsWith(".html")) writeFileSync(to, addShellScript(readFileSync(from, "utf8")));
      else if (rel === path.join("firebase", "firebase-config.js")) writeFileSync(to, patchFirebaseConfig(readFileSync(from, "utf8")));
      else cpSync(from, to);
      count += 1;
    }
  }

  // A developer's own maps-config.local.js (see MAPS_SETUP.md) is used when MAPS_API_KEY isn't set.
  const localMapsConfig = path.join(SITE_DIR, MAPS_CONFIG);
  const hasKey = Boolean(mapsApiKey?.trim());
  if (!hasKey && existsSync(localMapsConfig)) cpSync(localMapsConfig, path.join(OUT_DIR, MAPS_CONFIG));
  else writeFileSync(path.join(OUT_DIR, MAPS_CONFIG), mapsConfigSource(mapsApiKey));

  cpSync(path.join(MOBILE_DIR, "native"), path.join(OUT_DIR, "native"), { recursive: true });
  writeFileSync(
    path.join(OUT_DIR, "index.html"),
    `<!DOCTYPE html>\n<meta charset="utf-8">\n<title>PickupFinder</title>\n` +
      `<script>location.replace(${JSON.stringify(START_PAGE)});</script>\n`,
  );

  log(`Copied ${count} page files into www/` + (hasKey || existsSync(localMapsConfig) ? "" : " (no Maps key, so the map won't load)"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildWeb();
}
