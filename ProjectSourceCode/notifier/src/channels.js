// The three ways the notifier reaches people. Each channel has one method,
// send(), and throws if the message didn't go out.
//
// A channel that isn't set up (no SMTP account, no Twilio account, or running
// on the emulators) is replaced by a log channel that prints what it would have
// sent, so the notifier can be demoed without any accounts.

// FCM error codes that mean a browser's token will never work again (the user
// blocked notifications, cleared site data, or the token expired).
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/** Email over SMTP. `transport` is a nodemailer transport. */
export function emailChannel({ transport, from }) {
  return {
    name: "email",
    async send({ to, subject, text }) {
      await transport.sendMail({ from, to, subject, text });
      return {};
    },
  };
}

/** Text messages through Twilio's REST API. */
export function smsChannel({ accountSid, authToken, from, fetch = globalThis.fetch }) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  return {
    name: "sms",
    async send({ to, body }) {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, From: from, Body: body }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(`Twilio said ${res.status}: ${detail.message ?? res.statusText}`);
      }
      return {};
    },
  };
}

/**
 * Desktop (browser push) notifications through Firebase Cloud Messaging.
 * `messaging` is the Admin SDK's getMessaging(). Returns how many browsers got
 * it, and the tokens that will never work again so they can be forgotten.
 */
export function desktopChannel({ messaging }) {
  return {
    name: "desktop",
    async send({ tokens, title, body, link }) {
      const res = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        // FCM only accepts HTTPS links for the click.
        ...(link.startsWith("https://") ? { webpush: { fcmOptions: { link } } } : {}),
      });
      const deadTokens = [];
      const errors = [];
      res.responses.forEach((r, i) => {
        if (r.success) return;
        if (DEAD_TOKEN_CODES.has(r.error?.code)) deadTokens.push(tokens[i]);
        else errors.push(r.error?.message ?? "unknown error");
      });
      if (res.successCount === 0 && errors.length > 0) throw new Error(errors[0]);
      return { sent: res.successCount, deadTokens };
    },
  };
}

/** Stand-in for a channel that isn't set up: prints the message instead. */
export function logChannel(name, log) {
  return {
    name,
    logged: true,
    async send(message) {
      const text = message.subject ?? message.title ?? message.body;
      log(`[${name} not set up] would send: ${text}`);
      return { logged: true, sent: message.tokens?.length ?? 1, deadTokens: [] };
    },
  };
}

/** The real channels where config sets them up, and log channels for the rest. */
export async function buildChannels(config, { messaging = null, log = console.log } = {}) {
  let email = logChannel("email", log);
  if (config.email) {
    const { default: nodemailer } = await import("nodemailer");
    email = emailChannel({ transport: nodemailer.createTransport(config.email.smtpUrl), from: config.email.from });
  }
  return {
    email,
    sms: config.sms ? smsChannel(config.sms) : logChannel("sms", log),
    desktop: config.desktop && messaging ? desktopChannel({ messaging }) : logChannel("desktop", log),
  };
}
