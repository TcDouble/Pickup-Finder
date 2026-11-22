// Read and change the signed-in user's profile and account: the home page's
// Profile panel calls these; the Lab 10 tests call them on the emulators.
//
// Like registerUser.js, the caller passes in `auth`, `db` and `storage`
// (from ../firebase/firebase-config.js on the site, emulator instances in
// tests), so this file never picks a project.
import {
  updateProfile,
  sendPasswordResetEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  arrayRemove,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { validateProfile } from "./validateProfile.js";

export class ProfileError extends Error {
  constructor(errors, code = "profile/invalid") {
    super(errors[0]);
    this.name = "ProfileError";
    this.code = code;
    this.errors = errors;
  }
}

const photoPath = (uid) => `profilePictures/${uid}/avatar`;

function requireUser(auth) {
  const user = auth.currentUser;
  if (!user) throw new ProfileError(["Please log in first."], "profile/not-signed-in");
  return user;
}

async function deleteIfExists(fileRef) {
  try {
    await deleteObject(fileRef);
  } catch (err) {
    if (err.code !== "storage/object-not-found") throw err;
  }
}

/**
 * A player's profile, or null if they have none:
 * { uid, displayName, photoURL, city, sports, sportLevels, bio, createdAt (Date or null) }.
 */
export async function getProfile({ db }, uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    uid,
    displayName: data.displayName ?? "",
    photoURL: data.photoURL ?? null,
    city: data.city ?? "",
    sports: data.sports ?? [],
    sportLevels: data.sportLevels ?? {},
    bio: data.bio ?? "",
    createdAt: data.createdAt?.toDate() ?? null,
  };
}

/** How many games a player hosts that aren't cancelled, upcoming ones included. One read. */
export async function countGamesHosted({ db }, uid) {
  const snap = await getCountFromServer(
    query(collection(db, "events"), where("hostId", "==", uid), where("status", "==", "scheduled")),
  );
  return snap.data().count;
}

/**
 * Save the Edit profile form for the signed-in user and return the saved profile.
 *
 * input: { photo, removePhoto, displayName, city, sports, sportLevels, bio }
 *   photo: a new picture to upload, or null to keep the current one.
 *   removePhoto: true to delete the current picture (pages then show the default).
 * Throws ProfileError (code "profile/invalid") before touching Firebase if the
 * input is invalid, or a Firebase error ("storage/...", "permission-denied", ...).
 */
export async function saveProfile({ auth, db, storage }, input) {
  const user = requireUser(auth);
  const { valid, errors, value } = validateProfile(input);
  if (!valid) throw new ProfileError(errors);

  // Profiles made before emails moved to Auth still have one; the rules reject it.
  const changes = { ...value, email: deleteField() };
  const photoRef = ref(storage, photoPath(user.uid));
  if (input.photo) {
    await uploadBytes(photoRef, input.photo, { contentType: input.photo.type });
    changes.photoURL = await getDownloadURL(photoRef);
  } else if (input.removePhoto) {
    await deleteIfExists(photoRef);
    changes.photoURL = null;
  }
  await updateDoc(doc(db, "users", user.uid), changes);

  // Auth rejects a null photoURL, so a removed picture only clears it in Firestore,
  // which is what the pages read.
  await updateProfile(
    user,
    changes.photoURL ? { displayName: value.displayName, photoURL: changes.photoURL } : { displayName: value.displayName },
  );
  return getProfile({ db }, user.uid);
}

/** Email the signed-in user a password reset link. Returns the address it went to. */
export async function sendPasswordReset({ auth }) {
  const user = requireUser(auth);
  await sendPasswordResetEmail(auth, user.email);
  return user.email;
}

/**
 * Delete the signed-in user's account after checking their password.
 *
 * Cancels upcoming games they host, leaves upcoming games they joined, and
 * deletes their notification settings, friends and friend requests, picture,
 * profile, online status and login, in that order, so a failure part way
 * leaves a login they can retry with. Past games,
 * feedback and sportsmanship totals stay, because other players' history
 * depends on them (and the rules don't allow deleting feedback).
 * A wrong password throws "auth/invalid-credential" before anything is deleted.
 */
export async function deleteAccount({ auth, db, storage }, password) {
  const user = requireUser(auth);
  if (!password) throw new ProfileError(["Enter your password to confirm."]);
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));

  const uid = user.uid;
  const now = Timestamp.now();
  const events = collection(db, "events");
  const [hosting, joined] = await Promise.all([
    getDocs(query(events, where("hostId", "==", uid), where("startTime", ">=", now))),
    getDocs(query(events, where("participantIds", "array-contains", uid), where("startTime", ">=", now))),
  ]);
  for (const game of hosting.docs) {
    if (game.data().status === "scheduled") await updateDoc(game.ref, { status: "cancelled" });
  }
  for (const game of joined.docs) {
    const data = game.data();
    if (data.hostId !== uid && data.status === "scheduled") {
      await updateDoc(game.ref, { participantIds: arrayRemove(uid) });
    }
  }

  await deleteDoc(doc(db, "notificationSettings", uid));
  const friendships = await getDocs(
    query(collection(db, "friendships"), where("userIds", "array-contains", uid)),
  );
  for (const friendship of friendships.docs) await deleteDoc(friendship.ref);
  await deleteIfExists(ref(storage, photoPath(uid)));
  await deleteDoc(doc(db, "users", uid));
  // After the profile, because the rules only let players with a profile
  // check in: an open page can't bring the account back online.
  await deleteDoc(doc(db, "presence", uid));
  await deleteUser(user);
}
