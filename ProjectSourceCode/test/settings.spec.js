// Integration tests for the Settings screen's functions in settings.js, run
// on the Auth and Firestore emulators with the real security rules.
import { expect } from "chai";
import { deleteApp } from "firebase/app";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { registerUser } from "../login-and-registration/registerUser.js";
import { getProfile, saveProfile } from "../login-and-registration/profile.js";
import {
  changeEmail,
  changePassword,
  getSettings,
  saveSettings,
  setCityPrivacy,
} from "../login-and-registration/settings.js";
import { DEFAULT_SETTINGS } from "../login-and-registration/validateSettings.js";
import {
  emulatorApp,
  startTestEnv,
  deleteDocById,
  deleteAuthUser,
  findAuthUsers,
  sentEmails,
  uniqueEmail,
  rejects,
} from "./emulator.js";

const PASSWORD = "correct-horse-1";

describe("settings.js (Settings screen on the Firebase emulators)", () => {
  let site;
  let testEnv;
  const createdUids = [];

  before(async () => {
    site = emulatorApp("settings-tests");
    testEnv = await startTestEnv();
  });

  afterEach(async () => {
    if (!site) return;
    await signOut(site.auth);
    for (const uid of createdUids.splice(0)) {
      await deleteDocById(testEnv, "users", uid);
      await deleteDocById(testEnv, "settings", uid);
      await deleteAuthUser(uid).catch(() => {});
    }
  });

  after(async () => {
    if (site) await deleteApp(site.app);
    await testEnv?.cleanup();
  });

  async function signUp(label) {
    const email = uniqueEmail(label);
    const { uid } = await registerUser(site, {
      displayName: "Riley",
      email,
      password: PASSWORD,
      confirm: PASSWORD,
      city: "Boulder",
    });
    createdUids.push(uid);
    return { uid, email };
  }

  // What another signed-in player sees when they read this profile.
  async function profileAsOtherPlayer(uid) {
    const snap = await testEnv.authenticatedContext("someone-else").firestore().doc(`users/${uid}`).get();
    return snap.data();
  }

  describe("getSettings and saveSettings", () => {
    it("gives the defaults before anything is saved", async () => {
      const { uid } = await signUp("defaults");
      expect(await getSettings(site, uid)).to.deep.equal(DEFAULT_SETTINGS);
    });

    it("saves settings and reads them back, keeping the rest", async () => {
      const { uid } = await signUp("save");
      await saveSettings(site, { units: "km", startSports: ["soccer"] });
      const saved = await saveSettings(site, {
        homeArea: { label: "Folsom Field", lat: 40.0092, lng: -105.2669 },
        friendRequests: "nobody",
      });

      expect(saved).to.deep.equal({
        ...DEFAULT_SETTINGS,
        units: "km",
        startSports: ["soccer"],
        homeArea: { label: "Folsom Field", lat: 40.0092, lng: -105.2669 },
        friendRequests: "nobody",
      });
      expect(await getSettings(site, uid)).to.deep.equal(saved);
    });

    it("rejects a bad value before writing anything", async () => {
      const { uid } = await signUp("badsetting");
      const err = await rejects(saveSettings(site, { units: "ft" }));
      expect(err.code).to.equal("settings/invalid");
      expect(err.message).to.equal("Pick miles or kilometers.");
      expect(await getSettings(site, uid)).to.deep.equal(DEFAULT_SETTINGS);
    });
  });

  describe("setCityPrivacy", () => {
    it("hiding the city takes it out of the public profile, and you still see it", async () => {
      const { uid } = await signUp("hidecity");

      const settings = await setCityPrivacy(site, false);

      expect(settings).to.include({ showCity: false, privateCity: "Boulder" });
      expect(await profileAsOtherPlayer(uid)).to.not.have.property("city");
      expect(await getProfile(site, uid)).to.include({ city: "Boulder", cityHidden: true });
    });

    it("another player can't read the private copy", async () => {
      const { uid } = await signUp("privatecopy");
      await setCityPrivacy(site, false);

      const err = await rejects(
        testEnv.authenticatedContext("someone-else").firestore().doc(`settings/${uid}`).get(),
      );
      expect(err.code).to.equal("permission-denied");
    });

    it("editing the profile while the city is hidden keeps it private", async () => {
      const { uid } = await signUp("edithidden");
      await setCityPrivacy(site, false);

      const saved = await saveProfile(site, { displayName: "Riley", city: "Denver" });

      expect(saved).to.include({ city: "Denver", cityHidden: true });
      expect(await profileAsOtherPlayer(uid)).to.not.have.property("city");
      expect((await getSettings(site, uid)).privateCity).to.equal("Denver");
    });

    it("showing it again puts it back on the public profile", async () => {
      const { uid } = await signUp("showcity");
      await setCityPrivacy(site, false);

      const settings = await setCityPrivacy(site, true);

      expect(settings).to.include({ showCity: true, privateCity: "" });
      expect((await profileAsOtherPlayer(uid)).city).to.equal("Boulder");
      expect(await getProfile(site, uid)).to.include({ city: "Boulder", cityHidden: false });
    });
  });

  describe("changePassword", () => {
    it("with the wrong current password, changes nothing", async () => {
      const { email } = await signUp("wrongcurrent");

      const err = await rejects(
        changePassword(site, { current: "not-the-password", next: "brand-new-pass", confirm: "brand-new-pass" }),
      );

      expect(err.code).to.be.oneOf(["auth/invalid-credential", "auth/wrong-password"]);
      await signOut(site.auth);
      await signInWithEmailAndPassword(site.auth, email, PASSWORD);
    });

    it("checks the new password before asking Firebase", async () => {
      await signUp("shortnew");
      const err = await rejects(changePassword(site, { current: PASSWORD, next: "short", confirm: "short" }));
      expect(err.code).to.equal("settings/invalid");
      expect(err.message).to.equal("New password must be at least 8 characters.");
    });

    it("with the right current password, the new one works and the old one doesn't", async () => {
      const { email } = await signUp("newpass");

      await changePassword(site, { current: PASSWORD, next: "brand-new-pass", confirm: "brand-new-pass" });

      await signOut(site.auth);
      const old = await rejects(signInWithEmailAndPassword(site.auth, email, PASSWORD));
      expect(old.code).to.be.oneOf(["auth/invalid-credential", "auth/wrong-password"]);
      const login = await signInWithEmailAndPassword(site.auth, email, "brand-new-pass");
      expect(login.user.email).to.equal(email);
    });
  });

  describe("changeEmail", () => {
    it("sends a confirmation link to the new address and keeps the old one until it's used", async () => {
      const { email } = await signUp("oldemail");
      const newEmail = uniqueEmail("newemail");

      expect(await changeEmail(site, { current: PASSWORD, newEmail })).to.equal(newEmail);

      const sent = await sentEmails(email);
      expect(sent.map((e) => e.requestType)).to.include("VERIFY_AND_CHANGE_EMAIL");
      expect(sent.find((e) => e.requestType === "VERIFY_AND_CHANGE_EMAIL").newEmail).to.equal(newEmail);
      expect(await findAuthUsers(email)).to.have.lengthOf(1);
      expect(site.auth.currentUser.email).to.equal(email);
    });

    it("refuses a bad address or the same one before asking Firebase", async () => {
      const { email } = await signUp("sameemail");
      expect((await rejects(changeEmail(site, { current: PASSWORD, newEmail: "nope" }))).message).to.equal(
        "Please enter a valid email address.",
      );
      expect((await rejects(changeEmail(site, { current: PASSWORD, newEmail: email }))).message).to.equal(
        "That's already your email.",
      );
    });

    it("with the wrong current password, sends nothing", async () => {
      const { email } = await signUp("emailwrongpw");
      const err = await rejects(changeEmail(site, { current: "not-the-password", newEmail: uniqueEmail("x") }));
      expect(err.code).to.be.oneOf(["auth/invalid-credential", "auth/wrong-password"]);
      expect((await sentEmails(email)).map((e) => e.requestType)).to.not.include("VERIFY_AND_CHANGE_EMAIL");
    });
  });
});
