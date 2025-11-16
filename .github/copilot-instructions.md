# Copilot Instructions for mosque_app_functions

## Project Overview

This repository contains Firebase Cloud Functions for **Al-Madina Masjid App**, a mosque management system. The backend handles prayer times, donations (via Stripe), events, notifications (FCM), user management with role-based permissions, and automated cleanup tasks.

## Tech Stack

- **Runtime**: Node.js 20
- **Language**: TypeScript 5.1.6
- **Framework**: Firebase Functions v2 (2nd gen)
- **Database**: Cloud Firestore (australia-southeast1)
- **Services**:
  - Stripe (payment processing)
  - Resend (email receipts)
  - Firebase Cloud Messaging (push notifications)
  - Google Secret Manager (API keys)
  - adhan (prayer time calculations)

## Project Structure

```
functions/
├── src/
│   ├── index.ts                      # Main exports
│   ├── donations.ts                  # Stripe payment intents & subscriptions
│   ├── webhooks.ts                   # Stripe webhook handler
│   ├── getDonations.ts              # Donation data retrieval
│   ├── getDonationAnalytics.ts      # Analytics & reporting
│   ├── subscriptionManagement.ts    # Recurring donation management
│   ├── adminManagement.ts           # User & role management
│   ├── deleteUser.ts                # User deletion
│   ├── updateUserProfile.ts         # Profile updates
│   ├── setSuperAdmin.ts             # Super admin protection
│   ├── geocoding.ts                 # Address to coordinates
│   ├── tokens.ts                    # FCM token management
│   ├── notifications/               # FCM notification triggers
│   │   ├── onEventCreated.ts
│   │   ├── onEventUpdated.ts
│   │   ├── onCampaignCreated.ts
│   │   ├── onIqamahChanged.ts
│   │   └── sendCustomNotification.ts
│   ├── prayerTimes/                 # Prayer time calculations
│   │   ├── calculatePrayerTimes.ts  # Adhan package integration
│   │   ├── updatePrayerTimes.ts     # Scheduled updates
│   │   └── onMosqueSettingsUpdate.ts
│   ├── cleanup/                     # Automated cleanup tasks
│   │   ├── cleanupStaleTokens.ts    # Remove old FCM tokens
│   │   ├── cleanupTmpImages.ts      # Delete temporary images
│   │   └── on*.ts                   # Event-triggered cleanup
│   └── utils/
│       ├── roles.ts                 # Permission & role definitions
│       ├── messagingHelpers.ts      # FCM utilities
│       ├── imageHelpers.ts          # Firebase Storage helpers
│       └── tokenCleanup.ts          # Token cleanup utilities
├── package.json
├── tsconfig.json
└── .gitignore
```

**Root files**:
- `firebase.json` - Firebase config (emulators on ports 5001, 8080, 4000)
- `firestore.rules` - Security rules
- `firestore.indexes.json` - Database indexes
- `.firebaserc` - Project: al-madina-masjid-app

## Build & Development Workflow

### Initial Setup
```bash
cd functions
npm install
```

### Build Commands
```bash
npm run build          # Compile TypeScript to lib/
npm run build:watch    # Watch mode
```

**Important**: Build output goes to `functions/lib/`. This directory is gitignored and should never be committed.

### Linting
⚠️ **Known Issue**: ESLint is configured in package.json but **missing .eslintrc.js config file**. The lint command will fail without creating a config first.

**Workaround**: If linting is required, create `.eslintrc.js`:
```javascript
module.exports = {
  root: true,
  env: { es6: true, node: true },
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "google"],
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2020, sourceType: "module" },
  plugins: ["@typescript-eslint", "import"],
  rules: { "quotes": ["error", "double"] },
};
```

### Testing & Deployment
```bash
npm run serve          # Start emulators (build + emulate)
npm run deploy         # Deploy to Firebase
npm run logs           # View function logs
```

### Emulators
- Functions: `http://localhost:5001`
- Firestore: `http://localhost:8080`
- Emulator UI: `http://localhost:4000`

## Coding Guidelines

### TypeScript Configuration
- **Target**: ES2017
- **Module**: NodeNext (ESM support)
- **Strict mode**: Enabled
- Enforce: `noImplicitReturns`, `noUnusedLocals`

