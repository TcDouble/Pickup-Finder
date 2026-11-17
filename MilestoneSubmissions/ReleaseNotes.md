# Release Notes — Team 012-4

Last edited:

- 2026-11-16 `<j01001000>`
- 2026-11-15 `<j01001000>`
- 2026-11-11 `<j01001000>`
- 2026-11-3 `<j01001000>`
- 2026-10-30 `<j01001000>`

## Week 14 — `November 18, 2026`

### Added

- Sportsmanship ratings and matchmaking back end (#25, issue #13). After a finished game, players rate each other positive or negative with an optional comment, and each player gets a public 0 to 100 score. Open games can be sorted by how close their players' scores are to yours. 57 new emulator tests. `<j01001000>`
- Matchmaking notifications back end (#25, issue #17). Players choose email, text, or desktop notifications for a new game that fits their settings, a reminder an hour before a game, and a request to rate the players after it. Includes an in-app inbox and a Node.js notifier server in Docker that sends each notification once. 73 new tests. `<j01001000>`
- Rate players, Notifications, and Recommended panels on the home page (#27, issues #13 and #17). Rate players lists your games from the last 14 days that still have players to rate. Notifications shows the live inbox and the notification settings. Recommended ranks open games by how close their players' sportsmanship scores are to yours, with a Join button on each game. 14 new unit tests; the Lab 10 test suite is now 84 tests. `<j01001000>`
- Profile functions for the home page's Profile panel: save profile edits (name, city, sports and levels, bio, picture), count the games you host, email a password reset link, and delete your account after checking your password, which cancels upcoming games you host and takes you out of games you joined. No page calls them yet. 23 new tests. `<miner5758>`
- `filters.js` for the home page filters (sport chips, time, skill level, and location search). `home.js` doesn't load it yet, so the filters don't change which games show. `<julianrayon-collab>`
- Game pins on the home page map, loaded live from Firestore, with a popup showing the sport, place, time, and player count (#19). `<KUHN114514>`
- "Start location tracking" button on the home page map. It shows your position on the map only and never saves it to Firestore. `<KUHN114514>`
- Google Maps setup guide (`MAPS_SETUP.md`) and `maps-config.example.js`, so each person keeps the Maps key in a local file that Git ignores. `<KUHN114514>`
- README sections for the project overview, features, tech stack, project structure, running the app, and Lab 10 testing. `<KUHN114514>`
- Meeting notes for Week 13 and the Week 14 agenda. `<j01001000>`

### Changed

- Home page now requires login. It stays hidden until sign-in is checked, then sends a signed-out user to the login page and a user with no profile to registration. `<TcDouble>`
- "+ Host a game" opens a create-game panel on the home page instead of going to a separate page. `<TcDouble>`
- Login and registration pages no longer send a signed-in user away. They say who is signed in and only move on after the form is submitted. `<TcDouble>`
- The Firestore rule for profiles now checks every profile field and lets players delete their own profile. Registration has matching length limits for name and city. 14 new tests; the Lab 10 test suite is now 47 tests. `<miner5758>`
- Links in notification emails, texts, and desktop alerts now open the matching home page panel: a match alert opens Recommended with that game on top, a rating request opens Rate players for that game, and a reminder opens the inbox. `<j01001000>`

### Fixed

- Notifier test image no longer has its `PATH` replaced by the host computer's `PATH`. `<miner5758>`

### Planned for next week

The checklist issue on the project board:
- Matchmaking and Sportsmanship Rating (back end and screens merged in PRs #25 and #27; deploy the Firestore rules and indexes, test on the live site, then close) `https://github.com/TcDouble/Pickup-Finder/issues/13`
- Matchmaking Notifications (back end and screens merged in PRs #25 and #27; deploy the Firestore rules and indexes, test on the live site, then close) `https://github.com/TcDouble/Pickup-Finder/issues/17`
- Be able to create an event (the "+ Host a game" panel saves games; confirm what is left) `https://github.com/TcDouble/Pickup-Finder/issues/20`
- To be able to edit an event `https://github.com/TcDouble/Pickup-Finder/issues/23`
- Google Maps API (needs a test) `https://github.com/TcDouble/Pickup-Finder/issues/2`
- Create a global style.css file for the website (check every page at phone width, then close) `https://github.com/TcDouble/Pickup-Finder/issues/15`
- Menu Interactivity/Filters (`filters.js` is merged; load it in `home.js` so the filters change which games show) `https://github.com/TcDouble/Pickup-Finder/issues/7`

---

## Week 13 — `November 11, 2026`

### Added

- Lab 10 Docker test setup and `.env.test.example` template (#24). `<KUHN114514>`
- Mocha and Chai packages for Lab 10 testing, with `node_modules` kept out of Git. `<julianrayon-collab>`
- Lab 10 tests on the Firebase emulators: a unit test for the sign-up checks, a good and a bad sign-up test, and extra credit tests for creating a game. `<j01001000>`
- Lab 10 UAT plan. `<julianrayon-collab>`
- Optional profile picture upload on the registration page, with Storage rules and tests. The Lab 10 test suite is now 33 tests. `<miner5758>`
- Home page rebuilt to match the map wireframe, with a sidebar for filters and the account panel. "+ Host a game" opens the create-game page. `<TcDouble>`
- Global `style.css` with CU Boulder colors, used by every page. `<miner5758>`
- Meeting notes for Weeks 11 and 12. `<j01001000>`

### Changed

- Login and registration pages connected and moved into one `login-and-registration` folder. `<miner5758>`
- Create-game page moved into its own `create-game` folder. `<TcDouble>`
- Sign-up checks split out of `registration.js` into `validateRegistration.js` and `registerUser.js` so they can be tested. `<j01001000>`
- Docker test setup now runs on the Firebase emulators instead of PostgreSQL. `<j01001000>`
- UAT plan moved to `milestones/uat-plan.md`, where Lab 10 looks for it. `<j01001000>`
- UAT plan steps 7 and 8 revised. `<julianrayon-collab>`
- UAT plan updated with issue numbers, the app's real error messages, and a game location for UAT-06. `<gtots1656>`
- Emails are no longer saved in player profiles; they stay in Firebase Auth. `<miner5758>`
- Home page sends a signed-in user with no profile to the finish-setup form. `<miner5758>`
- Login page now uses the same card layout as the registration and create-game pages. `<miner5758>`

### Fixed

- Removed a Google Maps API key that was uploaded by accident (#22). `<KUHN114514>`
- Docker test build no longer breaks on computers with spaces in `PATH`. `<miner5758>`

### Lab 10 testing record — KUHN114514

- Completed automated testing with Docker and Firebase Emulators; the recorded runs had all 33 tests passing twice consecutively.
- Covered registration, profile pictures, Firebase security rules, and event creation.
- Demonstrated bug detection by introducing a password storage bug: 31 tests passed and 2 failed. After removing the bug, all 33 tests passed again.
- Completed the UAT plan at `milestones/uat-plan.md`.
- Pending at the time of this record: TA review and final Canvas submission.

### Planned for next week

The checklist issue on the project board:
- Matchmaking and Sportsmanship Rating (review PR #25) `https://github.com/TcDouble/Pickup-Finder/issues/13`
- Matchmaking Notifications `https://github.com/TcDouble/Pickup-Finder/issues/17`
- Login and Register Page `https://github.com/TcDouble/Pickup-Finder/issues/4`
- Be able to create an event `https://github.com/TcDouble/Pickup-Finder/issues/20`
- User Database `https://github.com/TcDouble/Pickup-Finder/issues/5`
- Menu Interactivity/Filters `https://github.com/TcDouble/Pickup-Finder/issues/7`
- To be able to edit an event `https://github.com/TcDouble/Pickup-Finder/issues/23`

---

## Week 12 — `November 3, 2026`

### Added

- `<feature>` (#`<PR number>`, `<github-username>`)
- Firebase Events Database. `<j01001000>`
- Google Maps on the signed-in home page. `<KUHN114514>`
- Create-game page that saves games to Firebase, built from a find-game page prototype. `<TcDouble>`

### Changed

- Project board and epics were updated on Github.

### Fixed

- `<...>`
- Fixed stories 5, 7, and 12, to better match formating. `julianrayon-collab`

### Planned for next week

The checklist issue on the project board:
- Add 2 User Stories (Individual Task) `<https://github.com/TcDouble/Pickup-Finder/issues/9>`
- Lab 9 Extra Credit `<https://github.com/TcDouble/Pickup-Finder/issues/10>`
- Login and Register Page `https://github.com/TcDouble/Pickup-Finder/issues/4`
- User Database `https://github.com/TcDouble/Pickup-Finder/issues/5`

---

## Week 11 — `October 28, 2026`

### Added
- Created two user stories with acceptance criteria, linked them to their respective Epics, and assigned story points. (KUHN114514)
- `<feature>` (#`<PR number>`, `<github-username>`)
- Project board and epics were set up on Github.
- Login and register page was set up with Firebase. `<miner5758>`, `julianrayon-collab`

### Changed

- `<...>`

### Fixed

- `<...>`

### Planned for next week

The checklist issue on the project board:
- Add 2 User Stories (Individual Task) `<https://github.com/TcDouble/Pickup-Finder/issues/9>`
- Lab 9 Extra Credit `<https://github.com/TcDouble/Pickup-Finder/issues/10>`
- Login and Register Page `https://github.com/TcDouble/Pickup-Finder/issues/4`
- User Database `https://github.com/TcDouble/Pickup-Finder/issues/5`

---

## Week 10 — `October 21, 2026`

### Added

- Added wireframe prototype using Claude. `<TcDouble>`
- Discussed user features and divided up into groups of two people.

### Changed

- Not Applicable

### Fixed

- Not Applicable

### Planned for next week

The checklist issue on the project board: Not Applicable
