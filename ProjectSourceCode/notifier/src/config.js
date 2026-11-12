// The notifier's settings, read from environment variables. Every variable is
// explained in .env.example.

const LIVE_PROJECT = "sport-pick-up-app-team-4";
const EMULATOR_PROJECT = "demo-pickup-finder";

export function loadConfig(env = process.env) {
  const usingEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  const timeZone = env.TIME_ZONE || "America/Denver";
  // Throws a RangeError for a time zone Node doesn't know, so a typo fails at startup.
  new Intl.DateTimeFormat("en-US", { timeZone });

  const pollSeconds = Number(env.POLL_SECONDS || 60);
  if (!(pollSeconds >= 10)) throw new Error("POLL_SECONDS has to be a number, 10 or more.");

  const hasTwilio = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
  return {
    projectId:
      env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || (usingEmulator ? EMULATOR_PROJECT : LIVE_PROJECT),
    usingEmulator,
    pollSeconds,
    appUrl: (env.APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
    timeZone,
    email: env.SMTP_URL
      ? { smtpUrl: env.SMTP_URL, from: env.MAIL_FROM || "Pickup-Finder <no-reply@pickup-finder.local>" }
      : null,
    sms: hasTwilio
      ? { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM }
      : null,
    // Firebase Cloud Messaging has no emulator, so desktop notifications need
    // the live project and a service account.
    desktop: !usingEmulator && env.DESKTOP_PUSH !== "off",
  };
}
