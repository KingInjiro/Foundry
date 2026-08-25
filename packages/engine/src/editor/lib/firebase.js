import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, collection } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "halogen-watch-ngtt6",
  appId: "1:915016509894:web:0121e1411d9796209d2ac7",
  apiKey: "AIzaSyDOh3Ip2jwzt5oVPw0kZoAR3lF-KSpPJxo",
  authDomain: "halogen-watch-ngtt6.firebaseapp.com",
  storageBucket: "halogen-watch-ngtt6.firebasestorage.app",
  messagingSenderId: "915016509894"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app, "ai-studio-foundryengine-2c0d9198-817d-437d-8b2b-d5a59c60420c");

export { db, doc, setDoc, getDoc, collection };
