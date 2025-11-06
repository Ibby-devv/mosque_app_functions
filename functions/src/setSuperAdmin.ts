import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import {
  RoleId,
  Permission,
  isSuperAdmin,
  createCustomClaims,
  migrateLegacyAdmin,
} from './utils/roles';

/**
 * Set Super Admin protection on a specific user
 * Adds SUPER_ADMIN role which includes all permissions and cannot be removed
 * Only existing Super Admins can call this function
 */
export const setSuperAdminProtection = onCall(
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

    // Verify caller has MANAGE_SUPER_ADMINS permission (only Super Admins have this)
    const callerPermissions = (request.auth.token.permissions as Permission[]) || [];
    if (!callerPermissions.includes(Permission.MANAGE_SUPER_ADMINS)) {
      throw new HttpsError(
        'permission-denied',
        'Only Super Admins can grant Super Admin protection'
      );
    }

    const { uid } = request.data;

    if (!uid || typeof uid !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'Valid user UID required'
      );
    }

    try {
      const user = await admin.auth().getUser(uid);

      logger.info(`Setting Super Admin protection for: ${user.email}`);
      logger.info(`Current claims: ${JSON.stringify(user.customClaims)}`);

      // Get current roles (migrate if using legacy system)
      const currentRoles = (user.customClaims?.roles as RoleId[]) || migrateLegacyAdmin(user.customClaims || {});

      // Check if already a Super Admin
      if (isSuperAdmin(currentRoles)) {
        return {
          success: true,
          message: `${user.email} already has Super Admin protection`,
          alreadyProtected: true,
        };
      }

      // Add SUPER_ADMIN role (replaces all other roles since Super Admin includes everything)
      const newRoles = [RoleId.SUPER_ADMIN];
      const customClaims = createCustomClaims(newRoles);

      const claimsWithMeta = {
        ...customClaims,
        updatedBy: request.auth.uid,
        updatedAt: new Date().toISOString(),
      };

      await admin.auth().setCustomUserClaims(uid, claimsWithMeta);

      // Log the action
      await admin.firestore().collection('adminLogs').add({
        action: 'super_admin_protection_added',
        targetUser: uid,
        targetEmail: user.email || 'unknown',
        previousRoles: currentRoles,
        newRoles: newRoles,
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`Super Admin protection activated for: ${user.email}`);
      logger.info(`New claims: ${JSON.stringify(claimsWithMeta)}`);

      return {
        success: true,
        message: `Super Admin protection activated for ${user.email}. This account now has full system access and cannot be deleted.`,
        roles: newRoles,
        permissions: customClaims.permissions,
      };
    } catch (error: any) {
      logger.error('Error setting Super Admin protection:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);
