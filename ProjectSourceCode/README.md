# Pickup-Finder Database

**Owner:** Jun
**Back end:** Firebase (Authentication and Cloud Firestore)
**Status:** The `events` collection, its security rules, and its tests are built ([`firebase/`](firebase/)). The rules and indexes haven't been deployed to the live project yet.

**Extra credit:** the [Risks](#risks) section at the end of this file is our submission for extra credit.

## Contents

- [Overview](#overview)
- [Folder layout](#folder-layout)
- [Collections](#collections)
- [Working with the database](#working-with-the-database)
- [How Firebase covers the requirements](#how-firebase-covers-the-requirements)
- [Conventions](#conventions)
- [Risks](#risks)

## Overview

Pickup-Finder lets people post and join local pickup games. We use Firebase as the back end, and the pages talk to it directly, so there's no server of our own:

- **Firebase Authentication** handles accounts, passwords, and staying logged in.
- **Cloud Firestore** stores profiles (`users`) and games (`events`), including who has RSVPed.
- **Security rules** ([`firebase/firestore.rules`](firebase/firestore.rules)) decide who can read and change what. Anyone can call Firestore from their browser, so the rules are what actually protect the data.

Every page loads the Firebase JavaScript SDK (version 10.12.2) from Google's CDN and gets `app`, `auth`, and `db` from [`firebase/firebase-config.js`](firebase/firebase-config.js). Pages that deal with games use the functions in [`firebase/events.js`](firebase/events.js) instead of calling Firestore themselves.

## Folder layout

```text
ProjectSourceCode/
├── README.md                    # this file
├── firebase/
│   ├── firebase-config.js       # shared setup: exports app, auth, db
│   ├── events.js                # games: create, RSVP, search
│   ├── firestore.rules          # security rules for every collection
│   ├── firestore.indexes.json   # indexes the game searches need
│   ├── firebase.json            # Firebase CLI and emulator settings
│   ├── package.json             # dev tools for tests and deploying
│   ├── tests/                   # emulator tests for events.js and the rules
│   └── README.md                # how the front end uses events.js
├── login-and-registration/      # login, registration, and home pages
└── Prototyping/                 # wireframe and find-game prototype
```

## Collections

### `users/{uid}`

One profile per account, keyed by the user's Firebase Auth ID. The registration page ([`login-and-registration/registration.js`](login-and-registration/registration.js)) creates it. Paul and Julian own this collection.

| Field | Type | Notes |
| --- | --- | --- |
| `displayName` | string | Also saved on the Auth account. |
| `email` | string | |
| `city` | string | |
| `sports` | array | Sport IDs, such as `basketball`. Same list as `SPORTS` in `events.js`. |
| `createdAt` | timestamp | Set by the server. |

Passwords are never stored in Firestore. Firebase Authentication keeps them.

Rules for now: signed-in users can read any profile, and you can only create or change your own.

### `events/{eventId}`

One document per game. The players who RSVPed are in its `participantIds` array, with the host first, so the player count is just the array's length.

| Field | Type | Notes |
| --- | --- | --- |
| `sportId` | string | One of `SPORTS` in `events.js`. |
| `title`, `description` | string | Optional. |
| `skillLevel` | string | `casual` or `competitive`. |
| `startTime`, `endTime` | timestamp | |
| `location` | map | `name`, `address`, `lat`, `lng`. |
| `playerLimit` | number | Including the host, 2 to 50. |
| `hostId`, `hostName` | string | |
| `participantIds` | array | User IDs of everyone going. |
| `status` | string | `scheduled` or `cancelled`. |
| `createdAt` | timestamp | |

The full rules for each field, the functions for creating games, RSVPing, and searching by sport, time, and location, and the error codes are in [`firebase/README.md`](firebase/README.md).

## Working with the database

You need Node 20 or newer, and Java 21 or newer for the local emulators. Run these from `ProjectSourceCode/firebase/`:

| Command | What it does |
| --- | --- |
| `npm install` | Installs the Firebase CLI and test tools. Run it once. |
| `npm test` | Runs every test against local emulators. It never touches the live database and doesn't need a login. |
| `npm run emulators` | Starts the local Auth and Firestore emulators, with the Emulator UI at http://127.0.0.1:4000. |
| `npx firebase login`, then `npm run deploy:firestore` | Deploys the rules and indexes to the live project (`sport-pick-up-app-team-4`). You need access to the project in the Firebase console. |

**Deploying the rules replaces all the rules in the project.** Any collection that isn't in `firestore.rules` becomes unreadable, so add a rule for each new collection before deploying, and run `npm test` first.

## How Firebase covers the requirements

These are the requirements from [`requirement.txt`](../MilestoneSubmissions/requirement.txt).

| Requirement | How it's covered | Status |
| --- | --- | --- |
| Login and registration pages | Firebase Authentication with email and password ([`login-and-registration/`](login-and-registration/)) | Built |
| Database with user info | `users` collection | Built |
| Passwords hashed before storage | Firebase Authentication hashes passwords (with scrypt) and never gives them back. We never store a password ourselves. | Built |
| Sessions: login, logout, stay logged in | Firebase Authentication keeps the user signed in across page loads and refreshes their login token. `signOut` logs out. | Built |
| A server connecting UI to Database | Firebase plays this role: the SDK talks to Firestore, and the security rules enforce what a server would. We don't run a server of our own. | Check with the TA ([Risk 1](#1-firebase-might-not-meet-the-server-and-docker-requirements)) |
| Built and run in Docker containers | Not covered yet | Open ([Risk 1](#1-firebase-might-not-meet-the-server-and-docker-requirements)) |
| Database with event info | `events` collection | Built |
| Map integration | Each game stores `lat` and `lng`, and `listEvents` finds games inside the map's view or within a distance | Built |
| Real-time updates | `watchEvents` and `watchEvent` update the page as soon as a game changes | Built |
| Media storage for profile and event images | Would use Cloud Storage, with the image URL saved on the profile or game | Not started |
| Notifications | Not designed yet | Not started |
| Removing past events and enforcing other rules | The security rules enforce the player limit and host-only edits. Searches only return games that haven't started, so past games drop off the map. Nothing deletes old games yet. | Partly built |
| User info only editable by its owner | The `users` rule only lets you write your own profile | Built |

## Conventions

- **Field names** are `camelCase` (`hostId`, `startTime`), like the rest of our JavaScript.
- **Document IDs:** a profile's ID is its user's Auth ID. Games get random IDs from Firestore.
- **Times** are Firestore timestamps, which are stored in UTC. Pass JavaScript `Date`s in, and convert to local time only when showing them.
- **Fixed lists** (sports and skill levels) are in both `events.js` and `firestore.rules`. Change both, or the rules will reject the new value.
- **Changing a field** means changing `events.js`, `firestore.rules`, the tests, and the tables in this file and in `firebase/README.md`. See "Changing the data model" in [`firebase/README.md`](firebase/README.md).
- **Security:** anything that matters is checked in the rules, not only in the page. A user's ID always comes from `auth.currentUser`, never from a form field or the URL.
- **Secrets:** the `apiKey` in `firebase-config.js` only identifies our project and is safe to commit. Never commit a service account key or any other credential file.

## Risks

> **Note:** This section is our submission for extra credit.

These are the risks we see for the database part of Pickup-Finder, updated on November 3, 2026, after the team chose Firebase. Severity is how much damage a risk would do if it happened:

- **High:** we could miss a course requirement, expose users' data, or block the rest of the team.
- **Medium:** it costs days of rework or breaks a feature, but there's a workaround.
- **Low:** it's an annoying bug that's quick to fix.

| # | Risk | Severity | Status |
| --- | --- | --- | --- |
| 1 | [Firebase might not meet the server and Docker requirements](#1-firebase-might-not-meet-the-server-and-docker-requirements) | High | Open |
| 2 | [Users' data gets exposed or changed by the wrong person](#2-users-data-gets-exposed-or-changed-by-the-wrong-person) | High | Partly handled |
| 3 | [The data model doesn't match the wireframe or the pages](#3-the-data-model-doesnt-match-the-wireframe-or-the-pages) | Medium | Open |
| 4 | [Everyone shares one live database](#4-everyone-shares-one-live-database) | Medium | Partly handled |
| 5 | [Searches fail on the live project because an index is missing](#5-searches-fail-on-the-live-project-because-an-index-is-missing) | Medium | Partly handled |
| 6 | [Optional features crowd out the required ones](#6-optional-features-crowd-out-the-required-ones) | Medium | Open |
| 7 | [Only one person knows how the database works](#7-only-one-person-knows-how-the-database-works) | Medium | Partly handled |
| 8 | [Two players take the last spot in a game](#8-two-players-take-the-last-spot-in-a-game) | Medium | Handled |
| 9 | [Dates and times come out wrong](#9-dates-and-times-come-out-wrong) | Low | Partly handled |

### 1. Firebase might not meet the server and Docker requirements

**Severity: High · Status: Open**

The course requirements include "a server connecting UI to Database" and "built and run in docker containers". With Firebase, the pages talk to Firestore directly and we don't run a server or any containers. If the graders read these requirements literally, we could lose points late in the project, when it's hardest to add a server.

Mitigation:

- Ask the TA at the next weekly meeting whether Firebase counts as the server and database, and write the answer in the meeting minutes.
- If it doesn't count, the smallest fix is a small Node/Express server in a Docker container that serves the pages in `ProjectSourceCode/`, plus a `docker-compose.yml` that starts it. The pages and Firestore code stay the same.
- The Firebase emulators can also run in a container for local development, which would cover Docker for the database side.

### 2. Users' data gets exposed or changed by the wrong person

**Severity: High · Status: Partly handled**

Anyone can open the browser console and call Firestore with their own login, so the page's checks don't protect anything. Only the security rules do. If the live project is still on the console's "test mode" rules, anyone can read or overwrite every profile and game, and test mode also expires after 30 days, after which every read fails. Under our current `users` rule, any signed-in user can read every profile, including email addresses.

Mitigation:

- Deploy `firestore.rules` to replace test mode, as described in [Working with the database](#working-with-the-database).
- The rules tests in `firebase/tests/rules.test.js` try the attacks directly: editing someone else's game, RSVPing another person, going over the player limit, and writing someone else's profile. Run `npm test` before every deploy.
- Have the profile team tighten the `users` rule, for example by keeping email in a private document only its owner can read, and by checking each field's type and length.
- Never commit a service account key. If one is ever committed, delete the key in the Google Cloud console, because removing the file doesn't remove it from git history.

### 3. The data model doesn't match the wireframe or the pages

**Severity: Medium · Status: Open**

The wireframe ([`Prototyping/wireframe.html`](Prototyping/wireframe.html)) shows things the data model doesn't have yet: a waitlist ("#2 in line"), messages from the host, a show-up rate, a neighborhood, and a skill level for each sport on profiles. If the front end builds those screens first, they'll have nowhere to save the data, or teammates will add fields the rules reject.

Mitigation:

- Treat the tables in this file and in `firebase/README.md` as the agreement between the pages and the database. Go through the wireframe with the front-end teammates and decide which of these to build and which to cut.
- Add fields the way [Conventions](#conventions) describes, with a test, through a pull request.

### 4. Everyone shares one live database

**Severity: Medium · Status: Partly handled**

We all use the same Firebase project, so test games, half-finished pages, and a bad rules deploy affect everyone at once, including the data we'd demo from. The free Spark plan also has daily limits (50,000 document reads and 20,000 writes). A page that re-reads every game in a loop could use those up and break the app until the next day.

Mitigation:

- Develop and test against the emulators (`npm run emulators`, `npm test`), which use a separate demo project and never touch the live data.
- Only deploy rules from `main`, after the tests pass.
- Use `watchEvents` for live lists instead of reloading on a timer, and keep its `max` reasonable. Check usage in the Firebase console during the week before the demo.
- Before the demo, write a small script that creates the demo games, so they can be recreated if they're deleted or changed.

### 5. Searches fail on the live project because an index is missing

**Severity: Medium · Status: Partly handled**

Searches that combine sport, time, and location need composite indexes. The emulators don't check indexes, so a search can pass every test and still fail on the live project with "The query requires an index".

Mitigation:

- `firestore.indexes.json` lists an index for every search in `events.js`, and `npm run deploy:firestore` deploys them along with the rules. They take a few minutes to build.
- Try each search on the live project once after the first deploy. If one fails, the browser console error has a link that creates the missing index. Add it to `firestore.indexes.json` too, so the next deploy keeps it.

### 6. Optional features crowd out the required ones

**Severity: Medium · Status: Open**

On top of the class requirements, our scope adds real-time updates, notifications, and image uploads, and we've talked about a friends list, skill ratings, matchmaking, and a waitlist. Each one adds fields, rules, and tests. If we start them early, the required features (login, registration, and creating and joining games) might not be solid by the checkpoint.

Mitigation:

- Finish and test the required features first. Login, registration, and games are built now. The pages that use them come next.
- Agree on a cut list ahead of time. If we're behind a week before a deadline, cut matchmaking first, then ratings, then the friends list.

### 7. Only one person knows how the database works

**Severity: Medium · Status: Partly handled**

Jun owns the database. If Jun is sick, busy with other classes, or our schedules don't line up, the rest of the team can't change the rules or fix a search on their own. Documents have also been edited directly on `main`, so two people's versions can overwrite each other.

Mitigation:

- This README and [`firebase/README.md`](firebase/README.md) explain the data, the functions, and how to test and deploy, so any teammate can do it.
- `npm test` needs no setup beyond `npm install` and Java, so anyone can check a change.
- Make changes to `firebase/` through pull requests with at least one reviewer, instead of editing `main` directly.

### 8. Two players take the last spot in a game

**Severity: Medium · Status: Handled**

If two people join a game with one spot left at the same moment, both could see an open spot and both get added. It's easy to miss, because it never happens when one person tests alone.

Mitigation:

- `rsvpToEvent` joins inside a Firestore transaction, so if the game changes while you're joining, it reads the game again and sees that it's full.
- The security rules also refuse any RSVP that would go over `playerLimit`, and Firestore applies writes to one game one at a time. So even a request that skips `events.js` can't overfill a game.
- A test has four people try for the last two spots at once, and checks that exactly two get in. A waitlist, if we add one, would need the same kind of test.

### 9. Dates and times come out wrong

**Severity: Low · Status: Partly handled**

Games could show the wrong start time if a time is converted twice or read in the wrong time zone. The time filters (today, tonight, this weekend) use the viewer's time zone, which is what we want for people in the same city but could surprise a tester whose computer is set to another time zone.

Mitigation:

- Times are stored as Firestore timestamps (UTC), and `events.js` hands the page JavaScript `Date`s. Format them with `toLocaleString()` or similar, only when showing them.
- `createEvent` reads `datetime-local` input values as local time, so pass the input's value straight through without converting it yourself.
- The tests use times relative to now, so they don't break as the calendar moves on.
