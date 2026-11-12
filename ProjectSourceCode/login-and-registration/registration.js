import { auth, db, storage } from "../firebase/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { DEFAULT_PHOTO, MAP_PAGE, friendlyError, hasProfile } from "./auth-helpers.js";
import { photoError, validateRegistration } from "./validateRegistration.js";
import { registerUser } from "./registerUser.js";

const form = document.getElementById("register-form");
const message = document.getElementById("message");
const submitBtn = document.getElementById("submit-btn");
const photoInput = document.getElementById("photo");
const photoPreview = document.getElementById("photo-preview");
const photoRemove = document.getElementById("photo-remove");
let submitting = false;
let previewURL = null;

function showMessage(text, ok = false) {
  message.textContent = text;
  message.classList.toggle("ok", ok);
}

function showPhoto(file) {
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = file ? URL.createObjectURL(file) : null;
  photoPreview.src = previewURL ?? DEFAULT_PHOTO;
  photoRemove.hidden = !file;
}

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0] ?? null;
  const problem = photoError(file);
  showMessage(problem ?? "");
  if (problem) photoInput.value = "";
  showPhoto(problem ? null : file);
});

photoRemove.addEventListener("click", () => {
  photoInput.value = "";
  showPhoto(null);
});

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

  const input = {
    photo: photoInput.files[0] ?? null,
    displayName: form.displayName.value,
    email: form.email.value,
    password: form.password.value,
    confirm: form.confirm.value,
    city: form.city.value,
    sports: [...form.querySelectorAll('input[name="sports"]:checked')].map((c) => c.value),
  };

  // Client-side checks (same rules registerUser applies)
  const check = validateRegistration(input, { needsCredentials: !auth.currentUser });
  if (!check.valid) return showMessage(check.errors[0]);

  submitting = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";

  try {
    // Creates the auth user (unless an earlier attempt already did), uploads the
    // picture, sets the display name, and saves users/{uid}. The password never
    // goes to Firestore.
    await registerUser({ auth, db, storage }, input);

    showMessage("Account created. Redirecting…", true);
    window.location.href = MAP_PAGE;
  } catch (err) {
    console.error(err);
    showMessage(err.code === "registration/invalid" ? err.message : friendlyError(err.code));
    submitting = false;
    submitBtn.disabled = false;
    if (auth.currentUser) enterFinishMode(auth.currentUser);
    else submitBtn.textContent = "Create account";
  }
});