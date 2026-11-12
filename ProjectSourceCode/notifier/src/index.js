// Starts the notifier: checks Firestore every POLL_SECONDS and sends match
// alerts, game reminders, and feedback requests. See ../README.md.
//
//   npm start          keep running (what the Docker container does)
//   npm run once       one pass, then exit

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { buildChannels } from "./channels.js";
import { loadConfig } from "./config.js";
import { runOnce } from "./notifier.js";

const log = (...args) => console.log(new Date().toISOString(), ...args);

// Settings come from the environment, and from notifier/.env if there is one
// (variables already set in the environment win). Docker passes .env in itself.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}
const config = loadConfig();
const once = process.argv.includes("--once");

// With FIRESTORE_EMULATOR_HOST set, the Admin SDK talks to the emulators and
// needs no login. Otherwise it uses the service account key that
// GOOGLE_APPLICATION_CREDENTIALS points to.
if (config.usingEmulator) {
  // Don't look for a Google Cloud server to log in through (it only prints a warning).
  process.env.METADATA_SERVER_DETECTION ??= "none";
}
const app = initializeApp({ projectId: config.projectId });
const db = getFirestore(app);
const auth = getAuth(app);
const channels = await buildChannels(config, { messaging: config.desktop ? getMessaging(app) : null, log });

const status = (name) => (channels[name].logged ? "not set up (printing instead)" : "on");
log(
  `Notifier for ${config.projectId}${config.usingEmulator ? " (emulators)" : ""}.`,
  `Email ${status("email")}, text messages ${status("sms")}, desktop ${status("desktop")}.`,
  once ? "Running once." : `Checking every ${config.pollSeconds} seconds.`,
);

let timer = null;
let running = false;
let stopping = false;

async function tick() {
  running = true;
  try {
    const { match, reminder, feedback, errors } = await runOnce({ db, auth, channels, config, log });
    if (match + reminder + feedback > 0 || errors.length > 0) {
      const count = (n, what) => `${n} ${what}${n === 1 ? "" : "s"}`;
      log(`Sent ${count(match, "match alert")}, ${count(reminder, "reminder")}, ${count(feedback, "feedback request")}.`);
    }
  } catch (err) {
    log("Check failed:", err);
  }
  running = false;
  if (once || stopping) process.exit(0);
  timer = setTimeout(tick, config.pollSeconds * 1000);
}

// `docker compose stop` sends SIGTERM. Finish the pass in progress, then exit.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log(`Got ${signal}, stopping.`);
    stopping = true;
    clearTimeout(timer);
    if (!running) process.exit(0);
  });
}

await tick();
