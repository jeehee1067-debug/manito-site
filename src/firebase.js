import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { firebaseConfig as config } from "./firebase.config.js";

export const configured = Boolean(config.apiKey && config.projectId);
export const app = configured ? initializeApp(config) : null;
export const auth = configured ? getAuth(app) : null;
export const db = configured ? getFirestore(app) : null;
