import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { RoleId, createCustomClaims } from './utils/roles';

/**
 * One-time migration script to convert legacy admin users to new role system
 * This should be called by the existing Super Admin to migrate themselves
 */
export const migrateMyAccountToNewSystem = onCall(
  { 
    region: 'australia-southeast1',
    cors: true
  },
  async (request) => {
    // Verify caller is authenticated
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'Must be logged in to perform this action'
      );
    }

    // Verify caller has legacy admin or superAdmin claim
    const hasLegacyAdmin = request.auth.token.admin === true;
    const hasLegacySuperAdmin = request.auth.token.superAdmin === true;
    
    if (!hasLegacyAdmin && !hasLegacySuperAdmin) {
      throw new HttpsError(
        'permission-denied',
        'Only legacy admin users can run this migration'
      );
    }

    // Check if already migrated
    if (request.auth.token.roles && Array.isArray(request.auth.token.roles) && request.auth.token.roles.length > 0) {
      return {
        success: true,
        message: 'Already migrated to new system',
        roles: request.auth.token.roles,
        permissions: request.auth.token.permissions
      };
    }

    try {
      const uid = request.auth.uid;
      const user = await admin.auth().getUser(uid);

      // Determine which role to assign
      let newRoles: RoleId[] = [];
      if (hasLegacySuperAdmin) {
        newRoles = [RoleId.SUPER_ADMIN];
      } else if (hasLegacyAdmin) {
        newRoles = [RoleId.ADMIN];
      }

      // Create new custom claims with roles and permissions
      const customClaims = createCustomClaims(newRoles);

      // Keep superAdmin flag for backward compatibility during transition
      const claimsWithLegacy = {
        ...customClaims,
        superAdmin: hasLegacySuperAdmin || undefined,
        admin: hasLegacyAdmin || undefined,
        migratedAt: new Date().toISOString(),
        migratedFrom: hasLegacySuperAdmin ? 'superAdmin' : 'admin'
      };

      // Set new custom claims
      await admin.auth().setCustomUserClaims(uid, claimsWithLegacy);

      logger.info(`Migrated user ${user.email} to new role system`, {
        uid,
        email: user.email,
        newRoles,
        previousClaim: hasLegacySuperAdmin ? 'superAdmin' : 'admin'
      });

      // Log to Firestore for audit trail
      await admin.firestore().collection('adminLogs').add({
        action: 'account_migrated',
        uid,
        email: user.email,
        oldClaims: hasLegacySuperAdmin ? { superAdmin: true } : { admin: true },
        newRoles,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      return {
        success: true,
        message: `Successfully migrated ${user.email} to new role system`,
        roles: newRoles,
        permissions: customClaims.permissions,
        note: 'Please log out and log back in for changes to take effect'
      };
    } catch (error: any) {
      logger.error('Error migrating admin account:', error);
      throw new HttpsError(
        'internal',
        `Failed to migrate account: ${error.message}`
      );
    }
  }
);
