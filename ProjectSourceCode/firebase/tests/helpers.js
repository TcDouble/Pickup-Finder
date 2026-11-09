// Shared test helpers.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp } from "firebase/app";
import { setLogLevel } from "firebase/firestore";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
const PROJECT_ID = "demo-pickup-finder"; // same as emulator-config.js and package.json

// Denied writes are expected in these tests; don't print a warning for each one.
setLogLevel("error");

export const BOULDER = { lat: 40.015, lng: -105.2705 };
export const DENVER = { lat: 39.7392, lng: -104.9903 }; // about 40 km from Boulder

export const hoursFromNow = (h) => new Date(Date.now() + h * 60 * 60 * 1000);

export function startTestEnv() {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
}

// Copies of the app's modules for one user: events.js, sportsmanship.js, and
// matchmaking.js, all sharing that user's emulator app.
async function loadModules(tag) {
  const events = await import(`../events.js?as=${tag}`);
  const sportsmanship = await import(`../sportsmanship.js?as=${tag}`);
  const matchmaking = await import(`../matchmaking.js?as=${tag}`);
  const config = await import(`./emulator-config.js?as=${tag}`);
  return { modules: { ...events, ...sportsmanship, ...matchmaking }, config };
}

/** Load a copy of the app's modules signed in as a new emulator user. */
export async function signedInAs(name) {
  const tag = `${name}-${Math.random().toString(36).slice(2, 8)}`;
  const { modules, config } = await loadModules(tag);
  const cred = await createUserWithEmailAndPassword(config.auth, `${tag}@example.com`, "password123");
  await updateProfile(cred.user, { displayName: name });
  return { ...modules, uid: cred.user.uid, app: config.app };
}

/** A copy of the app's modules with nobody signed in. */
export async function signedOut() {
  const tag = `anon-${Math.random().toString(36).slice(2, 8)}`;
  const { modules, config } = await loadModules(tag);
  return { ...modules, app: config.app };
}

export async function closeAll(users) {
  await Promise.all(users.map((u) => deleteApp(u.app)));
}

/** Valid input for createEvent; override any field. */
export function gameInput(overrides = {}) {
  return {
    sportId: "basketball",
    title: "5v5",
    description: "Bring a light and a dark shirt.",
    skillLevel: "casual",
    startTime: hoursFromNow(2),
    endTime: hoursFromNow(4),
    location: { name: "North Boulder Park", address: "Boulder, CO", ...BOULDER },
    playerLimit: 10,
    ...overrides,
  };
}
