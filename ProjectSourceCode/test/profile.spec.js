// Integration tests for the Profile panel's functions in profile.js, run on
// the Auth, Firestore and Storage emulators with the real security rules.
import { readFileSync } from "node:fs";
import { expect } from "chai";
import { deleteApp } from "firebase/app";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { registerUser } from "../login-and-registration/registerUser.js";
import {
  countGamesHosted,
  deleteAccount,
  getProfile,
  saveProfile,
  sendPasswordReset,
} from "../login-and-registration/profile.js";
import {
  emulatorApp,
  startTestEnv,
  deleteDocById,
  findAuthUsers,
  deleteAuthUser,
  sentEmails,
  storedFile,
  uniqueEmail,
  rejects,
} from "./emulator.js";

const PNG = readFileSync(new URL("../assets/no-profile-picture-icon.png", import.meta.url));
const PASSWORD = "correct-horse-1";
const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);

describe("profile.js (Profile panel on the Firebase emulators)", () => {
  let site;
  let testEnv;
  const createdUids = [];
  const createdGames = [];

  before(async () => {
    site = emulatorApp("profile-tests");
    testEnv = await startTestEnv();
  });

  afterEach(async () => {
    if (!site) return;
    await signOut(site.auth);
    for (const uid of createdUids.splice(0)) {
      await deleteDocById(testEnv, "users", uid);
      await deleteDocById(testEnv, "notificationSettings", uid);
      await deleteDocById(testEnv, "settings", uid);
      await deleteAuthUser(uid).catch(() => {});
    }
    for (const id of createdGames.splice(0)) await deleteDocById(testEnv, "events", id);
    await testEnv.clearStorage();
  });

  after(async () => {
    if (site) await deleteApp(site.app);
    await testEnv?.cleanup();
  });

  async function signUp(label, extra = {}) {
    const email = uniqueEmail(label);
    const { uid } = await registerUser(site, {
      displayName: "Riley",
      email,
      password: PASSWORD,
      confirm: PASSWORD,
      city: "Boulder",
      sports: ["basketball"],
      ...extra,
    });
    createdUids.push(uid);
    return { uid, email };
  }

  async function readDoc(path) {
    let data = null;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await ctx.firestore().doc(path).get();
      data = snap.exists ? snap.data() : null;
    });
    return data;
  }

  async function writeDoc(path, data) {
    await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(path).set(data));
  }

  // A game that passes the events rules, so the host can cancel it and players can leave it.
  async function seedGame(overrides) {
    const id = `game-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createdGames.push(id);
    await writeDoc(`events/${id}`, {
      sportId: "basketball",
      title: "",
      description: "",
      skillLevel: "casual",
      startTime: hoursFromNow(24),
      endTime: hoursFromNow(26),
      location: { name: "Court", address: "", lat: 40.01, lng: -105.27 },
      playerLimit: 10,
      hostId: "someone-else",
      hostName: "Sam",
      participantIds: ["someone-else"],
      status: "scheduled",
      createdAt: new Date(),
      ...overrides,
    });
    return id;
  }

  describe("saveProfile and getProfile", () => {
    it("saves name, city, sports, levels and bio, and keeps createdAt", async () => {
      const { uid } = await signUp("save");
      const before = await readDoc(`users/${uid}`);

      const saved = await saveProfile(site, {
        displayName: " Riley R ",
        city: "Denver",
        sports: ["soccer", "tennis"],
        sportLevels: { soccer: "competitive", tennis: "casual" },
        bio: "Weekend mornings.",
      });

      expect(saved).to.include({ uid, displayName: "Riley R", city: "Denver", bio: "Weekend mornings.", photoURL: null });
      expect(saved.sports).to.deep.equal(["soccer", "tennis"]);
      expect(saved.sportLevels).to.deep.equal({ soccer: "competitive", tennis: "casual" });
      expect(saved.createdAt).to.be.an.instanceOf(Date);

      const after = await readDoc(`users/${uid}`);
      expect(after.createdAt.isEqual(before.createdAt)).to.equal(true);
      expect(await getProfile(site, uid)).to.deep.equal(saved);
    });

    it("removes a leftover email from older profiles", async () => {
      const { uid } = await signUp("legacy");
      await testEnv.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(`users/${uid}`).update({ email: "old@example.com" }));

      await saveProfile(site, { displayName: "Riley" });

      expect(await readDoc(`users/${uid}`)).to.not.have.property("email");
    });

    it("uploads a new picture and saves its URL", async () => {
      const { uid } = await signUp("newphoto");

      const saved = await saveProfile(site, { displayName: "Riley", photo: new Blob([PNG], { type: "image/png" }) });

      const file = await storedFile(testEnv, `profilePictures/${uid}/avatar`);
      expect(file.contentType).to.equal("image/png");
      expect(saved.photoURL).to.be.a("string").that.is.not.empty;
      expect(site.auth.currentUser.photoURL).to.equal(saved.photoURL);
    });

    it("Remove picture deletes the file and sets photoURL to null", async () => {
      const { uid } = await signUp("removephoto", { photo: new Blob([PNG], { type: "image/png" }) });
      expect(await storedFile(testEnv, `profilePictures/${uid}/avatar`)).to.not.equal(null);

      const saved = await saveProfile(site, { displayName: "Riley", removePhoto: true });

      expect(saved.photoURL).to.equal(null);
      expect(await storedFile(testEnv, `profilePictures/${uid}/avatar`)).to.equal(null);
    });

    it("keeps the current picture when none is picked", async () => {
      const { uid } = await signUp("keepphoto", { photo: new Blob([PNG], { type: "image/png" }) });
      const { photoURL } = await getProfile(site, uid);

      const saved = await saveProfile(site, { displayName: "Riley", bio: "New bio" });

      expect(saved.photoURL).to.equal(photoURL);
    });

    it("rejects invalid input before writing anything", async () => {
      const { uid } = await signUp("invalid");
      const before = await readDoc(`users/${uid}`);

      const err = await rejects(saveProfile(site, { displayName: "Riley", bio: "x".repeat(301) }));

      expect(err.code).to.equal("profile/invalid");
      expect(err.message).to.equal("About must be 300 characters or fewer.");
      expect(await readDoc(`users/${uid}`)).to.deep.equal(before);
    });

    it("getProfile returns null for someone without a profile", async () => {
      await signUp("noprofile");
      expect(await getProfile(site, "nobody-here")).to.equal(null);
    });
  });

  describe("countGamesHosted", () => {
    it("counts only games the player hosts that aren't cancelled", async () => {
      const { uid } = await signUp("hosted");
      await seedGame({ hostId: uid, participantIds: [uid] });
      await seedGame({ hostId: uid, participantIds: [uid], startTime: hoursFromNow(-30), endTime: hoursFromNow(-28) });
      await seedGame({ hostId: uid, participantIds: [uid], status: "cancelled" });
      await seedGame({ participantIds: ["someone-else", uid] });

      expect(await countGamesHosted(site, uid)).to.equal(2);
    });
  });

  describe("sendPasswordReset", () => {
    it("emails a reset link to the signed-in user and keeps them signed in", async () => {
      const { uid, email } = await signUp("reset");

      expect(await sendPasswordReset(site)).to.equal(email);

      const emails = await sentEmails(email);
      expect(emails.map((e) => e.requestType)).to.include("PASSWORD_RESET");
      expect(site.auth.currentUser?.uid).to.equal(uid);
    });
  });

  describe("deleteAccount", () => {
    it("with the wrong password, deletes nothing", async () => {
      const { uid, email } = await signUp("wrongpw", { photo: new Blob([PNG], { type: "image/png" }) });
      await writeDoc(`notificationSettings/${uid}`, { phone: "" });
      const hosted = await seedGame({ hostId: uid, participantIds: [uid] });

      const err = await rejects(deleteAccount(site, "not-the-password"));

      expect(err.code).to.be.oneOf(["auth/invalid-credential", "auth/wrong-password"]);
      expect(await readDoc(`users/${uid}`)).to.not.equal(null);
      expect(await readDoc(`notificationSettings/${uid}`)).to.not.equal(null);
      expect(await storedFile(testEnv, `profilePictures/${uid}/avatar`)).to.not.equal(null);
      expect(await findAuthUsers(email)).to.have.lengthOf(1);
      expect((await readDoc(`events/${hosted}`)).status).to.equal("scheduled");
    });

    it("asks for the password before doing anything", async () => {
      await signUp("nopw");
      const err = await rejects(deleteAccount(site, ""));
      expect(err.code).to.equal("profile/invalid");
      expect(err.message).to.equal("Enter your password to confirm.");
    });

    it("with the right password, deletes the account and cleans up the player's games", async () => {
      const { uid, email } = await signUp("delete", { photo: new Blob([PNG], { type: "image/png" }) });
      await writeDoc(`notificationSettings/${uid}`, { phone: "" });
      await writeDoc(`settings/${uid}`, { units: "km" });
      const hosted = await seedGame({ hostId: uid, hostName: "Riley", participantIds: [uid, "friend"] });
      const joined = await seedGame({ participantIds: ["someone-else", uid] });
      const past = await seedGame({ participantIds: ["someone-else", uid], startTime: hoursFromNow(-30), endTime: hoursFromNow(-28) });

      await deleteAccount(site, PASSWORD);

      // Profile, settings, picture and login are gone, and nobody is signed in
      expect(await readDoc(`users/${uid}`)).to.equal(null);
      expect(await readDoc(`notificationSettings/${uid}`)).to.equal(null);
      expect(await readDoc(`settings/${uid}`)).to.equal(null);
      expect(await storedFile(testEnv, `profilePictures/${uid}/avatar`)).to.equal(null);
      expect(await findAuthUsers(email)).to.have.lengthOf(0);
      expect(site.auth.currentUser).to.equal(null);

      // Their upcoming game is cancelled, they left the one they joined, the past one is untouched
      expect((await readDoc(`events/${hosted}`)).status).to.equal("cancelled");
      expect((await readDoc(`events/${joined}`)).participantIds).to.deep.equal(["someone-else"]);
      expect((await readDoc(`events/${past}`)).participantIds).to.deep.equal(["someone-else", uid]);

      // The email is free to register again
      const again = await registerUser(site, { displayName: "Riley", email, password: PASSWORD, confirm: PASSWORD });
      createdUids.push(again.uid);
      expect(again.uid).to.not.equal(uid);
    });

    it("removes the player's friends, friend requests and online status", async () => {
      const { uid } = await signUp("friends");
      const pair = (a, b) => (a < b ? [a, b] : [b, a]);
      const friendship = (other, extra) => {
        const userIds = pair(uid, other);
        return writeDoc(`friendships/${userIds.join("_")}`, {
          userIds,
          requesterId: other,
          addresseeId: uid,
          createdAt: new Date(),
          ...extra,
        });
      };
      await friendship("friend-a", { status: "accepted", acceptedAt: new Date() });
      await friendship("friend-b", { status: "pending" });
      const others = pair("friend-a", "friend-b");
      await writeDoc(`friendships/${others.join("_")}`, {
        userIds: others,
        requesterId: others[0],
        addresseeId: others[1],
        status: "accepted",
        createdAt: new Date(),
        acceptedAt: new Date(),
      });
      await writeDoc(`presence/${uid}`, { state: "online", lastSeen: new Date() });

      await deleteAccount(site, PASSWORD);

      expect(await readDoc(`friendships/${pair(uid, "friend-a").join("_")}`)).to.equal(null);
      expect(await readDoc(`friendships/${pair(uid, "friend-b").join("_")}`)).to.equal(null);
      expect(await readDoc(`presence/${uid}`)).to.equal(null);
      // Other players' friendships stay
      expect(await readDoc(`friendships/${others.join("_")}`)).to.not.equal(null);
      await deleteDocById(testEnv, "friendships", others.join("_"));
    });

    it("signs out the deleted user so they can't log back in", async () => {
      const { email } = await signUp("nologin");
      await deleteAccount(site, PASSWORD);

      const err = await rejects(signInWithEmailAndPassword(site.auth, email, PASSWORD));
      expect(err.code).to.be.oneOf(["auth/user-not-found", "auth/invalid-credential"]);
    });
  });
});
