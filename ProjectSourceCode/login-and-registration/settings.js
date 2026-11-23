// The Profile panel's Settings screen: preferences saved in settings/{uid},
// city privacy, and changing the account's password or email.
//
// Like profile.js, the caller passes in `auth` and `db` (from
// ../firebase/firebase-config.js on the site, emulator instances in tests).
import {
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
  verifyBeforeUpdateEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { DEFAULT_SETTINGS, validateSettings } from "./validateSettings.js";
import { MIN_PASSWORD_LENGTH, isValidEmail } from "./validateRegistration.js";

export class SettingsError extends Error {
  constructor(errors, code = "settings/invalid") {
    super(errors[0]);
    this.name = "SettingsError";
    this.code = code;
    this.errors = errors;
  }
}

function requireUser(auth) {
  const user = auth.currentUser;
  if (!user) throw new SettingsError(["Please log in first."], "settings/not-signed-in");
  return user;
}

/** A player's own settings, with defaults for anything never saved. */
export async function getSettings({ db }, uid) {
  const snap = await getDoc(doc(db, "settings", uid));
  const { updatedAt, ...saved } = snap.exists() ? snap.data() : {};
  return { ...DEFAULT_SETTINGS, ...saved };
}

/**
 * Save some settings for the signed-in user and return them all.
 * Throws SettingsError (code "settings/invalid") before touching Firebase if
 * a value is invalid.
 */
export async function saveSettings({ auth, db }, changes) {
  const user = requireUser(auth);
  const { valid, errors, value } = validateSettings(changes);
  if (!valid) throw new SettingsError(errors);
  await setDoc(doc(db, "settings", user.uid), { ...value, updatedAt: serverTimestamp() }, { merge: true });
  return getSettings({ db }, user.uid);
}

/**
 * Show or hide the signed-in user's city. Hiding moves it out of the public
 * profile into settings/{uid}, which only they can read; showing moves it back.
 */
export async function setCityPrivacy({ auth, db }, show) {
  const user = requireUser(auth);
  const userRef = doc(db, "users", user.uid);
  const settingsRef = doc(db, "settings", user.uid);
  const [profile, settings] = await Promise.all([getDoc(userRef), getSettings({ db }, user.uid)]);
  const batch = writeBatch(db);

  if (show) {
    batch.update(userRef, { city: settings.privateCity, email: deleteField() });
    batch.set(settingsRef, { showCity: true, privateCity: deleteField(), updatedAt: serverTimestamp() }, { merge: true });
  } else {
    const city = profile.data()?.city ?? settings.privateCity ?? "";
    batch.update(userRef, { city: deleteField(), email: deleteField() });
    batch.set(settingsRef, { showCity: false, privateCity: city, updatedAt: serverTimestamp() }, { merge: true });
  }
  await batch.commit();
  return getSettings({ db }, user.uid);
}

/**
 * Change the signed-in user's password. The current one is checked first;
 * a wrong one throws "auth/invalid-credential" and nothing changes.
 */
export async function changePassword({ auth }, { current, next, confirm }) {
  const user = requireUser(auth);
  if (!current) throw new SettingsError(["Enter your current password."]);
  if (!next || next.length < MIN_PASSWORD_LENGTH) {
    throw new SettingsError([`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`]);
  }
  if (next !== confirm) throw new SettingsError(["New passwords don't match."]);
  if (next === current) throw new SettingsError(["Pick a password you aren't using now."]);
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
  await updatePassword(user, next);
}

/**
 * Start changing the signed-in user's email. Firebase sends a link to the
 * new address, and the account switches to it only once the link is opened.
 * Returns the new address.
 */
export async function changeEmail({ auth }, { current, newEmail }) {
  const user = requireUser(auth);
  const email = String(newEmail ?? "").trim();
  if (!isValidEmail(email)) throw new SettingsError(["Please enter a valid email address."]);
  if (email.toLowerCase() === user.email?.toLowerCase()) {
    throw new SettingsError(["That's already your email."]);
  }
  if (!current) throw new SettingsError(["Enter your current password."]);
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
  await verifyBeforeUpdateEmail(user, email);
  return email;
}
