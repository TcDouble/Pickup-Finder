// "Notifications" panel on the home page (GitHub issue #17).
//
// Inbox: everything the notifier (../notifier/) has sent you, newest first,
// live. The sidebar badge counts the unread ones. Tapping one marks it read;
// rating requests open Rate players and match alerts open Recommended.
//
// Settings: how to reach you (email, text, desktop) and what about (game
// reminders, rating requests, and alerts for new games that fit your sports,
// area, skill level, and the lowest sportsmanship score you'll play with).
//
// The back end is ../firebase/notifications.js.

import { auth } from "../firebase/firebase-config.js";
import { friendlyEventError } from "../firebase/events.js";
import {
  enableDesktopNotifications,
  getNotificationSettings,
  markNotificationRead,
  saveNotificationSettings,
  watchMyNotifications,
} from "../firebase/notifications.js";
import {
  el,
  fromKm,
  notificationTarget,
  plural,
  relabelDistances,
  showPanel,
  timeAgo,
  toKm,
} from "../assets/panel-helpers.js";
import { loadMySettings } from "../assets/my-settings.js";

const INBOX_SIZE = 30;

// Icons for each kind of notification. Fixed markup, never player text.
const ICONS = {
  reminder:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3"></path></svg>',
  match:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"></path></svg>',
  feedback:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 18.5 21H7V10l4-8a3 3 0 0 1 4 3.9z"></path></svg>',
};

const panel = document.getElementById("panel-notifications");
const heading = document.getElementById("inbox-heading");
const navBadge = document.getElementById("inbox-badge");
const inboxView = document.getElementById("inbox-view");
const inboxList = document.getElementById("inbox-list");
const inboxMessage = document.getElementById("inbox-message");
const markAllButton = document.getElementById("mark-all-read");
const form = document.getElementById("notify-form");
const viewTabs = panel.querySelectorAll(".tabs button");

const fields = {
  email: document.getElementById("notify-email"),
  emailAddress: document.getElementById("notify-email-address"),
  sms: document.getElementById("notify-sms"),
  desktop: document.getElementById("notify-desktop"),
  desktopNote: document.getElementById("notify-desktop-note"),
  phone: document.getElementById("notify-phone"),
  gameReminders: document.getElementById("notify-reminders"),
  feedbackReminders: document.getElementById("notify-feedback"),
  sports: form.querySelectorAll('input[name="alert-sport"]'),
  skill: document.getElementById("alert-skill"),
  score: document.getElementById("alert-score"),
  distance: document.getElementById("alert-distance"),
  useLocation: document.getElementById("alert-use-location"),
  center: document.getElementById("alert-center"),
  message: document.getElementById("notify-message"),
  save: document.getElementById("notify-save"),
};

let items = [];
let settingsLoaded = false;
let alertCenter = null; // { lat, lng } that match alerts measure distance from
let units = "mi"; // "mi" or "km", from Settings

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

viewTabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));

