# Pickup-Finder Database

**Owner:** Jun
**Back end:** Firebase (Authentication and Cloud Firestore)
**Status:** The `events` collection, sportsmanship ratings and matchmaking (GitHub issue #13), notification settings (issue #17), their security rules, and their tests are built ([`firebase/`](firebase/)), and so is the notifier server that sends the notifications ([`notifier/`](notifier/)). The rules and indexes haven't been deployed to the live project yet, and the notifier hasn't run against it.

**Extra credit:** the [Risks](#risks) section at the end of this file is our submission for extra credit.

## Contents

- [Overview](#overview)
- [Folder layout](#folder-layout)
- [Collections](#collections)
- [Working with the database](#working-with-the-database)
- [How Firebase covers the requirements](#how-firebase-covers-the-requirements)
- [Conventions](#conventions)
- [Optional features](#optional-features)
- [Risks](#risks)

## Overview

Pickup-Finder lets people post and join local pickup games. We use Firebase as the back end, and the pages talk to it directly:

- **Firebase Authentication** handles accounts, passwords, and staying logged in.
- **Cloud Firestore** stores profiles (`users`), games (`events`, including who has RSVPed), the feedback players leave each other after a game (`feedback` and `sportsmanship`), and notification settings and the notifications we've sent (`notificationSettings` and `notifications`).
- **Security rules** ([`firebase/firestore.rules`](firebase/firestore.rules)) decide who can read and change what. Anyone can call Firestore from their browser, so the rules are what actually protect the data.
- **The notifier** ([`notifier/`](notifier/)) is the one server we run: a small Node.js program in a Docker container that watches Firestore and sends match alerts, game reminders, and feedback requests by email, text message, and desktop notification, so players get them even when the site is closed.

Every page loads the Firebase JavaScript SDK (version 10.12.2) from Google's CDN and gets `app`, `auth`, and `db` from [`firebase/firebase-config.js`](firebase/firebase-config.js). Pages that deal with games use the functions in [`firebase/events.js`](firebase/events.js), pages that deal with ratings use [`firebase/sportsmanship.js`](firebase/sportsmanship.js) and [`firebase/matchmaking.js`](firebase/matchmaking.js), and notification settings use [`firebase/notifications.js`](firebase/notifications.js), instead of calling Firestore themselves.

## Folder layout

```text
ProjectSourceCode/
├── README.md                    # this file
├── assets/
│   ├── style.css                # global styles every page links (CU gold, black, grays)
│   └── no-profile-picture-icon.* # default profile picture
├── create-game/                 # host-a-game page
├── firebase/
│   ├── firebase-config.js       # shared setup: exports app, auth, db, storage
│   ├── storage.rules            # security rules for profile pictures
│   ├── events.js                # games: create, RSVP, search
│   ├── sportsmanship.js         # rating other players after a game
│   ├── matchmaking.js           # suggesting games by sportsmanship score
│   ├── notifications.js         # notification settings and the inbox
│   ├── firebase-messaging-sw.js # shows desktop notifications while the site is closed
│   ├── firestore.rules          # security rules for every collection
│   ├── firestore.indexes.json   # indexes the game searches need
│   ├── firebase.json            # Firebase CLI and emulator settings
│   ├── package.json             # dev tools for tests and deploying
│   ├── tests/                   # emulator tests for the modules and the rules
│   └── README.md                # how the front end uses these modules
├── notifier/                    # server that sends notifications (Node, Docker)
│   ├── src/                     # the notifier itself
│   ├── test/                    # its tests, on the emulators
│   ├── Dockerfile, docker-compose.yaml
│   ├── .env.example             # its settings: email and text accounts
│   └── README.md                # how to set it up and run it
├── login-and-registration/      # login, registration, and home pages
└── Prototyping/                 # wireframe and find-game prototype
```

## Collections

### `users/{uid}`

One profile per account, keyed by the user's Firebase Auth ID. The registration page ([`login-and-registration/registration.js`](login-and-registration/registration.js)) creates it. Paul and Julian own this collection.

Any signed-in player can read any profile (to show names next to games), so don't put private data here. The email address stays in Firebase Authentication only.

| Field | Type | Notes |
| --- | --- | --- |
| `displayName` | string | Also saved on the Auth account. |
| `photoURL` | string or null | Download URL of the picture in Storage at `profilePictures/{uid}/avatar`, also saved on the Auth account. `null` means no picture: pages show [`assets/no-profile-picture-icon.svg`](assets/no-profile-picture-icon.svg) (`DEFAULT_PHOTO` in `auth-helpers.js`). |
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

### `feedback/{eventId}_{fromId}_{toId}`

Sportsmanship feedback, like on eBay or Facebook Marketplace: after a game ends, each player can rate each of the other players once, positive or negative, with an optional comment. The document ID is the game, the rater, and the player being rated, joined with `_`, so the same person can't rate the same player twice for one game.

| Field | Type | Notes |
| --- | --- | --- |
| `eventId`, `sportId` | string | The game, and its sport. |
| `fromId` | string | Who left the feedback. Always the signed-in user. |
| `toId` | string | The player it's about. |
| `rating` | string | `positive` or `negative`. |
| `comment` | string | Optional, up to 300 characters. |
| `createdAt` | timestamp | |

Rules: you can rate another player only if you both played in the game, the game wasn't cancelled, and it ended within the last 14 days. Feedback can't be edited or deleted by anyone, including the person it's about. Signed-in users can read all of it, so it shows on profiles.

### `sportsmanship/{uid}`

Each player's running totals, created by their first feedback. Nobody writes this directly: `leaveFeedback` updates it in the same batch as the feedback.

| Field | Type | Notes |
| --- | --- | --- |
| `positive`, `negative` | number | How many of each the player has received. |
| `lastFeedbackId` | string | The feedback written along with the latest change. The rules use it to check the two documents together. |
| `updatedAt` | timestamp | |

The rules only allow adding exactly 1 to the counter that matches a feedback document created in the same write, so the totals always equal the number of feedback documents and nobody can raise their own. The public **sportsmanship score** (0 to 100) is computed from the totals, and **games played** is counted from `events`. Both are explained in [`firebase/README.md`](firebase/README.md).

### `notificationSettings/{uid}`

How and when each player wants to hear from us (GitHub issue #17), saved by `saveNotificationSettings` in [`firebase/notifications.js`](firebase/notifications.js). Players who never saved any get the defaults: reminders and feedback requests in the in-app inbox only.

| Field | Type | Notes |
| --- | --- | --- |
| `channels` | map | `email`, `sms`, `desktop`: true or false, all false at first. |
| `phone` | string | For text messages, with country code. |
| `desktopTokens` | array | Push tokens for up to 5 browsers. |
| `gameReminders`, `feedbackReminders` | boolean | An hour before each game, and after each game to rate the players. On at first. |
| `matchAlerts` | map | Sports, area, skill level, and lowest sportsmanship score for new-game alerts. No sports means no alerts. |
| `updatedAt` | timestamp | |

Rules: **private**. Only the player can read or change their settings, and they must pass the same checks as `notifications.js` (texts need a phone number, desktop needs a browser that was set up).

### `notifications/{id}`

Every notification the notifier has sent, which is also each player's in-app inbox: who it's for (`uid`), the kind (`match`, `reminder`, or `feedback`), the game, the message and link, when it was sent and read, and what happened on each channel. The ID says what it's about (for example `reminder_<game>_<player>_<start time>`), so the same notification can't be sent twice.

Rules: you can read only your own and mark them read. Only the notifier writes them, and nobody can delete them. The notifier's own bookkeeping is in `notifier/state`, which no browser can read. Details for both collections are in [`firebase/README.md`](firebase/README.md#notifications).

## Working with the database

You need Node 20 or newer, and Java 21 or newer for the local emulators. Run these from `ProjectSourceCode/firebase/`:

| Command | What it does |
| --- | --- |
| `npm install` | Installs the Firebase CLI and test tools. Run it once. |
| `npm test` | Runs every test against local emulators. It never touches the live database and doesn't need a login. |
| `npm run emulators` | Starts the local Auth and Firestore emulators, with the Emulator UI at http://127.0.0.1:4000. |
| `npx firebase login`, then `npm run deploy:firestore` | Deploys the rules and indexes to the live project (`sport-pick-up-app-team-4`). You need access to the project in the Firebase console. |

**Deploying the rules replaces all the rules in the project.** Any collection that isn't in `firestore.rules` becomes unreadable, so add a rule for each new collection before deploying, and run `npm test` first.

The notifier has its own `npm test` and its own setup (a service account key and the email and text accounts). See [`notifier/README.md`](notifier/README.md).

## How Firebase covers the requirements

These are the requirements from [`requirement.txt`](../MilestoneSubmissions/requirement.txt).

| Requirement | How it's covered | Status |
| --- | --- | --- |
| Login and registration pages | Firebase Authentication with email and password ([`login-and-registration/`](login-and-registration/)) | Built |
| Database with user info | `users` collection | Built |
| Passwords hashed before storage | Firebase Authentication hashes passwords (with scrypt) and never gives them back. We never store a password ourselves. | Built |
| Sessions: login, logout, stay logged in | Firebase Authentication keeps the user signed in across page loads and refreshes their login token. `signOut` logs out. | Built |
| A server connecting UI to Database | Firebase plays this role: the SDK talks to Firestore, and the security rules enforce what a server would. The notifier ([`notifier/`](notifier/)) is a Node.js server of our own that connects the database to email, text messages, and desktop notifications, but the pages still don't go through it. | Partly built ([Risk 1](#1-firebase-might-not-meet-the-server-and-docker-requirements)) |
| Built and run in Docker containers | The notifier runs in a Docker container ([`notifier/docker-compose.yaml`](notifier/docker-compose.yaml)), and the tests run in containers ([`docker-compose.test.yaml`](docker-compose.test.yaml)). The pages aren't served from a container yet. | Partly built ([Risk 1](#1-firebase-might-not-meet-the-server-and-docker-requirements)) |
| Database with event info | `events` collection | Built |
| Map integration | Each game stores `lat` and `lng`, and `listEvents` finds games inside the map's view or within a distance | Built |
| Real-time updates | `watchEvents` and `watchEvent` update the page as soon as a game changes | Built |
| Media storage for profile and event images | Profile pictures upload to Cloud Storage at registration, and the URL is saved on the profile. [`firebase/storage.rules`](firebase/storage.rules) lets only the owner write their picture (PNG, JPEG, WebP or GIF, up to 2 MB). Event images aren't done. | Partly built |
| Notifications | Match alerts, a reminder an hour before each game, and a request to rate the players after it, by email, text message, or desktop notification, whichever the player chooses ([`firebase/notifications.js`](firebase/notifications.js) and [`notifier/`](notifier/), GitHub issue #17). No settings page or inbox page yet. | Built (back end) |
| Removing past events and enforcing other rules | The security rules enforce the player limit and host-only edits. Searches only return games that haven't started, so past games drop off the map. Nothing deletes old games yet. | Partly built |
| User info only editable by its owner | The `users` rule only lets you write your own profile | Built |

## Conventions

- **Field names** are `camelCase` (`hostId`, `startTime`), like the rest of our JavaScript.
- **Document IDs:** a profile's ID is its user's Auth ID. Games get random IDs from Firestore.
- **Times** are Firestore timestamps, which are stored in UTC. Pass JavaScript `Date`s in, and convert to local time only when showing them.
- **Fixed lists** (sports and skill levels) are in both `events.js` and `firestore.rules`. Change both, or the rules will reject the new value.
- **Changing a field** means changing `events.js`, `firestore.rules`, the tests, and the tables in this file and in `firebase/README.md`. See "Changing the data model" in [`firebase/README.md`](firebase/README.md).
- **Security:** anything that matters is checked in the rules, not only in the page. A user's ID always comes from `auth.currentUser`, never from a form field or the URL.
- **Secrets:** the `apiKey` in `firebase-config.js` and `VAPID_KEY` in `notifications.js` are public and safe to commit. Never commit a service account key or any other credential file, including the notifier's `service-account.json` and `.env` (both are in its `.gitignore`).

## Optional features

These are stretch goals from the original database plan, redesigned for Firestore. Matchmaking by sportsmanship (GitHub issue #13) is built: see [Sportsmanship and matchmaking](#sportsmanship-and-matchmaking-built) below. The friends list and skill ratings are still designs. Start them only after the required pages work. If we fall behind, cut skill ratings first, then the friends list, as [Risk 6](#6-optional-features-crowd-out-the-required-ones) says.

Each one adds a collection or fields, so it also needs rules, tests, and updates to the tables in this file, as [Conventions](#conventions) describes.

### Friends list

A new `friendships/{pairId}` collection holds one document per pair of users. The document ID is the two user IDs, sorted and joined with `_`. Firestore has no unique constraints, so this ID is what stops two people from having more than one document, whichever of them sent the request.

| Field | Type | Notes |
| --- | --- | --- |
| `userIds` | array | Both user IDs, sorted. Used to look up a user's friends. |
| `requesterId` | string | Who sent the request. |
| `addresseeId` | string | Who received it. |
| `status` | string | `pending` or `accepted`. |
| `createdAt` | timestamp | |
| `acceptedAt` | timestamp | Set when the request is accepted. |

Rules:

- Only the requester can create the document, only with `status` set to `pending`, and only when its ID matches the two sorted user IDs. Nobody can friend themselves.
- Only the addressee can change it, and only from `pending` to `accepted`.
- Either person can delete it, which covers declining, cancelling, and unfriending.
- Only the two people in it can read it.

Queries:

- **My friends:** `userIds` array-contains my ID, and `status == 'accepted'`. This needs a composite index in `firestore.indexes.json`.
- **Requests waiting for me:** `addresseeId ==` my ID, and `status == 'pending'`.
- **Games my friends are going to:** upcoming events where `participantIds` array-contains-any of my friends' IDs. Firestore allows up to 30 IDs in one query, so split longer friend lists into batches.

If A sends B a request while B's request to A is still pending, the document already exists. The page should accept B's request instead of creating a new one.

### Skill ratings (ELO)

Each user gets one rating per sport, since being good at basketball says nothing about tennis. Everyone starts at 1000.

| Where | Field | Notes |
| --- | --- | --- |
| `users/{uid}` | `ratings` | Map of sport ID to `{ rating, gamesRated }`. A sport that isn't in the map counts as 1000. |
| `users/{uid}/ratingHistory/{eventId}` | `sportId`, `ratingBefore`, `ratingAfter`, `ratedAt` | One document per rated game. Because the game's ID is the document ID, a game can only be rated once per player. |
| `events/{eventId}` | `teams` | Map of user ID to `1` or `2`, set when teams are picked. |
| `events/{eventId}` | `result` | `team1`, `team2`, or `tie`, recorded by the host after the game ends. |

When the result is recorded, every player's rating changes at once:

1. Average each team's ratings to get `R1` and `R2`.
2. Team 1's expected score is `E1 = 1 / (1 + 10^((R2 - R1) / 400))`.
3. Team 1's actual score `S1` is 1 for a win, 0.5 for a tie, and 0 for a loss.
4. Every team 1 player gains `32 × (S1 − E1)`, rounded, and every team 2 player gains the negative of that.

For example, a team averaging 1100 that beats a team averaging 1050 has `E1 = 0.57`, so each winner gains 14 points and each loser drops 14.

**The catch:** this update changes other people's profiles, and security rules can't check the math. If the browser did it, any player could give themselves any rating from the console. So the rules should never let a browser write `ratings` or `ratingHistory`, not even on your own profile, and the update has to run in code we trust. There are two options:

- **A Cloud Function** that runs when a game's `result` is set. Cloud Functions need the Blaze plan, which means adding a billing card to the project, though our usage would stay within the free tier.
- **The small Node/Express server** from [Risk 1](#1-firebase-might-not-meet-the-server-and-docker-requirements), using the Firebase Admin SDK. If the TA says we need a server anyway, this gives it a real job.

The Admin SDK and Cloud Functions both skip the security rules, so either one can write ratings while browsers can't.

### Sportsmanship and matchmaking (built)

GitHub issue #13 asks for sportsmanship ratings rather than skill ratings: players rate each other after a match, the rating and the positive and negative feedback are public like on eBay, profiles show games played, and players are matched by sportsmanship. It's built in [`firebase/sportsmanship.js`](firebase/sportsmanship.js) and [`firebase/matchmaking.js`](firebase/matchmaking.js), with the [`feedback`](#feedbackeventid_fromid_toid) and [`sportsmanship`](#sportsmanshipuid) collections above.

Unlike the skill ratings above, this needs no Cloud Function or server. Each rating only adds 1 to a counter, and the security rules can check that (with `getAfter()`, which sees the feedback and the totals as they'll be after the write). Skill ratings change by an amount that depends on everyone's ratings, which the rules can't check.

- **Score:** `100 × (positive + 3) / (positive + negative + 3)`, rounded. The 3 extra positive ratings mean a new player starts at 100 and one bad game doesn't sink anyone: one negative gives 75, and 20 positive with 2 negative gives 92.
- **Matchmaking:** `recommendGames` takes the same filters as `listEvents`, reads the players' totals (one read per 30 players), and sorts open games by how close the players' average score is to yours, then by start time. So good sports get games with other good sports first. `minScore` hides games where any player is below a score you pick.
- **Games played** counts finished games the player was in that weren't cancelled, with one Firestore count query.

If we build skill ratings later, the same "average close to mine" sort works for them, and the host could split teams by skill in a snake draft (sort by rating, then assign 1, 2, 2, 1, 1, 2, and so on, and save the result to `teams`).

## Risks

> **Note:** This section is our submission for extra credit.

These are the risks we see for the database part of Pickup-Finder, first written on November 3, 2026, after the team chose Firebase, and updated on November 8, 2026, when sportsmanship ratings were added, and on November 10, 2026, when notifications were added. Severity is how much damage a risk would do if it happened:

- **High:** we could miss a course requirement, expose users' data, or block the rest of the team.
- **Medium:** it costs days of rework or breaks a feature, but there's a workaround.
- **Low:** it's an annoying bug that's quick to fix.

| # | Risk | Severity | Status |
| --- | --- | --- | --- |
| 1 | [Firebase might not meet the server and Docker requirements](#1-firebase-might-not-meet-the-server-and-docker-requirements) | High | Partly handled |
| 2 | [Users' data gets exposed or changed by the wrong person](#2-users-data-gets-exposed-or-changed-by-the-wrong-person) | High | Partly handled |
| 3 | [The data model doesn't match the wireframe or the pages](#3-the-data-model-doesnt-match-the-wireframe-or-the-pages) | Medium | Open |
| 4 | [Everyone shares one live database](#4-everyone-shares-one-live-database) | Medium | Partly handled |
| 5 | [Searches fail on the live project because an index is missing](#5-searches-fail-on-the-live-project-because-an-index-is-missing) | Medium | Partly handled |
| 6 | [Optional features crowd out the required ones](#6-optional-features-crowd-out-the-required-ones) | Medium | Open |
| 7 | [Only one person knows how the database works](#7-only-one-person-knows-how-the-database-works) | Medium | Partly handled |
| 8 | [Two players take the last spot in a game](#8-two-players-take-the-last-spot-in-a-game) | Medium | Handled |
| 9 | [Dates and times come out wrong](#9-dates-and-times-come-out-wrong) | Low | Partly handled |
| 10 | [Sportsmanship ratings get gamed or misused](#10-sportsmanship-ratings-get-gamed-or-misused) | Medium | Partly handled |
| 11 | [Notifications spam people, cost money, or leak phone numbers](#11-notifications-spam-people-cost-money-or-leak-phone-numbers) | Medium | Partly handled |

### 1. Firebase might not meet the server and Docker requirements

**Severity: High · Status: Partly handled**

The course requirements include "a server connecting UI to Database" and "built and run in docker containers". With Firebase, the pages talk to Firestore directly. If the graders read these requirements literally, we could lose points late in the project, when it's hardest to add a server.

Mitigation:

- Since November 10, 2026, the notifier ([`notifier/`](notifier/)) is a Node.js server of ours that runs in a Docker container and connects the database to email, text messages, and desktop notifications. The tests also run in containers ([`docker-compose.test.yaml`](docker-compose.test.yaml)). That covers part of both requirements, but the pages still don't go through a server and aren't served from a container.
- Ask the TA at the next weekly meeting whether Firebase plus the notifier counts as the server and database, and write the answer in the meeting minutes.
- If it doesn't count, the smallest fix is a small Node/Express server in a Docker container that serves the pages in `ProjectSourceCode/`, plus a `docker-compose.yml` that starts it. The pages and Firestore code stay the same.
- The Firebase emulators can also run in a container for local development, which would cover Docker for the database side.

### 2. Users' data gets exposed or changed by the wrong person

**Severity: High · Status: Partly handled**

Anyone can open the browser console and call Firestore with their own login, so the page's checks don't protect anything. Only the security rules do. If the live project is still on the console's "test mode" rules, anyone can read or overwrite every profile and game, and test mode also expires after 30 days, after which every read fails. Under our current `users` rule, any signed-in user can read every profile, so profiles no longer store email addresses (they stay in Firebase Authentication).

Mitigation:

- Deploy `firestore.rules` to replace test mode, as described in [Working with the database](#working-with-the-database).
- The rules tests in `firebase/tests/rules.test.js` try the attacks directly: editing someone else's game, RSVPing another person, going over the player limit, and writing someone else's profile. Run `npm test` before every deploy.
- Have the profile team tighten the `users` rule by checking each field's type and length.
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

- `firestore.indexes.json` lists an index for every search in `events.js` and `sportsmanship.js`, and `npm run deploy:firestore` deploys them along with the rules. They take a few minutes to build.
- Try each search on the live project once after the first deploy. If one fails, the browser console error has a link that creates the missing index. Add it to `firestore.indexes.json` too, so the next deploy keeps it.

### 6. Optional features crowd out the required ones

**Severity: Medium · Status: Open**

On top of the class requirements, our scope adds real-time updates, notifications, and image uploads, and we've talked about a friends list, skill ratings, and a waitlist ([designs](#optional-features)). Sportsmanship ratings, matchmaking, and notifications are built on the back end, but no page uses them yet. Each one adds fields, rules, and tests. If we start them early, the required features (login, registration, and creating and joining games) might not be solid by the checkpoint.

Mitigation:

- Finish and test the required features first. Login, registration, and games are built now. The pages that use them come next.
- Agree on a cut list ahead of time. If we're behind a week before a deadline, cut skill ratings first, then the friends list. The pages for sportsmanship ratings can wait until the required pages work.

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

### 10. Sportsmanship ratings get gamed or misused

**Severity: Medium · Status: Partly handled**

Public ratings invite abuse. Two friends could set up games just to rate each other positive, someone could make a new account to escape bad ratings, a player could rate someone negative to get back at them, and comments could be used to insult people. Because feedback can't be deleted, nobody on the team could remove a nasty comment without the Firebase console.

Mitigation:

- The rules only allow feedback between two people who were both in a finished, non-cancelled game, at most once per pair per game, within 14 days. Nobody can write their own totals, and the rules tests try each of those attacks.
- The score starts every player with 3 extra positive ratings, so a single unfair negative only drops a new player to 75.
- Profiles show the number of ratings and games played next to the score, so a high score from very few games stands out.
- Not handled yet: reporting a comment, and a way for the team to hide one (through the Firebase console for now). If farming becomes a problem, count only one rating per pair of players per week.

### 11. Notifications spam people, cost money, or leak phone numbers

**Severity: Medium · Status: Partly handled**

Notifications reach people outside the site, so mistakes are more visible and harder to take back. A bug or a busy area could flood someone with match alerts. Someone could type another person's phone number and opt them into texts. Text messages cost money after Twilio's free trial. And the notifier uses a service account key that can read and change everything in the database, including every player's phone number.

Mitigation:

- Nobody gets email, texts, or desktop notifications until they turn that channel on. Match alerts stay off until a player picks sports, and the notifier sends at most 3 a day to one player.
- Each notification is saved under an ID made from the game, the player, and the kind before it's sent, so restarts and repeated passes never send the same one twice. The tests check this.
- Settings, including phone numbers, are private to their owner by the rules. Emails only go to the address on the player's Firebase account, which they can't change in the settings.
- Twilio's free trial only texts numbers verified in the Twilio console, which also stops texts to strangers during the demo. If we ever pay for texts, verify each phone number with a code first and set a spending limit in Twilio.
- Keep `service-account.json` and `.env` out of git (they're in the notifier's `.gitignore`), and only on the machine that runs the notifier. If the key leaks, delete it in the Google Cloud console.
- Not handled yet: retrying a message that failed (it's recorded as `failed` in the notification), and a settings page, so for now players can only change settings through `notifications.js`.
