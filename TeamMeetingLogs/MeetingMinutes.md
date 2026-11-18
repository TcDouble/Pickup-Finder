# Meeting Notes — Team 012-4
Last edited:
- 2026-11-18 `<j01001000>`
- 2026-11-17 `<j01001000>`
- 2026-11-12 `<j01001000>`
- 2026-11-11 `<j01001000>`
- 2026-11-4 `<j01001000>`
- 2026-10-28 `<julianrayon-collab>`

## Week 14 — `November 18, 2026`

### Agenda

- Paul added features to profile page.
- Grayson set difficulty.
- Julian implemented filters to events.
- Jun fixed bugs connecting features with Firebase.
- Thiru checked functionality.
- Since November 10, 2026, the notifier (notifier/) is a Node.js server of ours that runs in a Docker container and connects the database to email, text messages, and desktop notifications. The tests also run in containers (docker-compose.test.yaml). That covers part of both requirements, but the pages still don't go through a server and aren't served from a container.
Ask the TA at the next weekly meeting whether Firebase plus the notifier counts as the server and database, and write the answer in the meeting minutes.
If it doesn't count, the smallest fix is a small Node/Express server in a Docker container that serves the pages in ProjectSourceCode/, plus a docker-compose.yml that starts it. The pages and Firestore code stay the same.
The Firebase emulators can also run in a container for local development, which would cover Docker for the database side.

---

## Week 13 — `November 11, 2026`

### Agenda

- Thiru absent.
- Altaf checked-in with each member.
- Google Maps integration.

---

## Week 12 — `November 4, 2026`

### Agenda

- Paul joined remotely. He's at a conference.
- Discussed completion of login/registration, events database. Front end pages need to connect.
- Plan for the week: unit testing, connecting pages and functionalities.
- Designee for Canvas submissions: Jun

---

## Week 11 — `October 28, 2026`

### Agenda

- First Meeting: Discussed progress on wireframe and potential risks of firebase database, and future workload split.
