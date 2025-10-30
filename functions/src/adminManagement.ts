import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Set or update user role and admin status
 * Can only be called by existing admins
 */
export const setUserRole = onCall(
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

    // Verify caller is an admin
    if (!request.auth.token.admin) {
      throw new HttpsError(
        'permission-denied',
        'Only admins can set user roles'
      );
    }

    const { email, role, isAdmin } = request.data;

    // Validate input
    if (!email || typeof email !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'Valid email address required'
      );
    }

    try {
      // Get user by email
      const user = await admin.auth().getUserByEmail(email.trim());

      // Set custom claims
      await admin.auth().setCustomUserClaims(user.uid, {
        admin: isAdmin === true,
        role: role || (isAdmin ? 'admin' : 'user'),
        updatedBy: request.auth.uid,
        updatedAt: new Date().toISOString(),
      });

      // Log the action for audit trail
      await db.collection('adminLogs').add({
        action: 'role_change',
        targetUser: user.uid,
        targetEmail: email,
        newRole: role,
        isAdmin: isAdmin,
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`Role updated: ${email} → ${isAdmin ? 'admin' : 'user'}`);

      return {
        success: true,
        message: `Role updated for ${email}`,
        uid: user.uid,
      };
    } catch (error: any) {
      logger.error('Error setting user role:', error);

      if (error.code === 'auth/user-not-found') {
        throw new HttpsError(
          'not-found',
          `User with email ${email} not found. Please create the account first in Firebase Console.`
        );
      }

      throw new HttpsError('internal', error.message);
    }
  }
);

/**
 * List all users with admin privileges
 * Can only be called by existing admins
 */
export const listAdmins = onCall(
  { 
    region: 'australia-southeast1',
    cors: true
  },
  async (request) => {
    // Verify caller is an admin
    if (!request.auth?.token.admin) {
      throw new HttpsError(
        'permission-denied',
        'Admin access required'
      );
    }

    try {
      // List all users (paginated for large user bases)
      const listUsersResult = await admin.auth().listUsers(1000);

      // Filter and map admin users
      const admins = listUsersResult.users
        .filter((user) => user.customClaims?.admin === true)
        .map((user) => ({
          uid: user.uid,
          email: user.email || 'No email',
          displayName: user.displayName || null,
          role: user.customClaims?.role || 'admin',
          createdAt: user.metadata.creationTime,
          lastSignIn: user.metadata.lastSignInTime || 'Never',
        }));

      return { admins };
    } catch (error: any) {
      logger.error('Error listing admins:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);

/**
 * Remove admin role from a user
 * Can only be called by existing admins
 */
export const removeAdmin = onCall(
  { 
    region: 'australia-southeast1',
    cors: true
  },
  async (request) => {
    // Verify caller is an admin
    if (!request.auth?.token.admin) {
      throw new HttpsError(
        'permission-denied',
        'Admin access required'
      );
    }

    const { uid } = request.data;

    if (!uid || typeof uid !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'Valid user UID required'
      );
    }

    // Prevent self-removal (keep at least one admin)
    if (uid === request.auth.uid) {
      throw new HttpsError(
        'invalid-argument',
        'Cannot remove your own admin access'
      );
    }

    try {
      const user = await admin.auth().getUser(uid);

      // Remove admin claim
      await admin.auth().setCustomUserClaims(uid, {
        admin: false,
        role: 'user',
        updatedBy: request.auth.uid,
        updatedAt: new Date().toISOString(),
      });

      // Log the action
      await db.collection('adminLogs').add({
        action: 'admin_removed',
        targetUser: uid,
        targetEmail: user.email || 'unknown',
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`Admin removed: ${user.email}`);

      return {
        success: true,
        message: `Admin access removed from ${user.email}`,
      };
    } catch (error: any) {
      logger.error('Error removing admin:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);
