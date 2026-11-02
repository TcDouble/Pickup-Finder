import { auth, db } from "../firebase/firebase-config.js";
import {
  createUserWithEmailAndPassword,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("register-form");
const message = document.getElementById("message");
const submitBtn = document.getElementById("submit-btn");

function showMessage(text, ok = false) {
  message.textContent = text;
  message.classList.toggle("ok", ok);
}

// Turn Firebase error codes into text a person can act on.
function friendlyError(code) {
  switch (code) {
    case "auth/email-already-in-use":
      return "That email already has an account. Try logging in instead.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
      return "Choose a password with at least 8 characters.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "permission-denied":
      return "Your account was created, but we couldn't save your profile. Check your Firestore rules.";
    default:
      return "Something went wrong. Please try again.";
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMessage("");

  const displayName = form.displayName.value.trim();
  const email = form.email.value.trim();
  const password = form.password.value;
  const confirm = form.confirm.value;
  const city = form.city.value.trim();
  const sports = [...form.querySelectorAll('input[name="sports"]:checked')].map(
    (c) => c.value
  );

  // Client-side checks
  if (!displayName) return showMessage("Enter a display name.");
  if (!email) return showMessage("Enter your email.");
  if (password.length < 8) return showMessage("Password must be at least 8 characters.");
  if (password !== confirm) return showMessage("Passwords don't match.");

  submitBtn.disabled = true;
  submitBtn.textContent = "Creating account…";

  try {
    // Create the auth user
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    // Set the display name on the auth profile
    await updateProfile(cred.user, { displayName });

    // Save the profile in Firestore, keyed by the auth UID.
    //    Never store the password — Firebase Auth handles that.
    await setDoc(doc(db, "users", cred.user.uid), {
      displayName,
      email,
      city,
      sports,
      createdAt: serverTimestamp(),
    });

    showMessage("Account created. Redirecting…", true);
    window.location.href = "index.html"; // change to your home/games page
  } catch (err) {
    console.error(err);
    showMessage(friendlyError(err.code));
    submitBtn.disabled = false;
    submitBtn.textContent = "Create account";
  }
});