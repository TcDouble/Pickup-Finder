import { auth } from "../firebase/firebase-config.js";
import { createEvent, friendlyEventError } from "../firebase/events.js";

const form = document.getElementById("game-form");
const message = document.getElementById("message");
const submitBtn = document.getElementById("submit-btn");
const coordsText = document.getElementById("coords");
const findPlaceBtn = document.getElementById("find-place");
const useLocationBtn = document.getElementById("use-location");

// The spot on the map for the game. events.js requires lat/lng.
let coords = null;

function showMessage(text, ok = false) {
  message.textContent = text;
  message.classList.toggle("ok", ok);
}

function setCoords(value, label) {
  coords = value;
  coordsText.classList.toggle("set", !!value);
  coordsText.textContent = value
    ? `${label} (${value.lat.toFixed(4)}, ${value.lng.toFixed(4)})`
    : "Not placed on the map yet.";
}

// Typing a new place means the old coordinates may be wrong.
form.placeName.addEventListener("input", () => setCoords(null));
form.address.addEventListener("input", () => setCoords(null));

// Default the date to today so the form is quicker to fill in.
const today = new Date();
form.date.value = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, "0"),
  String(today.getDate()).padStart(2, "0"),
].join("-");

// Anyone can see and fill in the form. Saving still needs a signed-in user,
// because events.js and firestore.rules both require one; we only check that
// when they press "Create game".
function showLoginNeeded() {
  message.classList.remove("ok");
  message.innerHTML =
    'You need to be logged in to create a game. <a href="../login/login.html">Log in</a>';
}

// Look up a place's coordinates with OpenStreetMap's free geocoder.
async function geocode(text) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(text);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Geocoding failed");
  const results = await res.json();
  if (!results.length) return null;
  return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
}

async function findPlace() {
  const query = form.address.value.trim() || form.placeName.value.trim();
  if (!query) {
    showMessage("Enter the place name or address first.");
    return null;
  }
  coordsText.classList.remove("set");
  coordsText.textContent = "Looking it up…";
  try {
    const found = await geocode(query);
    if (!found) {
      setCoords(null);
      showMessage("Couldn't find that place. Try adding a full address, or use your location.");
      return null;
    }
    setCoords(found, "Found it");
    showMessage("");
    return found;
  } catch (err) {
    console.error(err);
    setCoords(null);
    showMessage("Couldn't look up the place. Check your connection, or use your location.");
    return null;
  }
}

findPlaceBtn.addEventListener("click", findPlace);

useLocationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showMessage("Your browser can't share your location. Use \"Find this place\" instead.");
    return;
  }
  coordsText.classList.remove("set");
  coordsText.textContent = "Getting your location…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }, "Using your location");
      showMessage("");
    },
    () => {
      setCoords(null);
      showMessage("Couldn't get your location. Use \"Find this place\" instead.");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMessage("");

  const sportId = form.querySelector('input[name="sport"]:checked')?.value;
  const skillLevel = form.querySelector('input[name="level"]:checked')?.value;
  const placeName = form.placeName.value.trim();
  const date = form.date.value;
  const startClock = form.startTime.value;
  const endClock = form.endTime.value;

  if (!placeName) return showMessage("Enter where the game is.");
  if (!date || !startClock || !endClock) return showMessage("Enter the date, start time and end time.");

  const startTime = new Date(`${date}T${startClock}`);
  const endTime = new Date(`${date}T${endClock}`);
  // An end time earlier than the start means the game runs past midnight.
  if (endTime <= startTime) endTime.setDate(endTime.getDate() + 1);

  submitBtn.disabled = true;
  submitBtn.textContent = "Creating game…";

  try {
    // Wait for Firebase to finish loading any saved login, then check it.
    await auth.authStateReady();
    if (!auth.currentUser) return showLoginNeeded();

    // If they didn't place it on the map yet, try looking up what they typed.
    const spot = coords ?? (await findPlace());
    if (!spot) return;

    // createEvent validates everything again and throws EventError with a
    // message that's safe to show.
    const id = await createEvent({
      sportId,
      title: form.title.value,
      description: form.description.value,
      skillLevel,
      startTime,
      endTime,
      location: { name: placeName, address: form.address.value, lat: spot.lat, lng: spot.lng },
      playerLimit: Number(form.playerLimit.value),
    });

    console.log("Created event", id);
    showMessage("Your game is created! Players can now find it and join.", true);
    form.reset();
    setCoords(null);
    form.date.value = date;
  } catch (err) {
    console.error(err);
    showMessage(friendlyEventError(err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Create game";
  }
});
