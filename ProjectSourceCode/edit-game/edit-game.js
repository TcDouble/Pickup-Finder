
import { auth } from "../firebase/firebase-config.js";
import {
  getEvent,
  updateEvent,
  cancelEvent,
  friendlyEventError,
} from "../firebase/events.js";

const $ = (id) => document.getElementById(id);

const form = $("game-form");
const message = $("message");
const submitBtn = $("submit-btn");
const cancelBtn = $("cancel-btn");
const coordsText = $("coords");

let coords = null;
let gameId = null;

function showMessage(text, ok = false) {
  message.textContent = text;
  message.classList.toggle("ok", ok);
}

// Explain why this game can't be edited. The message and the Back link are
// inside the form, so hide the rest of the form instead of all of it.
function showLoadProblem(text) {
  showMessage(text);
  for (const child of form.children) {
    child.hidden = child !== message && !child.classList.contains("alt");
  }
}

function setCoords(value, label = "Location set") {
  coords = value;
  coordsText.classList.toggle("set", !!value);
  coordsText.textContent = value
    ? `${label} (${value.lat.toFixed(4)}, ${value.lng.toFixed(4)})`
    : "Not placed on the map yet.";
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

async function geocode(text) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(text);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) throw new Error("Geocoding failed");

  const results = await response.json();

  if (!results.length) return null;

  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon),
  };
}

async function findPlace() {
  const query = $("address").value.trim() || $("placeName").value.trim();

  if (!query) {
    showMessage("Enter the place name or address first.");
    return null;
  }

  coordsText.textContent = "Looking it up…";

  try {
    const found = await geocode(query);

    if (!found) {
      setCoords(null);
      showMessage("Couldn't find that place. Try a fuller address.");
      return null;
    }

    setCoords(found, "Found it");
    showMessage("");
    return found;
  } catch (error) {
    console.error(error);
    setCoords(null);
    showMessage("Couldn't look up the place. Check your connection.");
    return null;
  }
}

// Changing the place means the previous coordinates may no longer be correct.
$("placeName").addEventListener("input", () => setCoords(null));
$("address").addEventListener("input", () => setCoords(null));

$("find-place").addEventListener("click", findPlace);

$("use-location").addEventListener("click", () => {
  if (!navigator.geolocation) {
    showMessage("Your browser can't share your location.");
    return;
  }

  coordsText.textContent = "Getting your location…";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      setCoords({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      }, "Using your location");
      showMessage("");
    },
    () => {
      setCoords(null);
      showMessage("Couldn't get your location. Try Find this place.");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

async function loadGame() {
  try {
    await auth.authStateReady();

    if (!auth.currentUser) {
      window.location.href = "../login-and-registration/login.html";
      return;
    }

    const params = new URLSearchParams(window.location.search);
    gameId = params.get("game");

    if (!gameId) {
      showLoadProblem("No game was selected.");
      return;
    }

    const event = await getEvent(gameId);

    if (!event) {
      showLoadProblem("This game could not be found.");
      return;
    }

    if (!event.isHost) {
      showLoadProblem("Only the person hosting this game can edit it.");
      return;
    }

    // events.js refuses to change a cancelled game, so say so before they type.
    if (event.status === "cancelled") {
      showLoadProblem("This game was cancelled, so it can't be edited.");
      return;
    }

    document.querySelectorAll('input[name="sport"]').forEach((input) => {
      input.checked = input.value === event.sportId;
      input.disabled = true;
    });

    $("title").value = event.title || "";
    $("placeName").value = event.location?.name || "";
    $("address").value = event.location?.address || "";

    if (event.location?.lat != null && event.location?.lng != null) {
      setCoords({
        lat: event.location.lat,
        lng: event.location.lng,
      }, "Current location");
    }

    $("date").value = formatDate(event.startTime);
    $("startTime").value = formatTime(event.startTime);
    $("endTime").value = formatTime(event.endTime);
    $("playerLimit").value = event.playerLimit;
    $("description").value = event.description || "";

    document.querySelectorAll('input[name="level"]').forEach((input) => {
      input.checked = input.value === event.skillLevel;
    });

    showMessage("");
  } catch (error) {
    console.error("Unable to load game:", error);
    showLoadProblem(friendlyEventError(error));
  }
}

// Save the edited game.
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");

  const placeName = $("placeName").value.trim();
  const date = $("date").value;
  const startClock = $("startTime").value;
  const endClock = $("endTime").value;

  if (!placeName) {
    showMessage("Enter where the game is.");
    return;
  }

  if (!date || !startClock || !endClock) {
    showMessage("Enter the date, start time and end time.");
    return;
  }

  const startTime = new Date(`${date}T${startClock}`);
  const endTime = new Date(`${date}T${endClock}`);

  if (endTime <= startTime) {
    endTime.setDate(endTime.getDate() + 1);
  }

  const skillLevel =
    document.querySelector('input[name="level"]:checked')?.value;

  submitBtn.disabled = true;
  cancelBtn.disabled = true;
  submitBtn.textContent = "Saving changes…";

  try {
    await auth.authStateReady();

    if (!auth.currentUser) {
      window.location.href = "../login-and-registration/login.html";
      return;
    }

    const spot = coords ?? await findPlace();

    if (!spot) return;

    await updateEvent(gameId, {
      title: $("title").value,
      description: $("description").value,
      skillLevel,
      startTime,
      endTime,
      location: {
        name: placeName,
        address: $("address").value.trim(),
        lat: spot.lat,
        lng: spot.lng,
      },
      playerLimit: Number($("playerLimit").value),
    });

    showMessage("Your game has been updated!", true);

    setTimeout(() => {
      window.location.href = "../login-and-registration/home.html?panel=games";
    }, 1000);
  } catch (error) {
    console.error("Unable to update game:", error);
    showMessage(friendlyEventError(error));
  } finally {
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
    submitBtn.textContent = "Save changes";
  }
});

// Cancel the game.
cancelBtn.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Are you sure you want to cancel this game? Players will see that it was cancelled."
  );

  if (!confirmed) return;

  submitBtn.disabled = true;
  cancelBtn.disabled = true;
  cancelBtn.textContent = "Cancelling…";

  try {
    await auth.authStateReady();

    if (!auth.currentUser) {
      window.location.href = "../login-and-registration/login.html";
      return;
    }

    await cancelEvent(gameId);

    showMessage("Your game has been cancelled.", true);

    setTimeout(() => {
      window.location.href = "../login-and-registration/home.html?panel=games";
    }, 1000);
  } catch (error) {
    console.error("Unable to cancel game:", error);
    showMessage(friendlyEventError(error));
  } finally {
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
    cancelBtn.textContent = "Cancel Game";
  }
});

loadGame();
