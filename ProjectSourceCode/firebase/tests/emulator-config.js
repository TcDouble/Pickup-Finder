// Stand-in for ../firebase-config.js during tests: same exports, but connected
// to the local emulators. Each "?as=name" import is its own app, so each one
// can be signed in as a different user.
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

export const PROJECT_ID = "demo-pickup-finder";
const name = new URL(import.meta.url).searchParams.get("as") ?? "default";

export const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-key" }, name);
export const auth = getAuth(app);
export const db = getFirestore(app);

connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFirestoreEmulator(db, "127.0.0.1", 8080);
