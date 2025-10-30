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
          superAdmin: user.customClaims?.superAdmin === true,
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

      // Check if target user is a super admin
      if (user.customClaims?.superAdmin === true) {
        throw new HttpsError(
          'permission-denied',
          'Cannot remove super admin access. Super admins are permanent.'
        );
      }

      // Check if this is the last admin
      const listUsersResult = await admin.auth().listUsers();
      const admins = listUsersResult.users.filter(
        (u) => u.customClaims?.admin === true
      );

      if (admins.length <= 1) {
        throw new HttpsError(
          'failed-precondition',
          'Cannot remove the last admin. At least one admin must remain.'
        );
      }

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

/**
 * Create a new user account with optional admin access
 * Can only be called by existing admins
 */
export const createUserAccount = onCall(
  { 
    region: 'australia-southeast1',
    cors: true
  },
  async (request) => {
    // Verify caller is an admin
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'Must be logged in to perform this action'
      );
    }

    if (!request.auth.token.admin) {
      throw new HttpsError(
        'permission-denied',
        'Only admins can create user accounts'
      );
    }

    const { email, password, displayName, isAdmin, role } = request.data;

    // Validate inputs
    if (!email || typeof email !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'Valid email address required'
      );
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new HttpsError(
        'invalid-argument',
        'Password must be at least 6 characters'
      );
    }

    try {
      // Create the user account
      const userRecord = await admin.auth().createUser({
        email: email.trim().toLowerCase(),
        password: password,
        displayName: displayName || email.split('@')[0],
        emailVerified: false,
      });

      logger.info(`User account created: ${userRecord.email}`, { 
        uid: userRecord.uid,
        createdBy: request.auth.uid
      });

      // Set custom claims if admin
      if (isAdmin) {
        await admin.auth().setCustomUserClaims(userRecord.uid, {
          admin: true,
          role: role || 'admin',
          createdBy: request.auth.uid,
          createdAt: new Date().toISOString(),
        });

        logger.info(`Admin claim set for: ${userRecord.email}`, { 
          uid: userRecord.uid 
        });
      }

      // Log the action for audit trail
      await db.collection('adminLogs').add({
        action: 'user_created',
        targetUser: userRecord.uid,
        targetEmail: email,
        isAdmin: isAdmin || false,
        role: role || 'user',
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Generate password reset link for user to set their own password
      const resetLink = await admin.auth().generatePasswordResetLink(email);

      logger.info(`Password reset link generated for: ${email}`);

      return {
        success: true,
        message: `Account created successfully for ${email}`,
        uid: userRecord.uid,
        resetLink: resetLink,
      };
    } catch (error: any) {
      logger.error('Error creating user account:', error);

      if (error.code === 'auth/email-already-exists') {
        throw new HttpsError(
          'already-exists',
          'An account with this email already exists'
        );
      }

      if (error.code === 'auth/invalid-email') {
        throw new HttpsError(
          'invalid-argument',
          'Invalid email address format'
        );
      }

      throw new HttpsError('internal', error.message);
    }
  }
);
