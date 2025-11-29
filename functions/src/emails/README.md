# Email System Documentation

This module provides React Email-based templates and a centralized email sending service for the mosque app.

## Previewing Email Templates

You can preview all email templates in your browser using the React Email dev server:

```bash
cd functions
npm install
npm run email:dev
```

This starts a local server at `http://localhost:3000` where you can:
- Browse all email templates
- See live preview with sample data
- View HTML source code
- Test responsive layouts

## Setup Requirements

### 1. Environment Variables / Secrets

The following secrets must be configured in Google Secret Manager and referenced in your Firebase functions:

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | ✅ Yes | API key from [Resend](https://resend.com). Used to send all transactional emails. |
| `STRIPE_SECRET_KEY` | ✅ Yes | Stripe API secret key. Used for creating billing portal sessions. |
| `STRIPE_PORTAL_RETURN_URL` | ❌ Optional | Web URL users are redirected to after leaving the Stripe portal. Defaults to `https://alansar.app/redirect`. |

### 2. Email Configuration

The default email configuration is defined in `components/EmailLayout.tsx`:

```typescript
export const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  mosqueName: "Al Ansar Masjid",      // Full mosque name for email footers
  mosqueShortName: "Al Ansar",         // Short name for email headers
  fromEmail: "donations@alansar.app",  // Sender email address
  supportEmail: "donations@alansar.app", // Reply-to email address
  appDeepLink: "alansar://donations",  // Deep link to open the app
  webRedirectUrl: "https://alansar.app/redirect", // Web URL for redirects
};
```

To customize for a different mosque, update these values directly in `EmailLayout.tsx` or pass a custom config when sending emails.

### 3. Domain Configuration (Resend)

Before sending emails in production:

1. Add and verify your sending domain in [Resend Dashboard](https://resend.com/domains)
2. Configure DNS records (SPF, DKIM, DMARC) as instructed by Resend
3. Ensure the `fromEmail` in your config uses the verified domain

### 4. Web Redirect URL Setup (Optional)

The `webRedirectUrl` is **only used as the return URL for Stripe billing portal sessions** — this is where users land after they finish managing their subscription in Stripe's portal.

**You have two options:**

#### Option A: Use App Deep Link Directly (Simplest)

If you don't have a website, you can use your app's deep link directly as the return URL. Update `STRIPE_PORTAL_RETURN_URL` in your environment:

```
STRIPE_PORTAL_RETURN_URL=alansar://donations
```

Or update `webRedirectUrl` in `EmailLayout.tsx`:
```typescript
webRedirectUrl: "alansar://donations",
```

This works because the portal opens in a browser, and when it redirects to the deep link, the phone will open your app.

#### Option B: Use a Web URL (If You Have a Website)

If you have a website (e.g., via Firebase Hosting), you can set up a redirect page:

```json
// firebase.json
{
  "hosting": {
    "redirects": [
      {
        "source": "/redirect",
        "destination": "alansar://donations",
        "type": 302
      }
    ]
  }
}
```

This approach allows you to handle cases where the app isn't installed (show a download prompt).

### 5. App Deep Link Configuration

The `appDeepLink` (`alansar://donations`) must be configured in your mobile app:

- **iOS**: Add URL scheme to `Info.plist`
- **Android**: Add intent filter to `AndroidManifest.xml`

## Available Email Templates

| Template | Description | When Sent |
|----------|-------------|-----------|
| `OneTimeDonationReceipt` | Receipt for one-time donations | After successful one-time payment |
| `RecurringWelcome` | Welcome email for new subscriptions | When subscription is created |
| `RecurringReceipt` | Receipt for recurring payments | After each recurring payment |
| `PaymentFailed` | Payment failure notification | When a recurring payment fails |
| `SubscriptionCancelled` | Cancellation confirmation | When subscription is cancelled |
| `SubscriptionUpdated` | Update confirmation | When subscription amount/frequency changes |
| `RefundConfirmation` | Refund notification | When a refund is processed |
| `DisputeAlert` | Admin alert for disputes | When a chargeback is filed |
| `ManagementLink` | Instructions to manage subscription | When user requests management access |

## Usage Example

```typescript
import { oneTimeDonationReceipt, sendEmail } from "./utils/emailTemplates";

// Generate email content
const emailData = await oneTimeDonationReceipt({
  donorName: "John Doe",
  amount: 5000,  // in cents
  currency: "aud",
  receiptNumber: "REC-001",
  date: "29 Nov 2024",
  donationType: "General Donation",
});

// Send the email
await sendEmail({
  to: "donor@example.com",
  subject: emailData.subject,
  html: emailData.html,
});
```

## Important Notes

### Portal URLs

Stripe billing portal URLs expire within ~5 minutes. For this reason:

- ❌ **Do NOT** embed portal URLs directly in emails
- ✅ **DO** use the `getSubscriptionPortalUrl` function to generate fresh URLs on-demand
- ✅ **DO** include deep links in emails that open the app's management page

### Email Validation

All email addresses are validated before sending using `isValidEmail()`. Invalid emails will be logged and the send will be skipped.

### Emulator Mode

When running in the Firebase emulator (`FUNCTIONS_EMULATOR=true`), emails are not actually sent. Instead, a success is simulated and logged.

## File Structure

```
src/emails/
├── README.md                    # This file
├── index.ts                     # Main exports
├── emailService.ts              # Email sending utilities
├── components/
│   ├── EmailLayout.tsx          # Base layout and config
│   └── SharedComponents.tsx     # Reusable UI components
└── templates/
    ├── OneTimeDonationReceipt.tsx
    ├── RecurringWelcome.tsx
    ├── RecurringReceipt.tsx
    ├── PaymentFailed.tsx
    ├── SubscriptionCancelled.tsx
    ├── SubscriptionUpdated.tsx
    ├── RefundConfirmation.tsx
    ├── DisputeAlert.tsx
    └── ManagementLink.tsx
```
