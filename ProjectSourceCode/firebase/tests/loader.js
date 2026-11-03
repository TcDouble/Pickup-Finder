// Node module hook used only by the tests.
//
// events.js imports Firestore from the gstatic CDN (like the rest of the site)
// and gets `db`/`auth` from ../firebase-config.js, which points at the real
// project. In tests we swap both:
//   - CDN URLs -> the same version from npm (firebase@10.12.2)
//   - ./firebase-config.js -> tests/emulator-config.js, connected to the emulators
//
// Importing "../events.js?as=bob" gives a separate copy of events.js with its
// own signed-in user, so tests can act as several people at once.

const CDN = "https://www.gstatic.com/firebasejs/10.12.2/firebase-";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(CDN)) {
    const name = specifier.slice(CDN.length).replace(/\.js$/, ""); // "firestore", "auth", "app"
    return next(`firebase/${name}`, context);
  }
  if (specifier === "./firebase-config.js" && context.parentURL?.includes("/events.js")) {
    const as = new URL(context.parentURL).search; // "?as=bob" or ""
    return { url: new URL(`./emulator-config.js${as}`, import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
