# User Acceptance Testing (UAT) Plan — Pickup-Finder

**Team:** 012-4  
**Project:** Pickup-Finder  
**Document:** `milestones/uat-plan.md`  
**Status:** Planned — Tests Not Run

---

## Scope

This UAT plan evaluates three major features of Pickup-Finder to determine whether the application meets its intended user requirements.

### Feature 1: Account Registration and Profile Creation
- **Requirements:** User registration and user database (Issues #4 and #5).
- Users should be able to create an account using their email and password.
- Users should be able to provide profile information, including display name, city, and preferred sports.
- Account information should be stored in Firebase Authentication and Cloud Firestore.

### Feature 2: Login and Authentication
- **Requirements:** User login, password handling, and session management.
- Existing users should be able to log in using valid credentials.
- Invalid credentials should not grant access.
- Users should be redirected to the appropriate page depending on their authentication and profile status.

### Feature 3: Event Creation and Participation
- **Requirements:** Events database and event participation functionality.
- Authenticated users should be able to create sporting events.
- Events should contain relevant information, including sport, title, skill level, date, time, location, and player limit.
- Users should be able to participate in available events, subject to event capacity and participation requirements.

---

## Acceptance Criteria

| Feature | Acceptance Criteria |
|---|---|
| Account Registration | A user can register with valid email and password credentials. The account is created in Firebase Authentication, and the corresponding profile is saved in Firestore with the required profile information. |
| Account Registration | Submitting incomplete or invalid registration information does not create an account. The user receives appropriate feedback identifying the problem. |
| Login and Authentication | A registered user can log in successfully and access the appropriate authenticated application page. |
| Login and Authentication | Incorrect credentials do not grant access. The user remains on the login page and receives an appropriate error message. |
| Event Creation and Participation | An authenticated user can create an event with valid information. The event is saved in Firestore and appears in the application's event listings. |
| Event Creation and Participation | An event cannot be created with missing required information or an invalid player limit. Users cannot join events that have reached their player limit. |

---

## Test Environment

**Environment:** Local development environment.

### Setup Instructions

1. Clone the Pickup-Finder repository and navigate to `ProjectSourceCode/`.
2. Install Node.js 20 or later and Java 21 or later.
3. Navigate to the Firebase directory:

   ```bash
   cd firebase
   ```

4. Install project dependencies:

   ```bash
   npm install
   ```

5. Start the Firebase Authentication and Firestore emulators:

   ```bash
   npm run emulators
   ```

6. In a separate terminal, navigate to `ProjectSourceCode/` and start the local web server:

   ```bash
   python3 -m http.server 8000
   ```

7. Open the application at:

   ```text
   http://localhost:8000
   ```

8. Verify that the application is configured to use the local Firebase emulators before executing tests. Do not use production accounts or production data for UAT.

### Browser and Device

- **Browser:** Google Chrome (desktop).
- **Device:** Desktop or laptop computer.
- **Operating System:** Windows 11 with WSL2 Ubuntu development environment.

### Application Version

- **Repository:** Pickup-Finder
- **Branch:** `main`
- **Version at planning:** To be recorded during execution.
- **Commit hash at execution:** To be recorded using:

  ```bash
  git rev-parse HEAD
  ```

The actual commit hash and application version must be documented before testing begins.

---

## Testers

### Intended Tester Characteristics

Testers should represent potential Pickup-Finder users, including:
- Students interested in finding other people to play sports with.
- Users with experience creating online accounts.
- Users interested in organizing or joining recreational sporting events.
- Users with varying levels of familiarity with web applications.

### Tester Recruitment and Coordination

The team will coordinate testing and collect feedback from participants.

Whenever feasible, testers should be recruited from outside the implementation team to provide unbiased feedback.

If external testers are unavailable, classmates who are not directly responsible for implementing the tested features may act as proxies. This limitation should be documented in the final project report.

### Planned Tester IDs

| Tester ID | Intended Characteristics | Assignment |
|---|---|---|
| T1 | Student interested in recreational sports | Registration and profile creation |
| T2 | Student familiar with web applications | Login and authentication |
| T3 | Student interested in organizing sporting events | Event creation |
| T4 | Student interested in joining sporting events | Event participation |

Tester IDs will be used instead of personal identifying information.

---

## Test Cases

All tests are initially marked **Not run**. Actual results and issues will be recorded after execution.

| **Test ID** | **Feature / requirement** | **Acceptance criterion** | **Preconditions** | **Test data** | **User steps** | **Expected result** | **Tester ID** | **Actual result** | **Status** | **Issue / follow-up** |
| ----------- | ------------------------------- | ------------------------------ | --------------------------------------------- | ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------- | ------------- | ----------------- | ---------- | --------------------- |
| UAT-01 | Account registration / Issue #4 | A user can create an account using valid credentials and profile information. | Registration page is open; user is signed out. | Email: `uat.user01@example.test`; Password: `UatTestPass!2026`; Display name: `UAT User 01`; City: `Boulder`; Sport: `Basketball`. | 1. Open registration. 2. Enter the provided credentials. 3. Enter profile information. 4. Submit the form. | Registration succeeds. A Firebase Authentication account is created, a corresponding Firestore user profile is saved, and the user is redirected to the appropriate application page. | Planned: T1 | Not run | Not run | None yet |
| UAT-02 | Account registration / Issue #5 | Incomplete registration information does not create an account. | Registration page is open; user is signed out. | Email: `uat.user02@example.test`; Password: blank; Display name: `UAT User 02`; City: `Boulder`. | 1. Open registration. 2. Enter the email and display name. 3. Leave the password blank. 4. Submit the form. | Registration is rejected. Feedback identifies the missing password, no authenticated account is created, and the user remains on the registration page. | Planned: T1 | Not run | Not run | None yet |
| UAT-03 | Login / Authentication | A registered user can log in with valid credentials. | A registered test account exists; user is signed out; login page is open. | Email: `uat.user01@example.test`; Password: `UatTestPass!2026`. | 1. Open the login page. 2. Enter the registered email. 3. Enter the correct password. 4. Submit the form. | Authentication succeeds. The user is redirected to the appropriate authenticated application page and can access functionality requiring authentication. | Planned: T2 | Not run | Not run | None yet |
| UAT-04 | Login / Authentication | Incorrect credentials do not grant access. | Login page is open; user is signed out; test account exists. | Email: `uat.user01@example.test`; Password: `IncorrectPassword123`. | 1. Open the login page. 2. Enter the registered email. 3. Enter the incorrect password. 4. Submit the form. | Login fails. An appropriate error message is displayed, the user remains unauthenticated, and access to protected functionality is denied. | Planned: T2 | Not run | Not run | None yet |
| UAT-05 | Event creation / Events database | An authenticated user can create an event with valid information. | User is logged in; event creation page is accessible; Firebase services are available. | Sport: Basketball; Title: `UAT Basketball Game`; Skill level: Casual; Start: `2026-11-20 18:00`; End: `2026-11-20 19:00`; Location: `University of Colorado Boulder`; Player limit: `10`. | 1. Open event creation. 2. Select basketball. 3. Enter the event title. 4. Select casual skill level. 5. Enter the start and end times. 6. Enter the location. 7. Set the player limit to 10. 8. Submit the event. | Event creation succeeds. The event is saved in Firestore with the supplied information, the authenticated user is recorded as its host and initial participant, and the event appears in the available event listings. | Planned: T3 | Not run | Not run | None yet |
| UAT-06 | Event creation / Events database | Invalid event information is rejected. | User is logged in; event creation page is accessible. | Sport: Basketball; Title: `UAT Invalid Event`; Skill level: Casual; Start: `2026-11-20 18:00`; End: `2026-11-20 19:00`; Player limit: `1`. | 1. Open event creation. 2. Enter the event information. 3. Set the player limit to 1, below the permitted minimum of 2. 4. Submit the event. | Event creation is rejected. The application provides appropriate validation feedback, and no invalid event is saved in Firestore. | Planned: T3 | Not run | Not run | None yet |
| UAT-07 | Event participation / Events database | An authenticated user can join an event that has available capacity. | An event exists with available spaces; a second registered user is logged in. | Event: `UAT Basketball Game`; Player limit: `10`; Existing participants: `1`; Joining user: `uat.user02@example.test`. | 1. Log in as the second test user. 2. Open the available events listing. 3. Locate `UAT Basketball Game`. 4. Select the option to join the event. | The joining user is added to the event's participant list. The participant count increases from 1 to 2, and the user is associated with the event. | Planned: T4 | Not run | Not run | None yet |
| UAT-08 | Event participation / Events database | An event at maximum capacity cannot accept additional participants. | An event exists with its player limit already reached; a different registered user is logged in. | Event: `UAT Full Event`; Player limit: `2`; Existing participants: `2`; Joining user: `uat.user03@example.test`. | 1. Log in as the additional test user. 2. Open the available events listing. 3. Locate `UAT Full Event`. 4. Attempt to join the event if the interface provides the option. | The application prevents the user from joining the full event. The participant count remains 2, the participant list remains unchanged, and appropriate feedback is displayed. | Planned: T4 | Not run | Not run | None yet |

---

## Results and Issue Tracking

All test cases are initially marked **Not run**. No test execution results are assumed.

After executing each test, the assigned tester must record:

- **Actual result:** What actually happened during testing.
- **Status:** Pass, Fail, or Blocked.
- **Issue / follow-up:** Any unexpected behavior, defects, or required changes.

### Status Definitions

| Status | Meaning |
|---|---|
| Pass | The observed application behavior matches the expected result. |
| Fail | The application does not meet the acceptance criteria. |
| Blocked | Testing cannot be completed because of an unavailable feature, environment issue, or other dependency. |
| Not run | The test has not yet been executed. |

### Issue Resolution and Retesting

1. Record any failed or blocked tests and describe the observed issue.
2. Create or update the corresponding project issue.
3. Assign the issue to the appropriate development team member.
4. After a fix is implemented, repeat the original test case.
5. Record the retest outcome and update the status.
6. Include unresolved issues and testing limitations in the final project report.

---

## Final UAT Summary

This section will be completed after test execution.

| Metric | Result |
|---|---|
| Total test cases | 8 |
| Tests passed | Not yet determined |
| Tests failed | Not yet determined |
| Tests blocked | Not yet determined |
| Tests not run | 8 |
| Outstanding issues | Not yet determined |

The completed UAT plan, actual test observations, issue resolutions, and retesting outcomes will be included in the final project report.

