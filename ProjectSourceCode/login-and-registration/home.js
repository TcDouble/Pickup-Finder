import { auth } from "../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// TODO: a logged-in user with no profile who comes straight here isn't sent to the finish form
// (only the login and registration pages do that). The real map page should do the same check.
onAuthStateChanged(auth, (user) => {
  if (!user) window.location.href = "login.html";
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});

// The only sidebar button wired up to a real feature for now.
document.getElementById("host-game-btn").addEventListener("click", () => {
  window.location.href = "../create-game/create-game.html";
});

// --- Wireframe behavior only: buttons change what's shown, nothing else. ---

// Account buttons open their panel over the map; clicking the open one again closes it.
const navButtons = document.querySelectorAll(".account [data-panel]");
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
document.querySelectorAll(".chip").forEach((chip) => {
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
