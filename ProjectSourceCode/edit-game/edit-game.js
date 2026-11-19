import { auth } from "../firebase/firebase-config.js";
import { getEvent, friendlyEventError } from "../firebase/events.js";

const $ = (id) => document.getElementById(id);

const form = $("game-form");
const message = $("message");

function showMessage(text) {
  message.textContent = text;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

async function loadGame() {
  try {
    await auth.authStateReady();

    if (!auth.currentUser) {
      window.location.href = "../login-and-registration/login.html";
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const gameId = params.get("game");

    if (!gameId) {
      showMessage("No game was selected.");
      form.hidden = true;
      return;
    }

    const event = await getEvent(gameId);

    if (!event) {
      showMessage("This game could not be found.");
      form.hidden = true;
      return;
    }

    if (!event.isHost) {
      showMessage("Only the person hosting this game can edit it.");
      form.hidden = true;
      return;
    }

    document.querySelectorAll('input[name="sport"]').forEach((input) => {
      input.checked = input.value === event.sportId;
      input.disabled = true;
    });

    $("title").value = event.title || "";
    $("placeName").value = event.location?.name || "";
    $("address").value = event.location?.address || "";
    $("coords").textContent =
      event.location?.lat != null && event.location?.lng != null
        ? `${event.location.lat.toFixed(5)}, ${event.location.lng.toFixed(5)}`
        : "Location coordinates unavailable.";

    const start = event.startTime;
    const end = event.endTime;

    $("date").value = formatDate(start);
    $("startTime").value = formatTime(start);
    $("endTime").value = formatTime(end);
    $("playerLimit").value = event.playerLimit;
    $("description").value = event.description || "";

    document.querySelectorAll('input[name="level"]').forEach((input) => {
      input.checked = input.value === event.skillLevel;
    });

    showMessage("");
  } catch (error) {
    console.error("Unable to load game:", error);
    showMessage(friendlyEventError(error));
    form.hidden = true;
  }
}

loadGame();
