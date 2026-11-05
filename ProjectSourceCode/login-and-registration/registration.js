import { auth, db } from "../firebase/firebase-config.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { MAP_PAGE, MIN_PASSWORD_LENGTH, friendlyError, hasProfile, isValidEmail } from "./auth-helpers.js";

const form = document.getElementById("register-form");
const message = document.getElementById("message");
const submitBtn = document.getElementById("submit-btn");
let submitting = false;

function showMessage(text, ok = false) {
  message.textContent = text;
  message.classList.toggle("ok", ok);
}

function enterFinishMode(user) {
  form.email.value = user.email;
  form.email.disabled = true;
  form.password.closest(".field").style.display = "none";
  form.confirm.closest(".field").style.display = "none";
  submitBtn.textContent = "Finish setup";
}

// A signed-in user on this page either already has a profile or still needs one.
onAuthStateChanged(auth, async (user) => {
  if (!user || submitting) return;
  try {
    if (await hasProfile(user.uid)) {
      window.location.href = MAP_PAGE;
      return;
    }
    enterFinishMode(user);
    showMessage("Your account exists, but your profile isn't finished. Fill this in to finish.");
  } catch (err) {
    console.error(err);
    submitBtn.disabled = true;
    showMessage(friendlyError(err.code));
  }
});

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
  if (!auth.currentUser) {
    if (!email) return showMessage("Enter your email.");
    if (!isValidEmail(email)) return showMessage("Please enter a valid email address.");
    if (password.length < MIN_PASSWORD_LENGTH) return showMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password !== confirm) return showMessage("Passwords don't match.");
  }

  submitting = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";

  try {
    // Create the auth user, unless an earlier attempt already did
    const user = auth.currentUser ?? (await createUserWithEmailAndPassword(auth, email, password)).user;

    // Set the display name on the auth profile
    await updateProfile(user, { displayName });

    // Save the profile in Firestore, keyed by the auth UID.
    //    Never store the password — Firebase Auth handles that.
    await setDoc(doc(db, "users", user.uid), {
      displayName,
      email,
      city,
      sports,
      createdAt: serverTimestamp(),
    });

    showMessage("Account created. Redirecting…", true);
    window.location.href = MAP_PAGE;
  } catch (err) {
    console.error(err);
    showMessage(friendlyError(err.code));
    submitting = false;
    submitBtn.disabled = false;
    if (auth.currentUser) enterFinishMode(auth.currentUser);
    else submitBtn.textContent = "Create account";
  }
});