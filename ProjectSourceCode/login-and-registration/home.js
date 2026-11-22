import { auth, db, storage } from "../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { watchEvents, listMyEvents } from "../firebase/events.js";
import { getPlayerStats } from "../firebase/sportsmanship.js";
import { DEFAULT_PHOTO, SPORT_NAMES, friendlyError, hasProfile } from "./auth-helpers.js";
import { photoError } from "./validateRegistration.js";
import { MAX_BIO } from "./validateProfile.js";
import { countGamesHosted, deleteAccount, getProfile, saveProfile, sendPasswordReset } from "./profile.js";
import { setupEventFilters } from "./filters.js";
import { gameCountText, gameDetails, groupIntoPins, pinLook, pinTitle } from "./map-pins.js";
import { el } from "../assets/panel-helpers.js";

const $ = (id) => document.getElementById(id);

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
    // Preserve the existing behavior if the profile check fails.
    console.error("Cannot check profile:", err);
  }

  // Show the app before waiting for Google Maps.
  document.documentElement.classList.remove("auth-pending");
  openPanelFromLink();

  const status = document.querySelector(".game-count");
  const locationButton = document.getElementById("track-location");

  status.textContent = "Loading map...";
  locationButton.disabled = true;

  try {
    await initializePickupMap();
  } catch (err) {
    console.error("Cannot initialize map:", err);

    status.textContent =
      err instanceof Error
        ? err.message
        : "Map is unavailable. Please refresh to retry.";

    locationButton.disabled = true;
  }
});

$("logout-btn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.replace("login.html");
});

// Sidebar buttons open their panel over the map; clicking the open one again closes it.
// "+ Host a game" opens the create-game form, which ../create-game/create-game.js runs.
// Notifications, Recommended, and Rate players are run by the scripts in
// ../notifications/, ../recommended/, and ../rate-players/, and Friends and
// Online now by the scripts in ../social/.
// My games and Profile are still wireframe placeholders.
const navButtons = document.querySelectorAll(".sidebar [data-panel]");
const panels = document.querySelectorAll(".panel");

function showPanel(name) {
  panels.forEach((panel) => { panel.hidden = panel.id !== `panel-${name}`; });
  navButtons.forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.panel === name)));
  if (name === "profile") loadProfile();
  if (name === "games") loadMyGames("joined");
}

// Other scripts open a panel with showPanel() in ../assets/panel-helpers.js,
// which sends this event. Its detail is { name, gameId }.
document.addEventListener("pickup:show-panel", (event) => showPanel(event.detail?.name ?? null));

// Links in notifications open a panel: home.html?panel=rate&game=<id>.
function openPanelFromLink() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("panel")) return;
  document.dispatchEvent(new CustomEvent("pickup:show-panel", {
    detail: { name: params.get("panel"), gameId: params.get("game") },
  }));
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    showPanel(btn.getAttribute("aria-pressed") === "true" ? null : btn.dataset.panel);
  });
});

document.querySelectorAll(".close-btn").forEach((btn) => {
  btn.addEventListener("click", () => showPanel(null));
});

// ---------------------------------------------------------------------------
// Profile panel
// ---------------------------------------------------------------------------

const profileForm = $("profile-form");
const deleteForm = $("delete-form");
let profile = null;

function showMessage(id, text, ok = false) {
  $(id).textContent = text;
  $(id).classList.toggle("ok", ok);
}

function showProfileView(which) {
  $("profile-view").hidden = which !== "view";
  profileForm.hidden = which !== "edit";
  deleteForm.hidden = which !== "delete";
}

async function loadProfile() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  showProfileView("view");
  showMessage("profile-message", "");
  try {
    // Stats are extras: if one fails, still show the profile.
    const [loaded, stats, hosted] = await Promise.all([
      getProfile({ db }, uid),
      getPlayerStats(uid).catch((err) => console.error(err)),
      countGamesHosted({ db }, uid).catch((err) => console.error(err)),
    ]);
    profile = loaded;
    renderProfile(stats, hosted);
  } catch (err) {
    console.error(err);
    showMessage("profile-message", "We couldn't load your profile. Please try again.");
  }
}

