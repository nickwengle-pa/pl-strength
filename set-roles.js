import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

const config = {
  apiKey: "AIzaSyAUajeTmLc-o2PwGt0VOmElqgmmhxaIIaI",
  authDomain: "pl-strength.firebaseapp.com",
  projectId: "pl-strength",
  storageBucket: "pl-strength.appspot.com",
  messagingSenderId: "123303394717",
  appId: "1:123303394717:web:2d75b7072ed537cf4a0374"
};

const app = initializeApp(config);
const db = getFirestore(app);

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: node set-roles.js <uid>');
  process.exit(1);
}

setDoc(doc(db, 'roles', uid), {
  roles: ['coach'],
  updatedAt: serverTimestamp()
}).then(() => {
  console.log('Roles document created for', uid);
}).catch(err => {
  console.error('Error:', err);
});