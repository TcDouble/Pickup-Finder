// Shared setup for the integration tests: connects to the Firebase emulators
// that `npm test` starts, and gives the tests an "admin" view of the data so
// they can check exactly what was saved and clean up after themselves.
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, setLogLevel } from "firebase/firestore";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

// `firebase emulators:exec` sets these for the test process.
export const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;

// Denied writes are expected in some tests; don't print a warning for each one.
setLogLevel("error");

/**
 * The Firebase version of the lab's "only run against a database whose name
 * ends in _test" guard: refuse to run unless the emulators are up and the
 * project is a "demo-" project, which can never reach the live Firebase project.
 */
export function assertTestProject() {
  if (!AUTH_HOST || !FIRESTORE_HOST) {
    throw new Error("The Firebase emulators aren't running. Run the tests with `npm test`.");
  }
  if (!PROJECT_ID.startsWith("demo-")) {
    throw new Error(`Refusing to run tests against project "${PROJECT_ID}". Use a demo- project.`);
  }
}

function hostAndPort(value) {
  const i = value.lastIndexOf(":");
  return { host: value.slice(0, i).replace(/^\[|\]$/g, ""), port: Number(value.slice(i + 1)) };
}

/** A Firebase app wired to the emulators, shaped like ../firebase/firebase-config.js. */
export function emulatorApp(name) {
  assertTestProject();
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-key" }, name);
  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const { host, port } = hostAndPort(FIRESTORE_HOST);
  connectFirestoreEmulator(db, host, port);
  return { app, auth, db };
}

/** Admin access to the Firestore emulator (security rules bypassed only where asked). */
export function startTestEnv() {
  assertTestProject();
  const { host, port } = hostAndPort(FIRESTORE_HOST);
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port,
      rules: readFileSync(new URL("../firebase/firestore.rules", import.meta.url), "utf8"),
    },
  });
}

/** Every document in `collection` whose `field` equals `value`, read with rules off. */
export async function findDocs(testEnv, collection, field, value) {
  let docs = [];
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await ctx.firestore().collection(collection).where(field, "==", value).get();
    docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  return docs;
}

export async function deleteDocById(testEnv, collection, id) {
  await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().collection(collection).doc(id).delete());
}

// The Auth emulator accepts "Bearer owner" as an admin token.
async function authAdmin(action, body) {
  const url = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/${action}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Auth emulator ${action} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Auth accounts with this email (0 or 1). */
export async function findAuthUsers(email) {
  const result = await authAdmin("accounts:lookup", { email: [email] });
  return result.users ?? [];
}

export async function deleteAuthUser(uid) {
  await authAdmin("accounts:delete", { localId: uid });
}

/** A fresh address for each test, so reruns never collide with old data. */
export function uniqueEmail(label) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Wait for a promise that should fail, and return the error. */
export async function rejects(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("Expected this to fail, but it succeeded.");
}
