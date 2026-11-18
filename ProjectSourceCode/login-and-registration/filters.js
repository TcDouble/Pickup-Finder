
/*
 * filters.js
 *
 * Handles the filter controls on the PickupFinder home page.
 * This file does NOT interact with Firebase, Google Maps, or map markers.
 * This is meant to seperate and organized our code for functionality.
 *
 * CURRENTLY AN EXPORTED FUNCTION THAT IS NOT BEING USED OR IMPORTED
 * DONT EXPECT ANY FUNCTIONALITY UNTIL IT IS IMPORTED INTO home.js AND USED
 * 
 * home.js is responsible for passing events into filterEvents()
 * and deciding how to display the filtered results.
 */

export function setupEventFilters(onChange = () => {}) {
  // Get references to the existing filter controls.
  const locationInput = document.getElementById("f-loc");
  const timeSelect = document.getElementById("f-time");
  const skillSelect = document.getElementById("f-skill");
  const activityChips = document.querySelectorAll(".filters .chip");

  // Read the currently selected filter settings.
  function getFilters() {
    const selectedActivities = [];

    activityChips.forEach((chip) => {
      if (chip.getAttribute("aria-pressed") === "true") {
        selectedActivities.push(chip.textContent.trim().toLowerCase());
      }
    });

    return {
      location: locationInput.value.trim().toLowerCase(),
      time: timeSelect.value,
      skill: skillSelect.value.toLowerCase(),
      activities: selectedActivities,
    };
  }

  // Convert an event's startTime into a JavaScript Date.
  function getEventDate(event) {
    if (!event.startTime) return null;

    // Supports regular JavaScript Date objects.
    if (event.startTime instanceof Date) {
      return event.startTime;
    }

    // Supports Firestore Timestamp objects.
    if (typeof event.startTime.toDate === "function") {
      return event.startTime.toDate();
    }

    // Supports timestamp values stored as numbers or strings.
    const date = new Date(event.startTime);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Check whether an event matches the selected time filter.
  function matchesTime(event, selectedTime) {
    if (selectedTime === "Today · Any time") {
      const eventDate = getEventDate(event);
      if (!eventDate) return false;

      const today = new Date();

      return (
        eventDate.getFullYear() === today.getFullYear() &&
        eventDate.getMonth() === today.getMonth() &&
        eventDate.getDate() === today.getDate()
      );
    }

    if (selectedTime === "Tonight") {
      const eventDate = getEventDate(event);
      if (!eventDate) return false;

      const today = new Date();

      return (
        eventDate.getFullYear() === today.getFullYear() &&
        eventDate.getMonth() === today.getMonth() &&
        eventDate.getDate() === today.getDate() &&
        eventDate.getHours() >= 17
      );
    }

    if (selectedTime === "This weekend") {
      const eventDate = getEventDate(event);
      if (!eventDate) return false;

      const today = new Date();
      const day = today.getDay();

      // Find the Saturday of the current or upcoming weekend.
      const daysUntilSaturday = (6 - day + 7) % 7;

      const saturday = new Date(today);
      saturday.setDate(today.getDate() + daysUntilSaturday);
      saturday.setHours(0, 0, 0, 0);

      const monday = new Date(saturday);
      monday.setDate(saturday.getDate() + 2);

      return eventDate >= saturday && eventDate < monday;
    }

    return true;
  }

  // Check whether an event matches all active filters.
  function filterEvents(events) {
    const filters = getFilters();

    return events.filter((event) => {
      // Activity filter.
      if (
        filters.activities.length > 0 &&
        !filters.activities.includes(
          String(event.sportId || "").toLowerCase()
        )
      ) {
        return false;
      }

      // Skill-level filter.
      if (
        filters.skill !== "any level" &&
        String(event.skillLevel || "").toLowerCase() !== filters.skill
      ) {
        return false;
      }

      // Time filter.
      if (!matchesTime(event, filters.time)) {
        return false;
      }

      // Location text search.
      if (filters.location) {
        const eventLocation = event.location || {};

        const searchableLocation = [
          eventLocation.name,
          eventLocation.address,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!searchableLocation.includes(filters.location)) {
          return false;
        }
      }

      return true;
    });
  }

  // Notify home.js whenever a filter changes.
  function notifyChange() {
    onChange(getFilters());
  }

  // Activity chips can have multiple selections.
  activityChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const currentlySelected =
        chip.getAttribute("aria-pressed") === "true";

      chip.setAttribute("aria-pressed", String(!currentlySelected));

      notifyChange();
    });
  });

  // Location updates as the user types.
  locationInput.addEventListener("input", notifyChange);

  // Dropdown filters update when their selection changes.
  timeSelect.addEventListener("change", notifyChange);
  skillSelect.addEventListener("change", notifyChange);

  // Give home.js access to the filtering function and current settings.
  return {
    filterEvents,
    getFilters,
  };
}
