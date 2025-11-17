# GitHub Actions Deployment Setup

This repository is configured to automatically deploy Firebase Cloud Functions when changes are pushed to the `main` branch.

## Workflow Overview

The deployment workflow (`.github/workflows/deploy-functions.yml`) will:
1. Trigger on pushes to `main` that affect:
   - `functions/**` directory
   - `firebase.json`
   - `.firebaserc`
   - The workflow file itself
2. Set up Node.js 20 environment
3. Install dependencies using `npm ci`
4. Build TypeScript code with `npm run build`
5. Deploy functions to Firebase using `firebase deploy --only functions`

## Required Secrets

To enable automatic deployment, you need to configure the following secret in your GitHub repository:

### FIREBASE_SERVICE_ACCOUNT

This secret should contain the Firebase service account JSON key.

#### How to create and configure:

1. **Generate a Firebase Service Account Key:**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Select your project (`al-madina-masjid-app`)
   - Go to Project Settings → Service Accounts
   - Click "Generate New Private Key"
   - Save the JSON file securely

2. **Add the secret to GitHub:**
   - Go to your GitHub repository settings
   - Navigate to Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: Paste the entire contents of the JSON file
   - Click "Add secret"

## Testing the Workflow

Once the secret is configured:
1. Make a change to any file in the `functions/` directory
2. Commit and push to the `main` branch
3. Go to the "Actions" tab in your GitHub repository
4. You should see the "Deploy Firebase Functions" workflow running
5. Click on the workflow run to see detailed logs

## Manual Deployment

You can still deploy manually using:
```bash
cd functions
npm run deploy
```

## Security Notes

- The service account key provides full access to your Firebase project
- Never commit the service account JSON file to the repository
- Keep the GitHub secret secure and only share with trusted team members
- Regularly rotate service account keys as a security best practice
- Consider using Workload Identity Federation for enhanced security in production environments

## Troubleshooting

### Build Failures
If the build fails, check:
- TypeScript errors in the code
- Missing dependencies in `package.json`
- Node.js version compatibility

### Deployment Failures
If deployment fails, verify:
- `FIREBASE_SERVICE_ACCOUNT` secret is correctly configured
- The service account has necessary permissions
- Firebase project ID matches `.firebaserc` configuration
- No conflicting deployments are in progress

## Workflow Customization

To modify the deployment behavior, edit `.github/workflows/deploy-functions.yml`:
- Change trigger branches
- Modify path filters
- Add additional build steps
- Configure deployment options
