import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCvYFYK9b8VNST21YY2hPSX8DA0AeQCJRA",
  authDomain: "lifeline-sos-efb43.firebaseapp.com",
  databaseURL: "https://lifeline-sos-efb43-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "lifeline-sos-efb43",
  storageBucket: "lifeline-sos-efb43.firebasestorage.app",
  messagingSenderId: "475195303542",
  appId: "1:475195303542:web:4e940f6563eecc91c2a157"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);