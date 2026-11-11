// Lab 10 integration tests for sign-up, adapted for Firebase (approved by the
// TA). The lab's POST /register becomes registerUser(), the function the
// registration page calls. It runs against the Auth, Firestore and Storage
// emulators, with the real security rules, and the checks mirror the lab's:
//   success: the response, exactly one saved user, the saved fields, and how
//            the password is stored
//   failure: the rejection, and that no user was saved
import { readFileSync } from "node:fs";
import { expect } from "chai";
import { deleteApp } from "firebase/app";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { registerUser } from "../login-and-registration/registerUser.js";
import { MAX_PHOTO_BYTES } from "../login-and-registration/validateRegistration.js";
import {
  emulatorApp,
  startTestEnv,
  findDocs,
  deleteDocById,
  findAuthUsers,
  deleteAuthUser,
  storedFile,
  uniqueEmail,
  rejects,
} from "./emulator.js";

const PNG = readFileSync(new URL("../assets/no-profile-picture-icon.png", import.meta.url));

describe("registerUser (sign-up on the Firebase emulators)", () => {
  let site; // what the registration page has: { auth, db, storage }
  let testEnv; // admin view used only to check results and clean up
  const createdUids = [];

  before(async () => {
    site = emulatorApp("registration-tests");
    testEnv = await startTestEnv();
  });

  // Targeted cleanup: remove only what each test created.
  afterEach(async () => {
    if (!site) return;
    await signOut(site.auth);
    for (const uid of createdUids.splice(0)) {
      await deleteDocById(testEnv, "users", uid);
      await deleteAuthUser(uid);
    }
    await testEnv.clearStorage();
  });

  after(async () => {
    if (site) await deleteApp(site.app);
    await testEnv?.cleanup();
  });

  it("signs up a valid user: one account, one profile, and no password in Firestore", async () => {
    const email = uniqueEmail("signup");
    const password = "correct-horse-1";

    const result = await registerUser(site, {
      displayName: "  Riley  ",
      email,
      password,
      confirm: password,
      city: "Boulder",
      sports: ["basketball", "soccer"],
    });
    createdUids.push(result.uid);

    // The response
    expect(result.uid).to.be.a("string").that.is.not.empty;
    expect(result.profile).to.deep.equal({
      displayName: "Riley",
      photoURL: null,
      city: "Boulder",
      sports: ["basketball", "soccer"],
    });

    // Exactly one matching profile, with the right fields and no email
    const profiles = await findDocs(testEnv, "users", "displayName", "Riley");
    expect(profiles).to.have.lengthOf(1);
    const [profile] = profiles;
    expect(profile.id).to.equal(result.uid);
    expect(profile).to.include({ displayName: "Riley", city: "Boulder" });
    expect(profile.sports).to.deep.equal(["basketball", "soccer"]);
    expect(profile.createdAt.toDate()).to.be.an.instanceOf(Date);
    expect(profile).to.not.have.property("email");

    // No picture: null on the profile (pages show the default), nothing in Storage
    expect(profile.photoURL).to.equal(null);
    expect(await storedFile(testEnv, `profilePictures/${result.uid}/avatar`)).to.equal(null);

    // Exactly one matching Auth account, the same user
    const accounts = await findAuthUsers(email);
    expect(accounts).to.have.lengthOf(1);
    expect(accounts[0].localId).to.equal(result.uid);
    expect(accounts[0].displayName).to.equal("Riley");
    expect(accounts[0].photoUrl).to.equal(undefined);

    // Password storage: never in our database...
    expect(profile).to.not.have.property("password");
    expect(JSON.stringify(profile)).to.not.include(password);
    // ...only in Firebase Auth, which checks it at login
    await signOut(site.auth);
    const login = await signInWithEmailAndPassword(site.auth, email, password);
    expect(login.user.uid).to.equal(result.uid);
    await signOut(site.auth);
    const wrong = await rejects(signInWithEmailAndPassword(site.auth, email, "not-the-password"));
    expect(wrong.code).to.be.oneOf(["auth/wrong-password", "auth/invalid-credential"]);
  });

  it("rejects a sign-up with no password and saves nothing", async () => {
    const email = uniqueEmail("nopassword");

    const err = await rejects(
      registerUser(site, { displayName: "Sam", email, password: "", confirm: "", city: "Boulder" }),
    );

    // The rejection
    expect(err.code).to.equal("registration/invalid");
    expect(err.message).to.equal("Enter a password.");

    // Nothing was saved, and nobody is signed in
    expect(await findDocs(testEnv, "users", "displayName", "Sam")).to.have.lengthOf(0);
    expect(await findAuthUsers(email)).to.have.lengthOf(0);
    expect(site.auth.currentUser).to.equal(null);
  });

  describe("profile picture", () => {
    const password = "correct-horse-1";
    const signup = (email, photo) => ({
      displayName: "Riley",
      email,
      password,
      confirm: password,
      city: "Boulder",
      photo,
    });

    it("uploads the picture and saves its URL on the profile and the account", async () => {
      const email = uniqueEmail("photo");

      const result = await registerUser(site, signup(email, new Blob([PNG], { type: "image/png" })));
      createdUids.push(result.uid);

      // Stored at the user's one fixed path, as a PNG
      const file = await storedFile(testEnv, `profilePictures/${result.uid}/avatar`);
      expect(file).to.not.equal(null);
      expect(file.contentType).to.equal("image/png");
      expect(file.size).to.equal(PNG.length);

      // The saved URL serves exactly the uploaded bytes
      const { photoURL } = result.profile;
      expect(photoURL).to.be.a("string").that.is.not.empty;
      const download = Buffer.from(await (await fetch(photoURL)).arrayBuffer());
      expect(download.equals(PNG)).to.equal(true);

      // Same URL on the Firestore profile and the Auth account
      const [profile] = await findDocs(testEnv, "users", "displayName", "Riley");
      expect(profile.photoURL).to.equal(photoURL);
      const [account] = await findAuthUsers(email);
      expect(account.photoUrl).to.equal(photoURL);
    });

    it("rejects a picture that isn't an image before touching Firebase", async () => {
      const email = uniqueEmail("badphoto");

      const err = await rejects(registerUser(site, signup(email, new Blob(["hi"], { type: "text/plain" }))));

      expect(err.code).to.equal("registration/invalid");
      expect(err.message).to.equal("Profile picture must be a PNG, JPEG, WebP or GIF.");
      expect(await findAuthUsers(email)).to.have.lengthOf(0);
      expect(await findDocs(testEnv, "users", "displayName", "Riley")).to.have.lengthOf(0);
      expect(site.auth.currentUser).to.equal(null);
    });

    it("if Storage refuses the upload, saves no profile, and a retry finishes setup", async () => {
      const email = uniqueEmail("refused");
      // Claims to be small so the page's check passes, but is over the rules' 2 MB limit
      const tooBig = Object.assign(new Uint8Array(MAX_PHOTO_BYTES + 1), { type: "image/png", size: 100 });

      const err = await rejects(registerUser(site, signup(email, tooBig)));
      expect(err.code).to.equal("storage/unauthorized");

      // The account exists and is signed in, but there's no profile or picture yet
      const uid = site.auth.currentUser?.uid;
      expect(uid).to.be.a("string");
      createdUids.push(uid);
      expect(await findDocs(testEnv, "users", "displayName", "Riley")).to.have.lengthOf(0);
      expect(await storedFile(testEnv, `profilePictures/${uid}/avatar`)).to.equal(null);

      // Retrying while signed in finishes setup, without "email already in use"
      const retry = await registerUser(site, { displayName: "Riley", city: "Boulder", photo: null });
      expect(retry.uid).to.equal(uid);
      expect(retry.profile.photoURL).to.equal(null);
      expect(await findDocs(testEnv, "users", "displayName", "Riley")).to.have.lengthOf(1);
      expect(await findAuthUsers(email)).to.have.lengthOf(1);
    });
  });
});
