# Firestore back end: games, sportsmanship, matchmaking, and notifications

**Owner:** Jun

Pickup games live in the Firestore `events` collection, the feedback players leave each other after a game lives in `feedback` and `sportsmanship`, and notification settings and the inbox live in `notificationSettings` and `notifications`. Pages don't talk to these collections directly: they call the functions in [`events.js`](events.js), [`sportsmanship.js`](sportsmanship.js), [`matchmaking.js`](matchmaking.js), and [`notifications.js`](notifications.js), and [`firestore.rules`](firestore.rules) makes Firestore refuse anything those functions wouldn't allow (going over the player limit, editing someone else's game, RSVPing another person, rating someone you didn't play with, reading someone else's phone number).

| File | What it is |
| --- | --- |
| `firebase-config.js` | Shared Firebase setup (Paul). `events.js` uses its `db` and `auth`. |
| `events.js` | Create games, RSVP, and find games by sport, time, and location. |
| `sportsmanship.js` | Rate other players after a game, and read a player's score, feedback, and games played ([below](#sportsmanship-ratings)). |
| `matchmaking.js` | Suggest games whose players have a sportsmanship score close to yours ([below](#matchmaking)). |
| `notifications.js` | Notification settings (email, text, desktop; match alerts, reminders, feedback requests) and the in-app inbox ([below](#notifications)). The notifier in [`../notifier/`](../notifier/) sends the messages. |
| `firebase-messaging-sw.js` | Service worker that shows desktop notifications while the site is closed. |
| `firestore.rules` | Security rules for `events`, `feedback`, `sportsmanship`, `notificationSettings`, and `notifications` (and a minimal rule for `users`). |
| `firestore.indexes.json` | The composite indexes the searches need. |
| `firebase.json`, `.firebaserc` | Firebase CLI settings for deploying and for the local emulators. |
| `tests/` | Tests that run the modules and the rules against the emulators. |

## Using it from a page

```js
import { auth } from "../firebase/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { listEvents, rsvpToEvent, friendlyEventError } from "../firebase/events.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) return (window.location.href = "../login-and-registration/login.html");
  const games = await listEvents({ sportId: "basketball", near: { lat: 40.015, lng: -105.27, radiusKm: 10 } });
  // ...draw the games...
});

joinButton.addEventListener("click", async () => {
  try {
    await rsvpToEvent(gameId);
  } catch (err) {
    errorText.textContent = friendlyEventError(err); // e.g. "Sorry, this game is full."
  }
});
```

Wait for `onAuthStateChanged` before calling anything. Until Firebase has loaded the user, functions that need one throw `events/not-signed-in`, and the rules only let signed-in users read games.

## The `events` collection

One document per game. `events.js` writes every field, so you don't set these yourself.

| Field | Type | Notes |
| --- | --- | --- |
| `sportId` | string | One of `SPORTS`: basketball, soccer, volleyball, tennis, pickleball, football (same as the registration page). |
| `title` | string | Optional, up to 60 characters, e.g. "5v5". |
| `description` | string | Optional, up to 500 characters. |
| `skillLevel` | string | `casual` (default) or `competitive`. |
| `startTime`, `endTime` | timestamp | Must start in the future and last at most 12 hours. |
| `location` | map | `name` (park, court, or field), `address` (optional), `lat`, `lng`. |
| `playerLimit` | number | Total players including the host, 2 to 50. |
| `hostId` | string | The host's user ID (`users/{uid}`). |
| `hostName` | string | The host's display name when the game was made, so cards don't need a second read. |
| `participantIds` | array | User IDs of everyone going. The host is first. |
| `status` | string | `scheduled` or `cancelled`. |
| `createdAt` | timestamp | Set by the server. |

RSVPs are the `participantIds` array, not a subcollection. The player count is its length, so there's no separate counter to drift out of sync, and "games I joined" is one `array-contains` query. Past games aren't a status: a game is past once its `startTime` has gone by.

## Functions

Everything is exported from `events.js`.

| Function | What it does |
| --- | --- |
| `createEvent(input)` | Creates a game hosted by the signed-in user and returns its ID. `input` has the fields in the table above except the host, players, status, and `createdAt`. Times can be `Date`s or `datetime-local` input values. |
| `rsvpToEvent(id)` | RSVPs the signed-in user. Throws `events/full` when there's no room, even when several people try for the last spot at once. RSVPing twice is fine. |
| `cancelRsvp(id)` | Takes the RSVP back. The host can't leave their own game. |
| `getEvent(id)` / `watchEvent(id, onChange)` | One game, once or live. |
| `listEvents(filters)` / `watchEvents(filters, onChange)` | Upcoming scheduled games, soonest first, once or live. Filters are below. |
| `listMyEvents({ role, when })` | For "My games": `role` is `joined` (default, includes hosting) or `hosting`; `when` is `upcoming` (default) or `past`. Includes cancelled games so players see them. |
| `updateEvent(id, changes)` | Host only. Changes title, description, skill level, times, location, or player limit. |
| `cancelEvent(id)` | Host only. Marks the game cancelled. Games are never deleted. |
| `timeRange(preset)` | `{ from, to }` for `"today"`, `"tonight"`, `"weekend"`, or `"week"`. |
| `distanceKm(a, b)` | Distance between two `{ lat, lng }` points. |
| `friendlyEventError(err)` | Text to show for any error from these functions. |

The `watch...` functions return an unsubscribe function. Call it when the page or filter changes.

### Filters for `listEvents` and `watchEvents`

All optional, and they combine.

| Filter | Example | Notes |
| --- | --- | --- |
| `sportId` | `"soccer"` or `["soccer", "tennis"]` | Up to 30 sports. |
| `from`, `to` | `timeRange("weekend")` spread in, or two `Date`s | Games starting in that window. `from` defaults to now. |
| `near` | `{ lat, lng, radiusKm: 10 }` | Games within that distance. Each result gets `distanceKm`. |
| `bounds` | `{ south, west, north, east }` | Games inside a map rectangle, e.g. the map's current view. |
| `skillLevel` | `"competitive"` | |
| `openOnly` | `true` | Only games with spots left. |
| `max` | `20` | At most this many games (default 50). |

For example, competitive basketball this weekend within 5 km:

```js
await listEvents({ sportId: "basketball", skillLevel: "competitive", ...timeRange("weekend"), near: { lat, lng, radiusKm: 5 } });
```

`skillLevel`, `openOnly`, and the exact `near` distance are applied after Firestore returns up to `max` games, so you can get fewer than `max` back.

### What you get back

Each game is the document's fields plus `id`, with times as JavaScript `Date`s, and these extras:

| Field | Meaning |
| --- | --- |
| `playerCount` | People going, including the host. |
| `spotsLeft` | `playerLimit - playerCount`. |
| `isFull` | No spots left. |
| `isGoing` | The signed-in user has RSVPed (or is hosting). |
| `isHost` | The signed-in user is the host. |
| `distanceKm` | Only with the `near` filter. |

### Errors

Errors from `events.js` have a `code` you can check and a `message` that's safe to show. `friendlyEventError(err)` also covers Firestore's own errors.

| Code | When |
| --- | --- |
| `events/not-signed-in` | Nobody is logged in yet. |
| `events/not-found` | No game with that ID. |
| `events/full` | No spots left. |
| `events/cancelled`, `events/started` | The game can't be joined or changed anymore. |
| `events/not-host` | Someone other than the host tried to edit or cancel. |
| `events/host-cannot-leave` | The host tried to cancel their RSVP. |
| `events/limit-below-players` | The new player limit is lower than the number of players going. |
| `events/not-editable` | `updateEvent` was asked to change the sport, host, or players. |
| `events/invalid-sport`, `-time`, `-location`, `-player-limit`, `-details` | Bad form input. The message says what to fix. |

## Sportsmanship ratings

GitHub issue #13. After a game ends, each player can rate each of the other players once, positive or negative, with an optional comment, like feedback on eBay or Facebook Marketplace. A player's score, their feedback, and how many games they've played are public to signed-in users, for their profile.

```js
import { playersToRate, leaveFeedback, getPlayerStats, listFeedbackFor } from "../firebase/sportsmanship.js";
import { friendlyEventError } from "../firebase/events.js";

// "Rate your teammates" screen after a game
const { canRate, whyNot, players } = await playersToRate(gameId);
// players: [{ userId, displayName, rated, rating }, ...]
try {
  await leaveFeedback(gameId, players[0].userId, { rating: "positive", comment: "Great passer" });
} catch (err) {
  errorText.textContent = friendlyEventError(err); // e.g. "You've already rated this player for this game."
}

// Profile page
const stats = await getPlayerStats(userId); // { positive, negative, feedbackCount, score, gamesPlayed, ... }
const feedback = await listFeedbackFor(userId); // newest first: [{ rating, comment, fromName, sportId, createdAt, ... }]
```

### The `feedback` and `sportsmanship` collections

`sportsmanship.js` writes both, so you don't set these yourself.

`feedback/{eventId}_{fromId}_{toId}`, one document per rating:

| Field | Type | Notes |
| --- | --- | --- |
| `eventId`, `sportId` | string | The game and its sport. |
| `fromId` | string | Who left it (the signed-in user). |
| `toId` | string | The player it's about. |
| `rating` | string | `positive` or `negative` (`RATINGS`). |
| `comment` | string | Optional, up to 300 characters (`MAX_COMMENT`). |
| `createdAt` | timestamp | Set by the server. |

`sportsmanship/{uid}`, one document per rated player:

| Field | Type | Notes |
| --- | --- | --- |
| `positive`, `negative` | number | Feedback received. A player with no document has zeros. |
| `lastFeedbackId` | string | The feedback written with the latest change, so the rules can check them together. |
| `updatedAt` | timestamp | Set by the server. |

`leaveFeedback` writes the feedback and adds 1 to the player's totals in one batch. The rules check each document against the other, so the totals can only go up by exactly one real rating.

### Score

`sportsmanshipScore({ positive, negative })` gives a score from 0 to 100:

```
score = round(100 × (positive + 3) / (positive + negative + 3))
```

The 3 (`STARTING_POSITIVES`) counts as extra positive ratings, so a new player starts at 100 and one bad game doesn't sink anyone. Show the number of ratings next to the score, like eBay does, so people can tell a new player's 100 from a veteran's.

| Positive | Negative | Score |
| --- | --- | --- |
| 0 | 0 | 100 |
| 0 | 1 | 75 |
| 20 | 2 | 92 |
| 0 | 10 | 23 |

### Functions

| Function | What it does |
| --- | --- |
| `leaveFeedback(gameId, userId, { rating, comment })` | Rates another player in a finished game. Returns the feedback's ID. |
| `playersToRate(gameId)` | The other players in a game, each with `displayName` (from their profile, or `null`), `rated`, and `rating`. Also `canRate`, `whyNot` (text to show when you can't rate), `endTime`, and `deadline`. |
| `getSportsmanship(userId)` | `{ userId, positive, negative, feedbackCount, score }`. |
| `getSportsmanshipMany(userIds)` | The same for many players, as a `Map` of user ID to totals. |
| `countGamesPlayed(userId)` | Finished games the player was in that weren't cancelled. One count query. |
| `getPlayerStats(userId)` | `getSportsmanship` plus `gamesPlayed`, for the profile page. |
| `listFeedbackFor(userId, { max })` | Feedback the player has received, newest first (default 20), each with `fromName`. |
| `sportsmanshipScore({ positive, negative })` | The score formula above. |

Who can rate whom (checked by `leaveFeedback` and by the rules):

- You and the player you rate were both in the game, and you can't rate yourself.
- The game has ended, wasn't cancelled, and ended less than 14 days ago (`FEEDBACK_WINDOW_DAYS`).
- One rating per player per game. Feedback can't be changed or deleted afterwards.

### Errors

`SportsmanshipError` is a kind of `EventError`, so `friendlyEventError(err)` works for these too.

| Code | When |
| --- | --- |
| `events/not-signed-in` | Nobody is logged in yet. |
| `sportsmanship/not-found` | No game with that ID. |
| `sportsmanship/invalid-rating` | `rating` isn't `positive` or `negative`. |
| `sportsmanship/invalid-comment` | The comment is over 300 characters. |
| `sportsmanship/self` | You tried to rate yourself. |
| `sportsmanship/not-in-game` | You weren't in the game. |
| `sportsmanship/not-a-player` | The person you're rating wasn't in the game. |
| `sportsmanship/not-finished` | The game hasn't ended yet. |
| `sportsmanship/too-late` | The game ended more than 14 days ago. |
| `sportsmanship/cancelled` | The game was cancelled. |
| `sportsmanship/already-rated` | You've already rated this player for this game. |

## Matchmaking

`recommendGames(filters)` in [`matchmaking.js`](matchmaking.js) suggests upcoming games with room for you, best match first. A good match is a game whose players' average sportsmanship score is close to yours, so good sports are matched with good sports. It needs no collection of its own.

```js
import { recommendGames } from "../firebase/matchmaking.js";

const games = await recommendGames({ sportId: "soccer", near: { lat, lng, radiusKm: 10 }, minScore: 70 });
// each game: everything listEvents returns, plus averageScore, lowestScore, scoreGap
```

- It takes the same filters as `listEvents`, plus `minScore` (0 to 100): leave out games where any player's score is below it.
- It leaves out full games and games you're already in.
- It sorts by `scoreGap` (how far `averageScore` is from your score), then by start time.
- Errors: `events/not-signed-in`, `matchmaking/invalid-min-score`, and the `listEvents` ones.

It reads the players' `sportsmanship` documents, 30 at a time, so a search costs about one read per 30 players on top of the games themselves.

## Notifications

GitHub issue #17. Players choose how they hear from Pickup-Finder (email, text message, or desktop notification) and what about:

| Kind | Sent | Setting |
| --- | --- | --- |
| Match alert | When a new game fits your matchmaking settings: a sport you follow, within your distance and skill level, and every player at or above the lowest sportsmanship score you'll play with. At most 3 a day. | `matchAlerts` (off until you pick sports) |
| Game reminder | About an hour before a game you're in | `gameReminders` (on) |
| Feedback request | When a game you played ends, to rate the other players | `feedbackReminders` (on) |

[`notifications.js`](notifications.js) only saves the settings and reads the inbox. The messages themselves are sent by the **notifier** ([`../notifier/`](../notifier/)), a small Node server in Docker that checks Firestore every minute, so notifications arrive even when nobody has the site open. Every notification also lands in the player's in-app inbox, whatever channels they chose.

```js
import {
  getNotificationSettings,
  saveNotificationSettings,
  enableDesktopNotifications,
  listMyNotifications,
  markNotificationRead,
} from "../firebase/notifications.js";
import { friendlyEventError } from "../firebase/events.js";

// Settings page: change only what the form changed
try {
  await saveNotificationSettings({
    channels: { email: true, sms: true },
    phone: phoneInput.value, // "303-555-0100" is read as a US number
    matchAlerts: { sportIds: ["soccer", "basketball"], near: { lat, lng, radiusKm: 10 }, minScore: 70 },
  });
} catch (err) {
  errorText.textContent = friendlyEventError(err); // e.g. "Add a phone number to get text messages."
}

// "Turn on desktop notifications" button (must be a click, so the browser asks for permission)
desktopButton.addEventListener("click", () => enableDesktopNotifications().catch(showError));

// Inbox, newest first
const items = await listMyNotifications({ unreadOnly: true }); // [{ id, type, title, body, link, createdAt, read }, ...]
await markNotificationRead(items[0].id);
```

### The `notificationSettings`, `notifications`, and `notifier` collections

`notificationSettings/{uid}`, one per player who saved settings. **Private:** only its owner can read or change it, because it holds a phone number and push tokens.

| Field | Type | Notes |
| --- | --- | --- |
| `channels` | map | `email`, `sms`, `desktop`: true or false. All false by default. |
| `phone` | string | For texts, with its country code, like `+13035550100`. `""` for none. Texts need one. |
| `desktopTokens` | array | Push tokens for up to 5 browsers (`MAX_DESKTOP_DEVICES`). Desktop needs at least one. |
| `gameReminders`, `feedbackReminders` | boolean | On by default. |
| `matchAlerts` | map | `sportIds` (list of `SPORTS`; empty means no match alerts), `skillLevel` (`any`, `casual`, `competitive`), `near` (`{ lat, lng, radiusKm }` with 1 to 100 km, or `null` for anywhere), `minScore` (0 to 100). |
| `updatedAt` | timestamp | Set by the server. |

`notifications/{id}`, one per notification sent, written only by the notifier. A player can read their own and mark them read, nothing else. They can't be deleted, because the notifier uses them to remember what it already sent.

| Field | Type | Notes |
| --- | --- | --- |
| `uid` | string | Who it's for. |
| `type` | string | `match`, `reminder`, or `feedback`. |
| `eventId`, `sportId` | string | The game it's about. |
| `title`, `body`, `link` | string | The message, and the page it opens. |
| `createdAt` | timestamp | |
| `readAt` | timestamp | `null` until `markNotificationRead`. |
| `delivery` | map | What happened on each channel: `sent`, `logged`, `failed`, `off`, `no-address`, or `no-device`. See the [notifier README](../notifier/README.md). |

`notifier/state` is the notifier's own bookkeeping (the last game it looked at). No browser can read or write it.

### Functions

| Function | What it does |
| --- | --- |
| `getNotificationSettings()` | The signed-in user's settings, or the defaults. Also `desktopDevices` (how many browsers are set up) and `updatedAt`. |
| `saveNotificationSettings(changes)` | Changes only the fields you pass (`channels`, `phone`, `gameReminders`, `feedbackReminders`, `matchAlerts`, each partly), keeps the rest, and returns the saved settings. |
| `enableDesktopNotifications({ vapidKey })` | Asks the browser for permission, registers [`firebase-messaging-sw.js`](firebase-messaging-sw.js), and saves this browser's push token. Call it from a click. To stop desktop notifications, save `{ channels: { desktop: false } }`. |
| `saveDesktopToken(token)` | What `enableDesktopNotifications` calls to save a token. Keeps the 5 most recent browsers. |
| `listMyNotifications({ max, unreadOnly })` / `watchMyNotifications(onChange, options)` | The inbox, newest first (default 20), once or live. |
| `markNotificationRead(id)` | Marks one read. |
| `defaultNotificationSettings()` | The settings a new player has. |

**Before desktop notifications work**, someone with access to the Firebase console has to create a Web Push key (Project settings > Cloud Messaging > Web Push certificates > Generate key pair) and paste the public key into `VAPID_KEY` in `notifications.js`. It's public, so it's safe to commit. Until then `enableDesktopNotifications` throws `notifications/not-set-up`. The service worker has to be served from the same site as the pages, over HTTPS or `localhost`.

### Errors

`NotificationError` is a kind of `EventError`, so `friendlyEventError(err)` works for these too.

| Code | When |
| --- | --- |
| `events/not-signed-in` | Nobody is logged in yet. |
| `notifications/not-editable` | `saveNotificationSettings` got a field it doesn't change, such as `desktopTokens`. |
| `notifications/invalid-channel`, `-setting` | A channel or switch that isn't true or false. |
| `notifications/invalid-phone` | Not a phone number with a country code. |
| `notifications/no-phone` | Texts turned on without a phone number. |
| `notifications/no-desktop-device` | Desktop turned on before `enableDesktopNotifications` worked in any browser. |
| `notifications/invalid-sport`, `-skill`, `-area`, `-min-score` | Bad match alert settings. The message says what to fix. |
| `notifications/not-set-up` | `VAPID_KEY` hasn't been filled in yet. |
| `notifications/unsupported` | This browser can't show desktop notifications. |
| `notifications/permission-denied` | The user blocked notifications for the site. |
| `notifications/invalid-token` | The browser didn't give a push token. |
| `notifications/not-found` | `markNotificationRead` with an ID that isn't yours or doesn't exist. |

## Rules and indexes

The rules let signed-in users read games, feedback, and totals, and enforce, on Firestore's side:

- A new game is hosted by its creator, starts with only the host, starts in the future, and passes the same field checks as `events.js`.
- An RSVP adds exactly the signed-in user, once, and never past `playerLimit`. Writes to one game are applied one at a time, so two people can't both take the last spot.
- Cancelling an RSVP removes only yourself, and the host can't leave.
- Only the host edits or cancels, can't change the sport, host, or players, and can't set the limit below the players already going.
- Cancelled and started games can't be changed, and nobody can delete a game.
- Feedback can only come from the signed-in user, about another player in the same finished, non-cancelled game, within 14 days, once per player per game. It can't be edited or deleted.
- A player's `sportsmanship` totals only change together with a new feedback document about them, by exactly 1 on the matching counter, so nobody can raise their own score.
- Only you can read or change your `notificationSettings`. They must pass the same checks as `notifications.js`: texts need a valid phone number, desktop needs a browser, and match alerts need real sports, a distance from 1 to 100 km, and a score from 0 to 100.
- You can read only your own `notifications`, and the only change you can make is marking one read. Nobody can create or delete them from a browser.

**Deploying rules replaces all the rules in the project.** That's why `firestore.rules` also has a basic `users` rule (you can write only your own profile; signed-in users can read profiles). The profile team should tighten it before we deploy. To deploy the rules and indexes, from this folder:

```sh
npm install
npx firebase login
npm run deploy:firestore
```

`firestore.indexes.json` also has the indexes the notifier's searches need (games by status and end time, and notifications by player, kind, and time), so deploy before starting the notifier. Indexes take a few minutes to build after deploying. If a search fails with "The query requires an index", the browser console error has a link that creates the missing one; add it to `firestore.indexes.json` too.

## Running the tests

You need Node 20 or newer and Java 21 or newer (for the emulators). From this folder:

```sh
npm install
npm test
```

`npm test` starts the Auth and Firestore emulators with a demo project, so it never touches the real database and needs no login. It runs the real `events.js`, `sportsmanship.js`, `matchmaking.js`, and `notifications.js` (with the CDN imports swapped for the same version from npm) as several users at once, plus rules tests that try writes the app would never make on purpose. Games that already ended are put in the database directly, with the rules turned off, since the rules only allow creating games in the future.

`npm run emulators` starts the emulators on their own, with the Emulator UI at http://127.0.0.1:4000.

## Changing the data model

A new or renamed field has to change in three places, or the rules will reject every write:

1. `cleanEventFields()` (and `updateEvent`'s `editable` list if hosts can change it) in `events.js`, `leaveFeedback()` in `sportsmanship.js`, or `cleanSettings()` in `notifications.js`.
2. `eventFields()`, `validEvent()`, and `hostEditableFields()` in `firestore.rules`, `feedbackFields()`, `validShape()`, and `countsNewFeedback()` for feedback, or `settingsFields()` and `validSettings()` for notification settings. A new sport also goes in `sports()` at the top of the rules.
3. The tests, and the tables above.
