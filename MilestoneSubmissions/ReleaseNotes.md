# Release Notes — Team 012-4

Last edited:

- 2026-11-11 `<j01001000>`
- 2026-11-3 `<j01001000>`
- 2026-10-30 `<j01001000>`

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

### Planned for next week

The checklist issue on the project board:
- Connect Event Database to Frontend `https://github.com/TcDouble/Pickup-Finder/issues/11`
- Connect User Database to Frontend `https://github.com/TcDouble/Pickup-Finder/issues/12`
- Menu Interactivity/Filters `https://github.com/TcDouble/Pickup-Finder/issues/7`
- Display events as pins on the map `https://github.com/TcDouble/Pickup-Finder/issues/19`
- Be able to create an event `https://github.com/TcDouble/Pickup-Finder/issues/20`
- Be able to edit an event `https://github.com/TcDouble/Pickup-Finder/issues/23`
- Matchmaking and Sportsmanship Rating (review PR #25) `https://github.com/TcDouble/Pickup-Finder/issues/13`
- Matchmaking Notifications `https://github.com/TcDouble/Pickup-Finder/issues/17`

---

## Week 12 — `November 3, 2026`

### Added

- `<feature>` (#`<PR number>`, `<github-username>`)
- Firebase Events Database. `<j01001000>`

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
