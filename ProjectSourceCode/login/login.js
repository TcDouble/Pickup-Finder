import { auth } from "../firebase/firebase-config.js";
import { signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { MAP_PAGE, friendlyError, isValidEmail } from "./auth-helpers.js";

const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorText = document.getElementById("error");
const loginBtn = document.getElementById("login-btn");

onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = MAP_PAGE;
});

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
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = MAP_PAGE;
  } catch (err) {
    errorText.textContent = friendlyError(err.code);
    loginBtn.disabled = false;
  }
});
