
import { tryInitFirebase } from './firebase';
import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';

export const fb = tryInitFirebase();
let _ready: Promise<User | null> | null = null;

export function initAuth(): Promise<User | null> {
  if (!fb) return Promise.resolve(null);
  if (_ready) return _ready;
  _ready = new Promise((resolve) => {
    onAuthStateChanged(fb.auth, async (user) => {
      try {
        if (user) return resolve(user);
        const cred = await signInAnonymously(fb.auth);
        resolve(cred.user);
      } catch (e) {
        console.error('Anonymous sign-in failed', e);
        resolve(null);
      }
    });
  });
  return _ready;
}
