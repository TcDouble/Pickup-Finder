import { db } from "../firebase/firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { MIN_PASSWORD_LENGTH, isValidEmail } from "./validateRegistration.js";

// TODO: point to the map page once it exists
export const MAP_PAGE = "home.html";

// Shown wherever a profile's photoURL is null.
export const DEFAULT_PHOTO = "../assets/no-profile-picture-icon.svg";

// The sign-up rules live in validateRegistration.js so they can be unit tested.
export { MIN_PASSWORD_LENGTH, isValidEmail };

export async function hasProfile(uid) {
  return (await getDoc(doc(db, "users", uid))).exists();
}

export function friendlyError(code) {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/email-already-in-use":
      return "That email already has an account. Try logging in instead.";
    case "auth/weak-password":
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "storage/unauthorized":
      return "We couldn't upload that picture. Try a smaller PNG or JPEG, or skip it.";
    case "storage/retry-limit-exceeded":
    case "storage/canceled":
      return "The picture upload didn't finish. Check your connection and try again.";
    case "permission-denied":
      return "Your account was created, but we couldn't save your profile. Check your Firestore rules.";
    default:
      return "Something went wrong. Please try again.";
  }
}
