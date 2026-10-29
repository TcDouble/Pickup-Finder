import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDIEWpZpEso4BdxJP0gbx6zWqHDLD56wQQ",
  authDomain: "sport-pick-up-app-team-4.firebaseapp.com",
  projectId: "sport-pick-up-app-team-4",
  storageBucket: "sport-pick-up-app-team-4.firebasestorage.app",
  messagingSenderId: "9181423400",
  appId: "1:9181423400:web:124f1d5690463a1e34521d",
  measurementId: "G-9EYDX34WF0",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
