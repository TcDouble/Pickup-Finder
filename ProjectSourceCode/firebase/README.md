# Events back end (Firestore)

**Owner:** Jun

Pickup games live in the Firestore `events` collection. Pages don't talk to that collection directly: they call the functions in [`events.js`](events.js), and [`firestore.rules`](firestore.rules) makes Firestore refuse anything those functions wouldn't allow (going over the player limit, editing someone else's game, RSVPing another person).

| File | What it is |
| --- | --- |
| `firebase-config.js` | Shared Firebase setup (Paul). `events.js` uses its `db` and `auth`. |
| `events.js` | Create games, RSVP, and find games by sport, time, and location. |
| `firestore.rules` | Security rules for `events` (and a minimal rule for `users`). |
| `storage.rules` | Storage security rules: each user can upload only their own profile picture (`profilePictures/{uid}/avatar`). Tested in `../test/storage-rules.spec.js`. |
| `firestore.indexes.json` | The composite indexes the event searches need. |
| `firebase.json`, `.firebaserc` | Firebase CLI settings for deploying and for the local emulators. |
| `tests/` | Tests that run `events.js` and the rules against the emulators. |

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

## Rules and indexes

The rules let signed-in users read games and enforce, on Firestore's side:

- A new game is hosted by its creator, starts with only the host, starts in the future, and passes the same field checks as `events.js`.
- An RSVP adds exactly the signed-in user, once, and never past `playerLimit`. Writes to one game are applied one at a time, so two people can't both take the last spot.
- Cancelling an RSVP removes only yourself, and the host can't leave.
- Only the host edits or cancels, can't change the sport, host, or players, and can't set the limit below the players already going.
- Cancelled and started games can't be changed, and nobody can delete a game.

**Deploying rules replaces all the rules in the project.** That's why `firestore.rules` also has a basic `users` rule (you can write only your own profile; signed-in users can read profiles). The profile team should tighten it before we deploy. To deploy the rules and indexes, from this folder:

```sh
npm install
npx firebase login
npm run deploy:firestore
```

Indexes take a few minutes to build after deploying. If a search fails with "The query requires an index", the browser console error has a link that creates the missing one; add it to `firestore.indexes.json` too.

## Running the tests

You need Node 20 or newer and Java 21 or newer (for the emulators). From this folder:

```sh
npm install
npm test
```

`npm test` starts the Auth and Firestore emulators with a demo project, so it never touches the real database and needs no login. It runs the real `events.js` (with the CDN imports swapped for the same version from npm) as several users at once, plus rules tests that try writes the app would never make on purpose.

`npm run emulators` starts the emulators on their own, with the Emulator UI at http://127.0.0.1:4000.

## Changing the data model

A new or renamed field has to change in three places, or the rules will reject every write:

1. `cleanEventFields()` (and `updateEvent`'s `editable` list if hosts can change it) in `events.js`.
2. `eventFields()`, `validEvent()`, and `hostEditableFields()` in `firestore.rules`.
3. The tests, and the table above.
