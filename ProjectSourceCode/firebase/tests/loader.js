// Node module hook used only by the tests.
//
// events.js and the other app modules import Firestore from the gstatic CDN
// (like the rest of the site) and get `db`/`auth` from ./firebase-config.js,
// which points at the real project. In tests we swap both:
//   - CDN URLs -> the same version from npm (firebase@10.12.2)
//   - ./firebase-config.js -> tests/emulator-config.js, connected to the emulators
//
// Importing "../events.js?as=bob" gives a separate copy of events.js with its
// own signed-in user, so tests can act as several people at once. The "?as=bob"
// is passed on to the files it imports, so sportsmanship.js?as=bob uses
// events.js?as=bob and the same signed-in user.

const CDN = "https://www.gstatic.com/firebasejs/10.12.2/firebase-";
const FIREBASE_DIR = new URL("../", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(CDN)) {
    const name = specifier.slice(CDN.length).replace(/\.js$/, ""); // "firestore", "auth", "app"
    return next(`firebase/${name}`, context);
  }
  // Only the app's own files (events.js and friends), not tests/ or node_modules/.
  const parent = context.parentURL ?? "";
  const fromAppModule = parent.startsWith(FIREBASE_DIR) && !parent.slice(FIREBASE_DIR.length).includes("/");
  if (fromAppModule && specifier.startsWith("./")) {
    const as = new URL(parent).search; // "?as=bob" or ""
    if (specifier === "./firebase-config.js") {
      return { url: new URL(`./emulator-config.js${as}`, import.meta.url).href, shortCircuit: true };
    }
    return { url: new URL(specifier, parent).href + as, shortCircuit: true };
  }
  return next(specifier, context);
}
