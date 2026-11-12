// Tests for the email, text message, and desktop channels, with fake services.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildChannels, desktopChannel, emailChannel, logChannel, smsChannel } from "../src/channels.js";

describe("emailChannel", () => {
  test("sends from our address to the player", async () => {
    const mails = [];
    const email = emailChannel({ transport: { sendMail: async (m) => mails.push(m) }, from: "Pickup-Finder <me@gmail.com>" });
    await email.send({ to: "bob@example.com", subject: "Hi", text: "Body" });
    assert.deepEqual(mails, [{ from: "Pickup-Finder <me@gmail.com>", to: "bob@example.com", subject: "Hi", text: "Body" }]);
  });
});

describe("smsChannel", () => {
  test("posts the text to Twilio with the account's login", async () => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ sid: "SM1" }) };
    };
    const sms = smsChannel({ accountSid: "AC123", authToken: "secret", from: "+15005550006", fetch });
    await sms.send({ to: "+13035550100", body: "Game at 6" });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from("AC123:secret").toString("base64")}`);
    assert.deepEqual(Object.fromEntries(calls[0].init.body), { To: "+13035550100", From: "+15005550006", Body: "Game at 6" });
  });

  test("throws with Twilio's reason when it refuses", async () => {
    const fetch = async () => ({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ message: "The number +13035550100 is unverified." }),
    });
    const sms = smsChannel({ accountSid: "AC123", authToken: "secret", from: "+15005550006", fetch });
    await assert.rejects(sms.send({ to: "+13035550100", body: "x" }), /400: The number \+13035550100 is unverified/);
  });
});

describe("desktopChannel", () => {
  const reply = (...results) => ({
    successCount: results.filter((r) => r === "ok").length,
    responses: results.map((r) => (r === "ok" ? { success: true } : { success: false, error: { code: r, message: r } })),
  });

  test("sends to every browser and reports the ones that are gone", async () => {
    const sent = [];
    const messaging = {
      sendEachForMulticast: async (m) => {
        sent.push(m);
        return reply("ok", "messaging/registration-token-not-registered");
      },
    };
    const result = await desktopChannel({ messaging }).send({
      tokens: ["t1", "t2"],
      title: "T",
      body: "B",
      link: "https://pickup.example.com/game.html?id=g1",
    });
    assert.deepEqual(result, { sent: 1, deadTokens: ["t2"] });
    assert.deepEqual(sent[0].notification, { title: "T", body: "B" });
    assert.equal(sent[0].webpush.fcmOptions.link, "https://pickup.example.com/game.html?id=g1");
  });

  test("leaves out the click link unless it's HTTPS, which FCM requires", async () => {
    let sent;
    const messaging = { sendEachForMulticast: async (m) => ((sent = m), reply("ok")) };
    await desktopChannel({ messaging }).send({ tokens: ["t1"], title: "T", body: "B", link: "http://localhost:3000/x" });
    assert.equal("webpush" in sent, false);
  });

  test("throws when no browser got it for a reason other than a dead token", async () => {
    const messaging = { sendEachForMulticast: async () => reply("messaging/internal-error") };
    await assert.rejects(
      desktopChannel({ messaging }).send({ tokens: ["t1"], title: "T", body: "B", link: "https://x" }),
      /internal-error/,
    );
  });
});

describe("buildChannels", () => {
  test("prints instead of sending for channels that aren't set up", async () => {
    const lines = [];
    const channels = await buildChannels(
      { email: null, sms: null, desktop: false },
      { log: (line) => lines.push(line) },
    );
    assert.equal(channels.email.logged, true);
    assert.equal(channels.sms.logged, true);
    assert.equal(channels.desktop.logged, true);
    const result = await channels.email.send({ to: "bob@example.com", subject: "Game soon", text: "..." });
    assert.equal(result.logged, true);
    assert.deepEqual(lines, ["[email not set up] would send: Game soon"]);
  });

  test("uses the real channels when their accounts are set", async () => {
    const channels = await buildChannels(
      {
        email: { smtpUrl: "smtp://user:pass@127.0.0.1:2525", from: "x@example.com" },
        sms: { accountSid: "AC1", authToken: "t", from: "+15005550006" },
        desktop: true,
      },
      { messaging: { sendEachForMulticast: async () => ({ successCount: 0, responses: [] }) } },
    );
    assert.equal(channels.email.name, "email");
    assert.equal(channels.email.logged, undefined);
    assert.equal(channels.sms.logged, undefined);
    assert.equal(channels.desktop.logged, undefined);
  });

  test("log channels never print addresses or phone numbers", async () => {
    const lines = [];
    await logChannel("sms", (l) => lines.push(l)).send({ to: "+13035550100", body: "Basketball at 6" });
    assert.ok(!lines.join(" ").includes("+1303"));
  });
});
