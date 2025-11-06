# Cloud Function: Auth Deletion Queue

This directory contains a single Firebase Cloud Function that mirrors the roster deletion queue used in the web app.

When an admin removes a coach from the roster UI we write a document to `__deleteAuthUser__/{uid}` in Firestore. Deploying this function ensures the corresponding Firebase Auth account is deleted automatically.

## Deploy steps

1. Authenticate with the Firebase CLI and target the relevant project:
   ```bash
   firebase login
   firebase use <your-project-id>
   ```
2. Install function dependencies:
   ```bash
   cd functions
   npm install
   ```
3. Deploy the function:
   ```bash
   firebase deploy --only functions:handleDeleteAuthUserQueue
   ```

> The function runs on Node.js 20 and requires the default service account to have permission to delete Auth users (enabled by default in Firebase projects).

## Behaviour

- Trigger: Firestore document creation at `__deleteAuthUser__/{uid}`.
- Action: Calls the Admin SDK `deleteUser(uid)` API.
- Success: The queue document is deleted after the Auth user is removed.
- Failure: The function records the error message and last attempt timestamp on the queue document so you can inspect it and retry.