function renderProfile(stats, hosted) {
  $("profile-photo").src = profile?.photoURL || DEFAULT_PHOTO;
  $("profile-name").textContent = profile?.displayName || "Your profile";
  const since = profile?.createdAt
    ? `Member since ${profile.createdAt.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`
    : "";
  $("profile-meta").textContent = [profile?.city, since].filter(Boolean).join(" · ");

  $("stat-played").textContent = stats?.gamesPlayed ?? "–";
  $("stat-hosted").textContent = hosted ?? "–";
  $("stat-score").textContent = stats?.score ?? "–";

  const sports = profile?.sports ?? [];
  const tags = sports.map((sport) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    const level = profile.sportLevels[sport];
    const name = SPORT_NAMES[sport] ?? sport;
    tag.textContent = level ? `${name} · ${level[0].toUpperCase()}${level.slice(1)}` : name;
    return tag;
  });
  if (tags.length === 0) {
    const none = document.createElement("span");
    none.className = "muted";
    none.textContent = "No sports yet.";
    tags.push(none);
  }
  $("profile-sports").replaceChildren(...tags);

  $("profile-bio").textContent = profile?.bio || "No bio yet.";
  $("profile-bio").classList.toggle("muted", !profile?.bio);
}

// --- Edit profile ---

const photoInput = $("edit-photo");
const photoPreview = $("edit-photo-preview");
const photoRemove = $("edit-photo-remove");
const sportBoxes = profileForm.querySelectorAll('input[name="sports"]');
const levelFor = (sport) => profileForm.querySelector(`select[name="level-${sport}"]`);
let newPhoto = null;
let removePhoto = false;
let previewURL = null;

function showEditPhoto() {
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = newPhoto ? URL.createObjectURL(newPhoto) : null;
  photoPreview.src = previewURL ?? (removePhoto ? null : profile?.photoURL) ?? DEFAULT_PHOTO;
  photoRemove.hidden = !newPhoto && (removePhoto || !profile?.photoURL);
}

function updateBioCount() {
  $("edit-bio-count").textContent = `${$("edit-bio").value.length} / ${MAX_BIO}`;
}

$("edit-profile-btn").addEventListener("click", () => {
  newPhoto = null;
  removePhoto = false;
  photoInput.value = "";
  showEditPhoto();
  $("edit-name").value = profile?.displayName ?? "";
  $("edit-city").value = profile?.city ?? "";
  $("edit-bio").value = profile?.bio ?? "";
  updateBioCount();
  sportBoxes.forEach((box) => {
    box.checked = profile?.sports.includes(box.value) ?? false;
    levelFor(box.value).value = profile?.sportLevels[box.value] ?? "casual";
    levelFor(box.value).disabled = !box.checked;
  });
  showMessage("edit-message", "");
  showProfileView("edit");
});

$("cancel-edit-btn").addEventListener("click", () => showProfileView("view"));

sportBoxes.forEach((box) => {
  box.addEventListener("change", () => { levelFor(box.value).disabled = !box.checked; });
});

$("edit-bio").addEventListener("input", updateBioCount);

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0] ?? null;
  const problem = photoError(file);
  showMessage("edit-message", problem ?? "");
  if (problem) photoInput.value = "";
  newPhoto = problem ? null : file;
  if (newPhoto) removePhoto = false;
  showEditPhoto();
});

photoRemove.addEventListener("click", () => {
  photoInput.value = "";
  newPhoto = null;
  removePhoto = Boolean(profile?.photoURL);
  showEditPhoto();
});

profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const sports = [...sportBoxes].filter((box) => box.checked).map((box) => box.value);
  const input = {
    photo: newPhoto,
    removePhoto,
    displayName: $("edit-name").value,
    city: $("edit-city").value,
    sports,
    sportLevels: Object.fromEntries(sports.map((sport) => [sport, levelFor(sport).value])),
    bio: $("edit-bio").value,
  };

  const saveBtn = $("save-profile-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  try {
    await saveProfile({ auth, db, storage }, input);
    await loadProfile();
    showMessage("profile-message", "Profile saved.", true);
  } catch (err) {
    console.error(err);
    const text =
      err.code === "profile/invalid" ? err.message
      : err.code === "permission-denied" ? "We couldn't save your profile. Please try again."
      : friendlyError(err.code);
    showMessage("edit-message", text);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
});

