// Creates an account and saves the profile. The registration page calls this;
// the Lab 10 tests call it against the Firebase emulators.
//
// The caller passes in `auth`, `db` and `storage` (from ../firebase/firebase-config.js
// on the site, emulator instances in tests), so this file never picks a project.
import {
  createUserWithEmailAndPassword,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { validateRegistration } from "./validateRegistration.js";

export class RegistrationError extends Error {
  constructor(errors) {
    super(errors[0]);
    this.name = "RegistrationError";
    this.code = "registration/invalid";
    this.errors = errors;
  }
}

/**
 * Sign up, or finish the profile of someone already signed in.
 *
 * input: { photo, displayName, email, password, confirm, city, sports }
 * Returns { uid, profile } where profile is what was saved in users/{uid}.
 * profile.photoURL is the uploaded picture's URL, or null if there's no
 * picture (pages then show the default icon).
 * Throws RegistrationError (code "registration/invalid") before touching
 * Firebase if the input is invalid, or a Firebase error (code "auth/...",
 * "storage/...", "permission-denied", ...) if Firebase refuses.
 *
 * The password goes only to Firebase Auth, which stores it hashed. It is
 * never written to Firestore.
 */
export async function registerUser({ auth, db, storage }, input) {
  const signedIn = auth.currentUser;
  const { valid, errors, value } = validateRegistration(input, { needsCredentials: !signedIn });
  if (!valid) throw new RegistrationError(errors);

  // Create the auth user, unless an earlier attempt already did
  const user =
    signedIn ?? (await createUserWithEmailAndPassword(auth, value.email, input.password)).user;

  // Upload the picture to one fixed path per user, so a retry overwrites it
  let photoURL = null;
  if (input.photo) {
    const photoRef = ref(storage, `profilePictures/${user.uid}/avatar`);
    await uploadBytes(photoRef, input.photo, { contentType: input.photo.type });
    photoURL = await getDownloadURL(photoRef);
  }

  // Set the display name and picture on the auth profile
  await updateProfile(user, photoURL ? { displayName: value.displayName, photoURL } : { displayName: value.displayName });

  // Save the profile in Firestore, keyed by the auth UID. Other players can read
  // profiles, so the email stays in Firebase Auth only.
  const profile = {
    displayName: value.displayName,
    photoURL,
    city: value.city,
    sports: value.sports,
  };
  await setDoc(doc(db, "users", user.uid), { ...profile, createdAt: serverTimestamp() });

  return { uid: user.uid, profile };
}
