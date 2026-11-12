import { auth } from "../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { hasProfile } from "./auth-helpers.js";

// You have to be logged in to use the app. The page stays hidden (see .auth-pending
// in home.html) until we know who's here:
//   - not logged in        -> login page
//   - profile not finished -> registration page, which switches to "Finish setup"
//   - otherwise            -> show the app
// replace() keeps this page out of history, so Back doesn't bounce you here again.
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  try {
    if (!(await hasProfile(user.uid))) {
      window.location.replace("registration.html");
      return;
    }
  } catch (err) {
    // Couldn't check the profile (e.g. offline). They are logged in, so let them in.
    console.error(err);
  }
  document.documentElement.classList.remove("auth-pending");
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.replace("login.html");
});

// Sidebar buttons open their panel over the map; clicking the open one again closes it.
// "+ Host a game" opens the create-game form, which ../create-game/create-game.js runs.
// The other panels are wireframe placeholders.
const navButtons = document.querySelectorAll(".sidebar [data-panel]");
const panels = document.querySelectorAll(".panel");

function showPanel(name) {
  panels.forEach((panel) => { panel.hidden = panel.id !== `panel-${name}`; });
  navButtons.forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.panel === name)));
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    showPanel(btn.getAttribute("aria-pressed") === "true" ? null : btn.dataset.panel);
  });
});

document.querySelectorAll(".close-btn").forEach((btn) => {
  btn.addEventListener("click", () => showPanel(null));
});

// Activity chips toggle on and off (they don't filter anything yet).
document.querySelectorAll(".filters .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
  });
});

// My games tabs: only one is selected at a time.
const tabs = document.querySelectorAll(".tabs button");
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.setAttribute("aria-pressed", String(t === tab)));
  });
});