### Code Organization
1. **File headers**: Include descriptive comments (see donations.ts, webhooks.ts)
2. **Exports**: All functions exported via `src/index.ts`
3. **Region**: All functions use `australia-southeast1` (set globally in index.ts)
4. **Error handling**: Use `HttpsError` from `firebase-functions/v2/https`

### Common Patterns

**Callable Functions**:
```typescript
export const functionName = onCall({
  region: "australia-southeast1",
  cors: true,
  secrets: ["SECRET_NAME"], // If needed
}, async (request) => {
  // Always check auth
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Message");
  }
  // Implementation
});
```

**Firestore Triggers**:
```typescript
export const onDocChange = onDocumentWritten({
  region: "australia-southeast1",
  document: "collection/{docId}"
}, async (event) => {
  const before = event.data?.before;
  const after = event.data?.after;
  // Implementation
});
```

**Scheduled Functions**:
```typescript
export const scheduledTask = onSchedule({
  region: "australia-southeast1",
  schedule: "0 0 * * *", // Daily at midnight
  timeZone: "Australia/Sydney"
}, async (event) => {
  // Implementation
});
```

### Secret Management
Secrets are stored in Google Secret Manager:
- `STRIPE_SECRET_KEY` - Payment processing
- `STRIPE_WEBHOOK_SECRET` - Webhook validation
- `RESEND_API_KEY` - Email receipts

**Never** hardcode secrets. Access via:
```typescript
process.env.SECRET_NAME
```

### Role-Based Access Control
Use utilities from `utils/roles.ts`:
- Predefined roles: `SUPER_ADMIN`, `ADMIN`, `PRAYER_MANAGER`, etc.
- Permission checking: `hasPermission()`, `canManageUsers()`
- Custom claims: `createCustomClaims()`

### Timezone Handling
⚠️ **Critical**: App uses **Australia/Sydney** timezone for all date operations:
```typescript
new Date().toLocaleString("en-US", { timeZone: "Australia/Sydney" })
```

## Known Issues & TODOs

### App Check (High Priority)
Multiple functions have:
```typescript
enforceAppCheck: false, // TODO: Change to true after testing
```
**Files affected**: `tokens.ts` (4 instances)

**Action needed**: Enable App Check in Firebase Console, then update to `true`.

### Missing Admin Role Check
In `sendCustomNotification.ts`:
```typescript
// TODO: Add admin role check here
// For now, any authenticated user can send
```

**Action needed**: Add permission validation using `utils/roles.ts`.

### ESLint Configuration
Missing `.eslintrc.js` - lint command fails. See "Linting" section above.

## Testing Checklist

Before deploying:
1. ✅ Run `npm run build` - Must succeed without errors
2. ⚠️ Run `npm run lint` - Will fail without .eslintrc.js (known issue)
3. ✅ Test with emulators: `npm run serve`
4. ✅ Check logs for errors: `npm run logs`

## Common Pitfalls

1. **Don't commit `lib/` directory** - Build artifacts are gitignored
2. **Always use async/await** in Cloud Functions
3. **Stripe initialization**: Use lazy initialization with secrets (see donations.ts)
4. **FCM data-only messages**: Must set `priority: 'high'` and `contentAvailable: true` (see messagingHelpers.ts)
5. **Timestamp serialization**: Use `timestampToString()` for FCM payloads
6. **Image cleanup**: Move tmp images to live storage before Firestore creates (see imageHelpers.ts)
7. **Security rules**: Firestore rules enforce server-only access for sensitive collections

## Dependencies Notes

- **adhan**: Prayer time calculations (Muslim World League method by default)
- **axios**: HTTP requests for geocoding
- **firebase-admin**: Server SDK v12.6.0
- **firebase-functions**: v2 (2nd generation)
- **stripe**: v14.21.0 (API version 2023-10-16)
- **resend**: v6.2.0 (email service)

## Quick Reference

**Deploy specific function**:
```bash
firebase deploy --only functions:functionName
```

**View function logs**:
```bash
firebase functions:log --only functionName
```

**Test locally**:
```bash
npm run serve
# Then trigger from emulator UI at localhost:4000
```
