import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCx52RdhD94H9VeyW4OMDvrLNHDGAbDeSc",
  authDomain: "pl-strength.firebaseapp.com",
  projectId: "pl-strength",
  storageBucket: "pl-strength.firebasestorage.app",
  messagingSenderId: "123303394717",
  appId: "1:123303394717:web:2d75b7072ed537cf4a0374",
  measurementId: "G-HMC7R7ML7W"
};

export const app = initializeApp(firebaseConfig);
try { getAnalytics(app); } catch {}
export const auth = getAuth(app);
export const db = getFirestore(app);
