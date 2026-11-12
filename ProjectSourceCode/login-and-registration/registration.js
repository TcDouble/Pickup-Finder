import { auth, db, storage } from "../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { DEFAULT_PHOTO, MAP_PAGE, friendlyError, hasProfile } from "./auth-helpers.js";
import { photoError, validateRegistration } from "./validateRegistration.js";
import { registerUser } from "./registerUser.js";

const form = document.getElementById("register-form");
const message = document.getElementById("message");
const submitBtn = document.getElementById("submit-btn");
const photoInput = document.getElementById("photo");
const photoPreview = document.getElementById("photo-preview");
const photoRemove = document.getElementById("photo-remove");
const signedInNote = document.getElementById("signed-in-note");
let submitting = false;
let previewURL = null;
// Set when someone with a finished profile opens this page. Their account is
// left alone; making a new one signs them out first.
let signedInWithProfile = false;

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
  form.password.closest(".field").hidden = true;
  form.confirm.closest(".field").hidden = true;
  submitBtn.textContent = "Finish setup";
}

function showSignedInNote(user) {
  signedInNote.textContent = `You're signed in as ${user.email}. Creating a new account will sign you out. `;
  const link = document.createElement("a");
  link.href = MAP_PAGE;
  link.textContent = "Go to home";
  signedInNote.append(link);
  signedInNote.hidden = false;
}

// Being signed in doesn't send you away from this page. If the profile was
// never finished, the form switches to finishing it.
onAuthStateChanged(auth, async (user) => {
  if (submitting) return;
  signedInWithProfile = false;
  signedInNote.hidden = true;
  if (!user) return;
  try {
    if (await hasProfile(user.uid)) {
      signedInWithProfile = true;
      showSignedInNote(user);
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
  const creatingNewAccount = !auth.currentUser || signedInWithProfile;
  const check = validateRegistration(input, { needsCredentials: creatingNewAccount });
  if (!check.valid) return showMessage(check.errors[0]);

  submitting = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";

  try {
    // Don't overwrite the signed-in user's profile with this new one.
    if (signedInWithProfile) {
      await signOut(auth);
      signedInWithProfile = false;
      signedInNote.hidden = true;
    }

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