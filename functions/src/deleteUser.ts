import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { RoleId, isSuperAdmin as checkSuperAdmin } from './utils/roles';

const db = admin.firestore();

/**
 * Delete a user account permanently
 * Can only be called by Super Admins
 * Cannot delete yourself or the last Super Admin
 */
export const deleteUser = onCall(
  {
    region: 'australia-southeast1',
    cors: true,
  },
  async (request) => {
    // Verify caller is authenticated
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'Must be logged in to perform this action'
      );
    }

    const { uid } = request.data;

    // Validate input
    if (!uid || typeof uid !== 'string') {
      throw new HttpsError('invalid-argument', 'Valid user UID required');
    }

    // Only Super Admins can delete users
    const callerRoles = (request.auth.token.roles as RoleId[]) || [];
    const callerIsSuperAdmin =
      request.auth.token.superAdmin === true ||
      request.auth.token.admin === true ||
      checkSuperAdmin(callerRoles);

    if (!callerIsSuperAdmin) {
      throw new HttpsError(
        'permission-denied',
        'Only Super Admins can delete user accounts'
      );
    }

    // Prevent self-deletion
    if (uid === request.auth.uid) {
      throw new HttpsError(
        'invalid-argument',
        'Cannot delete your own account'
      );
    }

    try {
      // Get the user to verify they exist
      const user = await admin.auth().getUser(uid);

      // Check if target is a Super Admin
      const targetRoles = (user.customClaims?.roles as RoleId[]) || [];
      const targetIsSuperAdmin = checkSuperAdmin(targetRoles) || user.customClaims?.superAdmin === true;

      if (targetIsSuperAdmin) {
        // Check if this is the last Super Admin
        const allUsers = await admin.auth().listUsers();
        const superAdmins = allUsers.users.filter((u) => {
          const roles = (u.customClaims?.roles as RoleId[]) || [];
          return checkSuperAdmin(roles) || u.customClaims?.superAdmin === true;
        });

        if (superAdmins.length <= 1) {
          throw new HttpsError(
            'failed-precondition',
            'Cannot delete the last Super Admin. At least one must remain.'
          );
        }
      }

      // Log the action BEFORE deletion for audit trail
      await db.collection('adminLogs').add({
        action: 'user_deleted',
        targetUser: uid,
        targetEmail: user.email || 'unknown',
        targetDisplayName: user.displayName || null,
        targetRoles: targetRoles,
        targetWasSuperAdmin: targetIsSuperAdmin,
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Delete the user from Firebase Auth
      await admin.auth().deleteUser(uid);

      logger.info(`User deleted: ${user.email}`, {
        uid,
        deletedBy: request.auth.uid,
      });

      return {
        success: true,
        message: `User ${user.email} has been permanently deleted`,
        deletedEmail: user.email,
      };
    } catch (error: any) {
      logger.error('Error deleting user:', error);

      if (error.code === 'auth/user-not-found') {
        throw new HttpsError('not-found', `User with UID ${uid} not found`);
      }

      // Re-throw HttpsErrors as-is
      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', error.message);
    }
  }
);
