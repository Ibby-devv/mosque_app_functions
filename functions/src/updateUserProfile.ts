import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { Permission, canManageUsers } from './utils/roles';

const db = admin.firestore();

/**
 * Update user profile information (display name, photo URL)
 * Users can update their own profile, or Super Admins can update any profile
 */
export const updateUserProfile = onCall(
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

    const { uid, displayName, photoURL } = request.data;

    // Validate input
    if (!uid || typeof uid !== 'string') {
      throw new HttpsError('invalid-argument', 'Valid user UID required');
    }

    // Check permissions: users can update their own profile, or must have MANAGE_USERS permission
    const isOwnProfile = uid === request.auth.uid;
    const callerPermissions = (request.auth.token.permissions as Permission[]) || [];
    const callerIsSuperAdmin =
      request.auth.token.superAdmin === true || request.auth.token.admin === true;

    if (!isOwnProfile && !callerIsSuperAdmin && !canManageUsers(callerPermissions)) {
      throw new HttpsError(
        'permission-denied',
        'You do not have permission to update other users'
      );
    }

    // Validate fields
    const updates: { displayName?: string; photoURL?: string | null } = {};

    if (displayName !== undefined) {
      if (typeof displayName !== 'string' || displayName.trim().length === 0) {
        throw new HttpsError('invalid-argument', 'Display name must be a non-empty string');
      }
      updates.displayName = displayName.trim();
    }

    if (photoURL !== undefined) {
      if (photoURL !== null && typeof photoURL !== 'string') {
        throw new HttpsError('invalid-argument', 'Photo URL must be a string or null');
      }
      updates.photoURL = photoURL;
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpsError('invalid-argument', 'No valid fields to update');
    }

    try {
      // Get the user to verify they exist
      const user = await admin.auth().getUser(uid);

      // Update the user profile
      await admin.auth().updateUser(uid, updates);

      // Log the action for audit trail
      await db.collection('adminLogs').add({
        action: 'profile_updated',
        targetUser: uid,
        targetEmail: user.email || 'unknown',
        updates: updates,
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`Profile updated for: ${user.email}`, { uid, updates });

      return {
        success: true,
        message: `Profile updated successfully`,
        uid: uid,
        updates: updates,
      };
    } catch (error: any) {
      logger.error('Error updating user profile:', error);

      if (error.code === 'auth/user-not-found') {
        throw new HttpsError('not-found', `User with UID ${uid} not found`);
      }

      throw new HttpsError('internal', error.message);
    }
  }
);
