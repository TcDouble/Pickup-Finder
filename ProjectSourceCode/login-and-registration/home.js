import { auth } from "../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { hasProfile } from "./auth-helpers.js";
import { watchEvents } from "../firebase/events.js";
// import { MAPS_API_KEY } from "./maps-config.local.js";


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
const BOULDER = { lat: 40.0076, lng: -105.2659 };

let map;
let infoWindow;
let gameMarkers = [];
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
  document.querySelector(".game-count").textContent = "Loading games...";
  unsubscribeEvents = watchEvents({}, displayEvents, (error) => {
    console.error("Cannot load events:", error);
    document.querySelector(".game-count").textContent =
      "Unable to load games";
  });

  const zoomButtons = document.querySelectorAll(".zoom button");
  zoomButtons[0].addEventListener("click", () => {
    map.setZoom(map.getZoom() + 1);
  });
  zoomButtons[1].addEventListener("click", () => {
    map.setZoom(map.getZoom() - 1);
  });

  trackButton.disabled = false;
}

// Convert Firestore events into map pins.
function displayEvents(events) {
  infoWindow.close();
  gameMarkers.forEach((marker) => {
    marker.map = null;
  });
  gameMarkers = [];

  for (const event of events) {
    const location = event.location;
    if (
      !location ||
      !Number.isFinite(location.lat) ||
      !Number.isFinite(location.lng)
    ) {
      continue;
    }

    const marker = new google.maps.marker.AdvancedMarkerElement({
      map,
      position: { lat: location.lat, lng: location.lng },
      title: event.title || event.sportId || "Game",
    });

    marker.addListener("click", () => {
      const content = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = event.title || event.sportId || "Game";
      content.append(title);

      const details = [
        `${event.sportId} | ${location.name}`,
        event.startTime
          ? event.startTime.toLocaleString()
          : "Time unavailable",
        `${event.playerCount}/${event.playerLimit} players`,
      ];

      for (const text of details) {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        content.append(paragraph);
      }

      infoWindow.setContent(content);
      infoWindow.open({ map, anchor: marker });
    });

    gameMarkers.push(marker);
  }

  document.querySelector(".game-count").textContent =
    `${gameMarkers.length} games available`;
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
// My games tabs: only one is selected at a time.
const tabs = document.querySelectorAll(".tabs button");
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.setAttribute("aria-pressed", String(t === tab)));
  });
});