// --- Reset password ---

$("reset-password-btn").addEventListener("click", async () => {
  const btn = $("reset-password-btn");
  btn.disabled = true;
  try {
    const email = await sendPasswordReset({ auth });
    showMessage("profile-message", `We sent a reset link to ${email}.`, true);
  } catch (err) {
    console.error(err);
    showMessage("profile-message", friendlyError(err.code));
  } finally {
    btn.disabled = false;
  }
});

// --- Delete account ---

$("delete-account-btn").addEventListener("click", () => {
  $("delete-password").value = "";
  showMessage("delete-message", "");
  showProfileView("delete");
});

$("cancel-delete-btn").addEventListener("click", () => showProfileView("view"));

deleteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("confirm-delete-btn");
  btn.disabled = true;
  btn.textContent = "Deleting…";
  try {
    await deleteAccount({ auth, db, storage }, $("delete-password").value);
    window.location.href = "login.html";
  } catch (err) {
    console.error(err);
    const text =
      err.code === "profile/invalid" ? err.message
      : err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" ? "Incorrect password."
      : friendlyError(err.code);
    showMessage("delete-message", text);
    btn.disabled = false;
    btn.textContent = "Delete account";
  }
});

// --- Wireframe behavior only: these change what's shown, nothing else. ---

// Initialize the filter controls.
const filters = setupEventFilters();
const BOULDER = { lat: 40.0076, lng: -105.2659 };

let map;
let infoWindow;
// Game pins by pin.key from map-pins.js: { marker, pin, look }. Live updates
// change these in place, so an open popup stays open with the new numbers.
const pinMarkers = new Map();
let openPinKey = null;
let userMarker = null;
let trackingId = null;
let mapInitPromise;
let unsubscribeEvents;

const trackButton = document.getElementById("track-location");

