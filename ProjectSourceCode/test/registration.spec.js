// Lab 10 integration tests for sign-up, adapted for Firebase (approved by the
// TA). The lab's POST /register becomes registerUser(), the function the
// registration page calls. It runs against the Auth and Firestore emulators,
// with the real security rules, and the checks mirror the lab's:
//   success: the response, exactly one saved user, the saved fields, and how
//            the password is stored
//   failure: the rejection, and that no user was saved
import { expect } from "chai";
import { deleteApp } from "firebase/app";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { registerUser } from "../login-and-registration/registerUser.js";
import {
  emulatorApp,
  startTestEnv,
  findDocs,
  deleteDocById,
  findAuthUsers,
  deleteAuthUser,
  uniqueEmail,
  rejects,
} from "./emulator.js";

describe("registerUser (sign-up on the Firebase emulators)", () => {
  let site; // what the registration page has: { auth, db }
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
      email,
      city: "Boulder",
      sports: ["basketball", "soccer"],
    });

    // Exactly one matching profile, with the right fields
    const profiles = await findDocs(testEnv, "users", "email", email);
    expect(profiles).to.have.lengthOf(1);
    const [profile] = profiles;
    expect(profile.id).to.equal(result.uid);
    expect(profile).to.include({ displayName: "Riley", email, city: "Boulder" });
    expect(profile.sports).to.deep.equal(["basketball", "soccer"]);
    expect(profile.createdAt.toDate()).to.be.an.instanceOf(Date);

    // Exactly one matching Auth account, the same user
    const accounts = await findAuthUsers(email);
    expect(accounts).to.have.lengthOf(1);
    expect(accounts[0].localId).to.equal(result.uid);
    expect(accounts[0].displayName).to.equal("Riley");

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
    expect(await findDocs(testEnv, "users", "email", email)).to.have.lengthOf(0);
    expect(await findAuthUsers(email)).to.have.lengthOf(0);
    expect(site.auth.currentUser).to.equal(null);
  });
});
