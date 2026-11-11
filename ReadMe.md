## Link to Project Doc
https://docs.google.com/document/d/1VCmEpDmPPw9EBAju5EfOgMI8p5ca2OstQjfF0AUy2X0/edit?usp=sharing

# Pickup-Finder

**CSCI 3308 — Team 012-4**

## Project Overview

Pickup-Finder is a web application designed to help students and local sports enthusiasts find, create, and join pickup sports games.

The goal is to make it easier for users to connect with other players and organize recreational sporting events.

## Features

- **User Registration and Login:** Secure user authentication using Firebase Authentication.
- **User Profiles:** Store user information and preferences using Cloud Firestore, with optional profile picture uploads using Firebase Storage.
- **Google Maps Integration:** Display an interactive map on the home page.
- **Create Games:** Allow authenticated users to create sports events with information such as location, date, time, sport, skill level, and player limit.
- **Event Database:** Store game information and participant data in Firebase Firestore.
- **User Interface:** Responsive pages built with HTML, CSS, and JavaScript.

### Planned Features

- Browse and join available games through the user interface.
- Game filtering and matchmaking.
- Sportsmanship ratings.
- Match notifications.
- Event editing.

## Technologies Used

- HTML, CSS, JavaScript
- Firebase Authentication
- Firebase Firestore
- Firebase Storage
- Google Maps API
- Node.js
- Docker and Docker Compose
- Mocha and Chai for automated testing

## Project Structure

- `ProjectSourceCode/` — Main application source code
- `ProjectSourceCode/login-and-registration/` — User authentication and registration
- `ProjectSourceCode/create-game/` — Game creation functionality
- `ProjectSourceCode/firebase/` — Firebase configuration and backend
- `ProjectSourceCode/test/` — Automated tests
- `ProjectSourceCode/docker-compose.test.yaml` — Docker testing configuration
- `milestones/uat-plan.md` — User Acceptance Testing plan
- `MilestoneSubmissions/ReleaseNotes.md` — Project release notes

## Running the Application Locally

1. Clone the repository.
2. Navigate to `ProjectSourceCode`.
3. Start a local web server using `python -m http.server 8000`.
4. Open `http://localhost:8000/login-and-registration/registration.html` in your browser.

The application requires its Firebase configuration and the appropriate Google Maps API configuration.

## Lab 10 — Automated Testing

The project uses automated tests to verify registration functionality, Firebase security rules, profile picture handling, and game creation.

Tests run against Firebase Emulators to prevent modifications to production data.

### Running Tests Locally

Requires Node.js 20+ and Java 21+.

From the `ProjectSourceCode` directory:

1. Run `npm ci` to install dependencies.
2. Run `npm test` to execute the complete test suite.
3. Alternatively, run `npm run test:unit` to execute the registration validation unit tests.

### Running Tests with Docker

From `ProjectSourceCode`, create `.env.test` from `.env.test.example` if necessary.

Run:

`docker compose -p lab10-tests -f docker-compose.test.yaml up --abort-on-container-exit --exit-code-from tests`

After testing, clean up using:

`docker compose -p lab10-tests -f docker-compose.test.yaml down`

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