// Load Google Maps.
async function loadGoogleMaps() {
  if (window.google?.maps?.importLibrary) {
    return;
  }

  // Load the local configuration only when the map needs it.
  let config;

  try {
    config = await import("./maps-config.local.js");
  } catch {
    throw new Error("Map configuration is unavailable.");
  }

  const key = config.MAPS_API_KEY;

  if (
    typeof key !== "string" ||
    !key.trim() ||
    key.trim() === "YOUR_GOOGLE_MAPS_API_KEY"
  ) {
    throw new Error("Map API key has not been configured.");
  }

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let finished = false;

    const timer = setTimeout(() => {
      finish(new Error("Map loading timed out. Please refresh to retry."));
    }, 15000);

    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      // Safely ignore a callback arriving after a timeout.
      window.pickupMapsLoaded = () => {};

      if (error) {
        script.remove();
        reject(error);
      } else {
        resolve();
      }
    }

    window.pickupMapsLoaded = () => finish();

    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(key.trim())}` +
      "&loading=async&callback=pickupMapsLoaded";

    script.async = true;

    script.onerror = () => {
      finish(new Error("Map could not load. Check your connection."));
    };

    document.head.appendChild(script);
  });
}

// Called by your existing login check.
function initializePickupMap() {
  if (!mapInitPromise) {
    mapInitPromise = setupPickupMap();
  }
  return mapInitPromise;
}

async function setupPickupMap() {
  await loadGoogleMaps();

  const { Map, InfoWindow } = await google.maps.importLibrary("maps");
  await google.maps.importLibrary("marker");

  map = new Map(document.getElementById("google-map"), {
    center: BOULDER,
    zoom: 13,
    mapId: "DEMO_MAP_ID",
    zoomControl: false,
  });

  infoWindow = new InfoWindow();
  infoWindow.addListener("closeclick", () => {
    openPinKey = null;
  });
  document.querySelector(".game-count").textContent = "Loading games...";
  unsubscribeEvents = watchEvents(
    {},
    (events) => {
      try {
        displayEvents(events);
      } catch (err) {
        console.error("Cannot show games on the map:", err);
        document.querySelector(".game-count").textContent = "Unable to show games";
      }
    },
    (error) => {
      console.error("Cannot load events:", error);
      document.querySelector(".game-count").textContent =
        "Unable to load games";
    },
  );

  const zoomButtons = document.querySelectorAll(".zoom button");
  zoomButtons[0].addEventListener("click", () => {
    map.setZoom(map.getZoom() + 1);
  });
  zoomButtons[1].addEventListener("click", () => {
    map.setZoom(map.getZoom() - 1);
  });

  trackButton.disabled = false;
}

// Show the games from Firestore as pins: one pin per spot (see map-pins.js),
// updated in place on every live change. Games without a valid saved
// location are left off the map, and one pin failing doesn't stop the rest.
function displayEvents(events) {
  const { pins, skipped } = groupIntoPins(events);
  if (skipped.length > 0) {
    console.warn(
      "Games left off the map (no valid saved location):",
      skipped.map((event) => event?.id),
    );
  }

  const shown = new Set();
  for (const pin of pins) {
    try {
      showPin(pin);
      shown.add(pin.key);
    } catch (err) {
      console.error(`Cannot show the pin at ${pin.key}:`, err);
    }
  }

  // Remove the pins for games that are gone (started, cancelled, moved).
  for (const [key, entry] of pinMarkers) {
    if (shown.has(key)) continue;
    entry.marker.map = null;
    pinMarkers.delete(key);
  }

  // Keep an open popup current, or close it if its pin is gone.
  if (openPinKey !== null) {
    const open = pinMarkers.get(openPinKey);
    if (open) {
      infoWindow.setContent(pinPopup(open.pin));
    } else {
      infoWindow.close();
      openPinKey = null;
    }
  }

  let gameCount = 0;
  for (const entry of pinMarkers.values()) gameCount += entry.pin.events.length;
  document.querySelector(".game-count").textContent = gameCountText(gameCount);
}

// Add a pin, or update the one already at that spot.
function showPin(pin) {
  const { icon, count } = pinLook(pin);
  const look = `${icon} ${count}`;
  const existing = pinMarkers.get(pin.key);
  if (existing) {
    existing.pin = pin;
    existing.marker.title = pinTitle(pin);
    if (existing.look !== look) {
      existing.marker.content = pinElement(icon, count);
      existing.look = look;
    }
    return;
  }

  const marker = new google.maps.marker.AdvancedMarkerElement({
    map,
    position: pin.position,
    title: pinTitle(pin),
    content: pinElement(icon, count),
  });
  // The listener reads the entry when clicked, so it always shows the latest games.
  marker.addListener("click", () => openPin(pin.key));
  pinMarkers.set(pin.key, { marker, pin, look });
}

function openPin(key) {
  const entry = pinMarkers.get(key);
  if (!entry) return;
  openPinKey = key;
  infoWindow.setContent(pinPopup(entry.pin));
  infoWindow.open({ map, anchor: entry.marker });
}

// The pin: the sport's icon, plus a count when several games share the spot.
function pinElement(icon, count) {
  return el(
    "div",
    { class: "map-pin" },
    el("span", { class: "map-pin-head", "aria-hidden": "true" }, icon),
    count > 1 && el("span", { class: "map-pin-count", "aria-hidden": "true" }, String(count)),
    el("span", { class: "map-pin-point", "aria-hidden": "true" }),
  );
}

// The popup for a pin. One game: its name, then where and when. Several
// games at one spot: the place, then each game soonest first.
function pinPopup(pin) {
  const games = pin.events.map((event) => gameDetails(event));
  const [first] = games;
  const where = [
    el("p", {}, first.place),
    first.address && el("p", { class: "muted" }, first.address),
  ];
  const whenAndWho = (game) => [
    el("p", {}, `${game.date} · ${game.time}`),
    el("p", { class: "muted" }, [game.players, game.skill].filter(Boolean).join(" · ")),
  ];

  if (games.length === 1) {
    return el("div", { class: "pin-popup" }, el("h3", {}, first.name), where, whenAndWho(first));
  }
  return el(
    "div",
    { class: "pin-popup" },
    el("h3", {}, first.place),
    first.address && el("p", { class: "muted" }, first.address),
    el(
      "ul",
      {},
      games.map((game) =>
        el(
          "li",
          {},
          el("strong", {}, game.name),
          // Only when this game saved a different name for the same spot.
          game.place !== first.place && el("p", {}, game.place),
          whenAndWho(game),
        ),
      ),
    ),
  );
}

function stopTracking() {
  if (trackingId !== null) {
    navigator.geolocation.clearWatch(trackingId);
    trackingId = null;
  }

  if (userMarker) {
    userMarker.map = null;
    userMarker = null;
  }

  trackButton.textContent = "Start location tracking";
}

// Start or stop tracking this browser's location.
trackButton.addEventListener("click", () => {
  if (!map) return;

  if (trackingId !== null) {
    stopTracking();
    return;
  }

  if (!navigator.geolocation) {
    alert("Geolocation is not supported.");
    return;
  }

  let firstUpdate = true;
  trackButton.textContent = "Stop location tracking";

  trackingId = navigator.geolocation.watchPosition(
    (position) => {
      const current = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      if (!userMarker) {
        userMarker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: current,
          title: "Your location",
          zIndex: 1000,
        });
      } else {
        userMarker.position = current;
      }

      if (firstUpdate) {
        map.panTo(current);
        map.setZoom(15);
        firstUpdate = false;
      }
    },
    (error) => {
      console.error("Location error:", error);
      stopTracking();
      alert("Unable to get your location. Check location permissions.");
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    }
  );
});
// --- My games: load and display the user's games ---

const tabs = document.querySelectorAll("#panel-games .tabs button");
const myGamesList = $("my-games-list");
const myGamesMessage = $("my-games-message");

async function loadMyGames(view = "joined") {
  myGamesList.replaceChildren();
  myGamesMessage.textContent = "Loading games...";

  const role = view === "hosting" ? "hosting" : "joined";
  const when = view === "past" ? "past" : "upcoming";

  try {
    const events = await listMyEvents({ role, when });

    myGamesMessage.textContent = "";

    if (events.length === 0) {
      myGamesList.textContent =
        view === "hosting"
          ? "You aren't hosting any upcoming games."
          : view === "past"
            ? "You don't have any past games."
            : "You haven't joined any upcoming games yet.";
      return;
    }

    events.forEach((event) => {
      const card = document.createElement("div");
      card.className = "game-card";

      const date = event.startTime instanceof Date
        ? event.startTime
        : new Date(event.startTime);

      const dateBox = document.createElement("div");
      dateBox.className = "date-box";

      const month = document.createElement("span");
      month.textContent = date.toLocaleDateString(undefined, {
        month: "short",
      });

      const day = document.createElement("span");
      day.textContent = date.getDate();

      dateBox.append(month, day);

      const details = document.createElement("div");
      details.className = "list-text";

      const sport = SPORT_NAMES[event.sportId] || "Pickup game";
      const heading = document.createElement("strong");
      heading.textContent = event.title
        ? `${sport} · ${event.title}`
        : `Pickup ${sport}`;

      const location = document.createElement("span");
      location.textContent = event.location?.name || "Location not listed";

      const time = document.createElement("span");
      time.textContent = date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });

      const players = document.createElement("span");
      players.textContent =
        `${event.playerCount ?? 0} / ${event.playerLimit} players`;

      details.append(heading, location, time, players);
      card.append(dateBox, details);

      if (view === "hosting" && event.isHost) {
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "btn";
        editButton.textContent = "Edit";

        editButton.addEventListener("click", () => {
          window.location.href =
            `../edit-game/edit-game.html?game=${encodeURIComponent(event.id)}`;
        });

        card.append(editButton);
      }

      myGamesList.append(card);
    });
  } catch (error) {
    console.error("Unable to load games:", error);
    myGamesMessage.textContent = friendlyError(error.code);
  }
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) =>
      t.setAttribute("aria-pressed", String(t === tab))
    );

    const view = tab.textContent.trim().toLowerCase();
    loadMyGames(view);
  });
});
