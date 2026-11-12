import { auth } from "../firebase/firebase-config.js";
import { signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { MAP_PAGE, friendlyError, hasProfile, isValidEmail } from "./auth-helpers.js";

const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorText = document.getElementById("error");
const loginBtn = document.getElementById("login-btn");
const signedInNote = document.getElementById("signed-in-note");

// Being signed in already doesn't send you away from this page; it just says so.
onAuthStateChanged(auth, (user) => {
  signedInNote.hidden = !user;
  if (user) {
    signedInNote.textContent = `You're signed in as ${user.email}. `;
    const link = document.createElement("a");
    link.href = MAP_PAGE;
    link.textContent = "Go to home";
    signedInNote.append(link);
  }
});

// After logging in, go home, or back to registration if the profile was never finished.
async function goToNextPage(user) {
  let profileMissing = false;
  try {
    profileMissing = !(await hasProfile(user.uid));
  } catch (err) {
    console.error(err);
  }
  window.location.href = profileMissing ? "registration.html" : MAP_PAGE;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorText.textContent = "";

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    errorText.textContent = "Please enter your email and password.";
    return;
  }
  if (!isValidEmail(email)) {
    errorText.textContent = "Please enter a valid email address.";
    return;
  }

  loginBtn.disabled = true;
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    await goToNextPage(user);
  } catch (err) {
    errorText.textContent = friendlyError(err.code);
    loginBtn.disabled = false;
  }
});
