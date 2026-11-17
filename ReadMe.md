## Link to Project Doc
https://docs.google.com/document/d/1VCmEpDmPPw9EBAju5EfOgMI8p5ca2OstQjfF0AUy2X0/edit?usp=sharing

# Pickup-Finder

**CSCI 3308 — Team 012-4**

## Project Overview

Pickup-Finder is a web application designed to help students and local sports enthusiasts find, create, and join pickup sports games.

The goal is to make it easier for users to connect with other players and organize recreational sporting events. Players sign up, see upcoming games as pins on a map, host their own games, and join games recommended for them. After a game, players rate each other's sportsmanship, and the app uses those ratings to match good sports with each other. Players can also choose to get match alerts, game reminders, and rating requests by email, text message, or desktop notification.

## Contributors

| Name | GitHub |
| --- | --- |
| Greyson | [gtots1656](https://github.com/gtots1656) |
| Julian Rayon | [julianrayon-collab](https://github.com/julianrayon-collab) |
| Jun Hong | [j01001000](https://github.com/j01001000) |
| Paul Afriyie | [miner5758](https://github.com/miner5758) |
| Thiru | [TcDouble](https://github.com/TcDouble) |
| Zhuchen Peng | [KUHN114514](https://github.com/KUHN114514) |

## Deployed Application

Not deployed yet. The link will be added here once the app is deployed.

## Features

- **User Registration and Login:** Secure user authentication using Firebase Authentication. The home page requires login: a signed-out user is sent to the login page, and a user with no profile is sent to registration.
- **User Profiles:** Store user information and preferences using Cloud Firestore, with optional profile picture uploads using Firebase Storage.
- **Google Maps Integration:** An interactive map on the home page shows upcoming games as pins, loaded live from Firestore. Clicking a pin shows the sport, place, time, and player count. "Start location tracking" shows your position on the map without saving it anywhere.
- **Create Games:** Allow authenticated users to create sports events with information such as location, date, time, sport, skill level, and player limit, from the "+ Host a game" panel on the home page.
- **Recommended Games and Matchmaking:** The Recommended panel ranks open games by how close their players' sportsmanship scores are to yours, with a Join button on each game.
- **Sportsmanship Ratings:** After a game, the Rate players panel lets you rate each other player positive or negative, with an optional comment, within 14 days. Each player gets a public sportsmanship score from 0 to 100.
- **Notifications:** The Notifications panel shows an in-app inbox and notification settings. A Node.js notifier server, run in Docker, sends match alerts for new games, a reminder an hour before each game, and a request to rate the players after it, by email, text message, or desktop notification, whichever the player turns on.
- **Event Database:** Store game information and participant data in Firebase Firestore. Firestore security rules decide who can read and change each collection, and enforce the player limit and host-only edits.
- **User Interface:** Responsive pages built with HTML, CSS, and JavaScript, sharing one global `style.css`.

### In Progress

- Sidebar filters: `filters.js` (sport chips, time, skill level, and location search) is written, but the home page doesn't load it yet, so the filters don't change which games show.
- Profile panel: the functions to save profile edits, count hosted games, send a password reset email, and delete an account are written and tested, but the panel still shows placeholder content.
- My games panel (Joined, Hosting, and Past), and joining a game from its map pin.
- Event editing.
- Deploying the Firestore security rules and indexes to the live Firebase project. The Rate players, Notifications, and Recommended panels need them.
- Deploying the application online.

## Technologies Used

- HTML, CSS, JavaScript (ES modules, no build step)
- Firebase Authentication
- Firebase Firestore, with security rules
- Firebase Storage
- Firebase Cloud Messaging (desktop notifications)
- Google Maps JavaScript API
- Node.js, for the notifier server and the tests
- Nodemailer (email) and Twilio (text messages) in the notifier
- Docker and Docker Compose
- Mocha and Chai for automated testing
- Firebase Emulator Suite, so tests never touch live data

## Prerequisites

To run the app:

- A modern web browser.
- Node.js 20 or newer, to run the web server (`ProjectSourceCode/index.js`). Python 3 or any other static file server also works.
- Your own Google Maps JavaScript API key (see `ProjectSourceCode/login-and-registration/MAPS_SETUP.md`).

To run the tests or the notifier:

- Node.js 20 or newer (the notifier needs 20.12 or newer).
- Java 21 or newer, for the Firebase emulators.
- Docker and Docker Compose, to run the tests or the notifier in containers instead.

## Project Structure

- `ProjectSourceCode/` — Main application source code
- `ProjectSourceCode/index.js` — Web server that serves the pages and the Google Maps key (what Render runs)
- `ProjectSourceCode/login-and-registration/` — Login, registration, and home pages, with the map
- `ProjectSourceCode/create-game/` — Game creation functionality
- `ProjectSourceCode/recommended/`, `rate-players/`, `notifications/` — Home page panels for recommended games, sportsmanship ratings, and notifications
- `ProjectSourceCode/assets/` — Global `style.css`, shared panel helpers, and images
- `ProjectSourceCode/firebase/` — Firebase configuration and backend: events, sportsmanship, matchmaking, notifications, security rules, and their tests
- `ProjectSourceCode/notifier/` — Notifier server that sends email, text, and desktop notifications (Node.js, Docker)
- `ProjectSourceCode/test/` — Automated tests
- `ProjectSourceCode/docker-compose.test.yaml` — Docker testing configuration
- `ProjectSourceCode/README.md` — Database design, collections, and risks
- `milestones/uat-plan.md` — User Acceptance Testing plan
- `MilestoneSubmissions/` — Project proposal and release notes (`ReleaseNotes.md`)
- `TeamMeetingLogs/MeetingMinutes.md` — Weekly meeting notes

## Running the Application Locally

1. Clone the repository: `git clone https://github.com/TcDouble/Pickup-Finder.git`
2. In `ProjectSourceCode/`, run `npm install`, then start the web server with your Google Maps API key: `PORT=5500 MAPS_API_KEY=<your key> npm start`. The server reads the key from `MAPS_API_KEY`, so it's never saved in the repository.
3. Or, without Node: in `ProjectSourceCode/login-and-registration/`, copy `maps-config.example.js` to `maps-config.local.js` and put your key in it (Git ignores this file, so never commit it), then run `python3 -m http.server 5500 --directory ProjectSourceCode` from the repository root.
4. Open `http://localhost:5500/login-and-registration/registration.html` in your browser to create an account, or `http://localhost:5500/login-and-registration/login.html` to sign in.

The application requires its Firebase configuration and the appropriate Google Maps API configuration. The Firebase configuration is already in `ProjectSourceCode/firebase/firebase-config.js` and points to the team's live Firebase project, so accounts and games you create locally are real data. Use port 5500, because the Maps key should be restricted to `http://localhost:5500/*`, and open the pages through the server rather than as files.

The notifier is optional for running the app. To set it up, see `ProjectSourceCode/notifier/README.md`.

## Lab 10 — Automated Testing

The project uses automated tests to verify registration functionality, Firebase security rules, profile picture handling, profile functions, the home page panels, and game creation.

Tests run against Firebase Emulators to prevent modifications to production data. The suite has 90 tests as of November 17, 2026.

### Running Tests Locally

Requires Node.js 20+ and Java 21+.

From the `ProjectSourceCode` directory:

1. Run `npm ci` to install dependencies.
2. Run `npm test` to execute the complete test suite.
3. Alternatively, run `npm run test:unit` to execute the unit tests for registration validation, the home page panels, and the web server. These don't need Java or the emulators.

### Running Tests with Docker

From `ProjectSourceCode`, create `.env.test` from `.env.test.example` if necessary.

Run:

`docker compose -p lab10-tests -f docker-compose.test.yaml up --abort-on-container-exit --exit-code-from tests`

After testing, clean up using:

`docker compose -p lab10-tests -f docker-compose.test.yaml down`

### Back-End and Notifier Tests

The backend modules and the notifier have their own test suites, which also run on the Firebase emulators:

- From `ProjectSourceCode/firebase`, run `npm install`, then `npm test`.
- From `ProjectSourceCode/notifier`, run `npm install`, then `npm test`. `npm run test:unit` runs the notifier tests that don't need the emulators.

### Test Results — November 11, 2026

- **33 automated tests passed** in two consecutive Docker runs.
- Confirmed that automated tests detect errors by intentionally introducing a password-storage bug.
- The modified code resulted in 31 passing tests and 2 failing tests.
- Removed the bug and verified that all 33 tests passed again.

### User Acceptance Testing (UAT)

The UAT plan covers three major features:

1. User registration and profile creation.
2. Login and authentication.
3. Game creation and participation.

The plan is available at `milestones/uat-plan.md`. Manual UAT execution is planned separately.

## Project Documentation

[Project Google Doc](https://docs.google.com/document/d/1VCmEpDmPPw9EBAju5EfOgMI8p5ca2OstQjfF0AUy2X0/edit?usp=sharing)

[GitHub Repository](https://github.com/TcDouble/Pickup-Finder)
