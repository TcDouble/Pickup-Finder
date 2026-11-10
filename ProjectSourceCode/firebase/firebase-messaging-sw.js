// Service worker for desktop notifications (GitHub issue #17).
//
// enableDesktopNotifications() in notifications.js registers this file. The
// browser keeps it running in the background, so it can show a notification
// from the notifier (../notifier/) even when no Pickup-Finder tab is open.
//
// Service workers can't import firebase-config.js, so notifications.js passes
// the project's public settings in this file's URL.

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

const params = new URL(self.location.href).searchParams;
firebase.initializeApp({
  apiKey: params.get("apiKey"),
  projectId: params.get("projectId"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
});

// The notifier sends a `notification` payload, which Firebase shows on its
// own while no tab has the site in front. Clicking it opens the link the
// notifier set (the game's page).
firebase.messaging();