function showView(view) {
  viewTabs.forEach((tab) => tab.setAttribute("aria-pressed", String(tab.dataset.view === view)));
  inboxView.hidden = view !== "inbox";
  form.hidden = view !== "settings";
  if (view === "settings" && !settingsLoaded) loadSettings();
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

auth.authStateReady().then(() => {
  const user = auth.currentUser;
  if (!user) return; // home.js sends them to the login page
  fields.emailAddress.textContent = user.email ? `to ${user.email}` : "";
  watchMyNotifications(renderInbox, { max: INBOX_SIZE }, (err) => {
    console.error("Cannot load notifications:", err);
    heading.textContent = "Inbox";
    inboxList.replaceChildren();
    inboxMessage.textContent = `Couldn't load your notifications. ${friendlyEventError(err)}`;
  });
});

function renderInbox(newItems) {
  items = newItems;
  const unread = items.filter((item) => !item.read).length;
  heading.textContent = unread ? `${unread} new` : "All caught up";
  navBadge.textContent = String(unread);
  navBadge.hidden = unread === 0;
  navBadge.setAttribute("aria-label", `${unread} unread`);
  markAllButton.hidden = unread === 0;
  inboxMessage.textContent = "";
  inboxList.replaceChildren(
    ...(items.length
      ? items.map(inboxRow)
      : [
          el(
            "p",
            { class: "muted inbox-empty" },
            "Nothing here yet. You'll get a reminder before each game you join and a request to rate the other players after it. To hear about new games that fit you, pick sports in Settings.",
          ),
        ]),
  );
}

function inboxRow(item) {
  const icon = el("div", { class: "list-icon", "aria-hidden": "true" });
  icon.innerHTML = ICONS[item.type] ?? ICONS.reminder;
  return el(
    "button",
    {
      type: "button",
      class: item.read ? "list-item inbox-item" : "list-item inbox-item unread",
      onclick: () => openItem(item),
    },
    icon,
    el(
      "div",
      { class: "list-text" },
      el("strong", {}, item.read ? null : el("span", { class: "sr-only" }, "Unread: "), item.title ?? "Notification"),
      el("span", { class: "muted" }, item.body ?? ""),
    ),
    el("span", { class: "time" }, timeAgo(item.createdAt)),
  );
}

async function openItem(item) {
  inboxMessage.textContent = "";
  if (!item.read) {
    try {
      await markNotificationRead(item.id);
    } catch (err) {
      console.error(`Cannot mark ${item.id} read:`, err);
      inboxMessage.textContent = friendlyEventError(err);
    }
  }
  const target = notificationTarget(item);
  if (target) showPanel(target.name, target.gameId);
}

markAllButton.addEventListener("click", async () => {
  const unread = items.filter((item) => !item.read);
  markAllButton.disabled = true;
  inboxMessage.textContent = "";
  try {
    await Promise.all(unread.map((item) => markNotificationRead(item.id)));
  } catch (err) {
    console.error("Cannot mark all read:", err);
    inboxMessage.textContent = friendlyEventError(err);
  } finally {
    markAllButton.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function showFormMessage(text, ok = false) {
  fields.message.textContent = text;
  fields.message.classList.toggle("ok", ok);
}

// Select `value`, adding it as an option first if the list doesn't have it
// (settings saved some other way can hold any number the back end allows).
function selectValue(select, value, label) {
  if (![...select.options].some((option) => option.value === value)) select.add(new Option(label, value));
  select.value = value;
}

async function loadSettings() {
  fields.save.disabled = true;
  showFormMessage("");
  try {
    units = (await loadMySettings()).units;
    relabelDistances(fields.distance, units);
    fillForm(await getNotificationSettings());
    settingsLoaded = true;
    fields.save.disabled = false;
  } catch (err) {
    console.error("Cannot load notification settings:", err);
    showFormMessage(`Couldn't load your settings. ${friendlyEventError(err)}`);
  }
}

function fillForm(settings) {
  fields.email.checked = settings.channels.email;
  fields.sms.checked = settings.channels.sms;
  fields.desktop.checked = settings.channels.desktop;
  fields.desktopNote.textContent = settings.desktopDevices
    ? `(set up in ${plural(settings.desktopDevices, "browser")})`
    : "(asks your browser first)";
  fields.phone.value = settings.phone;
  fields.gameReminders.checked = settings.gameReminders;
  fields.feedbackReminders.checked = settings.feedbackReminders;

  const alerts = settings.matchAlerts;
  fields.sports.forEach((box) => {
    box.checked = alerts.sportIds.includes(box.value);
  });
  fields.skill.value = alerts.skillLevel;
  selectValue(fields.score, String(alerts.minScore), `${alerts.minScore} or higher`);
  if (alerts.near) {
    alertCenter = { lat: alerts.near.lat, lng: alerts.near.lng };
    const distance = fromKm(alerts.near.radiusKm, units);
    selectValue(fields.distance, String(distance), `Within ${distance} ${units}`);
  } else {
    alertCenter = null;
    fields.distance.value = "";
  }
  showCenter();
}

// Desktop notifications need the browser's permission, which it only asks
// for after a click, so this checkbox sets them up right away.
fields.desktop.addEventListener("change", async () => {
  if (!fields.desktop.checked) return; // turned off when the form is saved
  showFormMessage("");
  try {
    const saved = await enableDesktopNotifications();
    fields.desktopNote.textContent = `(set up in ${plural(saved.desktopDevices, "browser")})`;
    showFormMessage("Desktop notifications are on in this browser.", true);
  } catch (err) {
    console.error("Cannot turn on desktop notifications:", err);
    fields.desktop.checked = false;
    showFormMessage(friendlyEventError(err));
  }
});

// Match alerts within a distance need a spot to measure from.
function showCenter() {
  const anywhere = !fields.distance.value;
  fields.useLocation.hidden = anywhere;
  fields.center.classList.toggle("set", !anywhere && alertCenter !== null);
  fields.center.textContent = anywhere
    ? "Games anywhere."
    : alertCenter
      ? `Measured from (${alertCenter.lat.toFixed(3)}, ${alertCenter.lng.toFixed(3)}).`
      : "Use your location so we know where to look.";
}

function locateForAlerts() {
  if (!navigator.geolocation) {
    showFormMessage("Your browser can't share your location, so choose Anywhere.");
    return;
  }
  fields.center.classList.remove("set");
  fields.center.textContent = "Getting your location…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      // About 100 m is plenty for a distance of a mile or more.
      const round = (n) => Math.round(n * 1000) / 1000;
      alertCenter = { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude) };
      showCenter();
    },
    () => {
      showCenter();
      showFormMessage("Couldn't get your location. Allow location for this site, or choose Anywhere.");
    },
    { timeout: 10000, maximumAge: 5 * 60 * 1000 },
  );
}

fields.useLocation.addEventListener("click", locateForAlerts);
fields.distance.addEventListener("change", () => {
  showCenter();
  if (fields.distance.value && !alertCenter) locateForAlerts();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!settingsLoaded) return;
  showFormMessage("");

  const distance = fields.distance.value ? Number(fields.distance.value) : null;
  if (distance && !alertCenter) {
    showFormMessage('Press "Use my location" so we know where to look for games, or choose Anywhere.');
    return;
  }

  fields.save.disabled = true;
  fields.save.textContent = "Saving…";
  try {
    const saved = await saveNotificationSettings({
      channels: {
        email: fields.email.checked,
        sms: fields.sms.checked,
        desktop: fields.desktop.checked,
      },
      phone: fields.phone.value,
      gameReminders: fields.gameReminders.checked,
      feedbackReminders: fields.feedbackReminders.checked,
      matchAlerts: {
        sportIds: [...fields.sports].filter((box) => box.checked).map((box) => box.value),
        skillLevel: fields.skill.value,
        near: distance ? { ...alertCenter, radiusKm: toKm(distance, units) } : null,
        minScore: Number(fields.score.value),
      },
    });
    fillForm(saved);
    showFormMessage("Saved.", true);
  } catch (err) {
    console.error("Cannot save notification settings:", err);
    showFormMessage(friendlyEventError(err));
  } finally {
    fields.save.disabled = false;
    fields.save.textContent = "Save settings";
  }
});
