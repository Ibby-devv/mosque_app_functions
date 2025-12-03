import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { sendEmail } from './utils/emailTemplates';
import {
  RoleId,
  Permission,
  getPermissionsFromRoles,
  canUserAssignRoles,
  isSuperAdmin,
  canManageUsers,
  canAssignRoles,
  areValidRoles,
  createCustomClaims,
  migrateLegacyAdmin,
} from './utils/roles';

const db = admin.firestore();

/**
 * Set or update user roles (replaces setUserRole)
 * Accepts multiple roles and calculates permissions
 * Can only be called by users with MANAGE_USERS and ASSIGN_ROLES permissions
 */
export const setUserRoles = onCall(
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

    // Get caller's permissions (derive from legacy claims if needed)
    let callerPermissions = (request.auth.token.permissions as Permission[]) || [];
    const callerIsSuperAdmin = request.auth.token.superAdmin === true || 
                               request.auth.token.admin === true; // Backward compatibility
    
    // If no permissions but has legacy admin claim, derive permissions from roles
    if (callerPermissions.length === 0 && callerIsSuperAdmin) {
      const legacyRoles = migrateLegacyAdmin(request.auth.token);
      callerPermissions = getPermissionsFromRoles(legacyRoles);
    }
    
    // Verify caller can manage users
    if (!canManageUsers(callerPermissions) || !canAssignRoles(callerPermissions)) {
      throw new HttpsError(
        'permission-denied',
        'You do not have permission to manage user roles'
      );
    }

    const { email, roles } = request.data;

    // Validate input
    if (!email || typeof email !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'Valid email address required'
      );
    }

    if (!roles || !Array.isArray(roles)) {
      throw new HttpsError(
        'invalid-argument',
        'Roles must be provided as an array'
      );
    }

    // Validate role IDs
    if (!areValidRoles(roles)) {
      throw new HttpsError(
        'invalid-argument',
        'Invalid role IDs provided'
      );
    }

    // Check if caller can assign these specific roles (Super Admins can assign any role)
    if (!callerIsSuperAdmin) {
      const assignCheck = canUserAssignRoles(callerPermissions, roles as RoleId[]);
      if (!assignCheck.canAssign) {
        throw new HttpsError(
          'permission-denied',
          assignCheck.reason || 'Cannot assign these roles'
        );
      }
    }

    try {
      // Get user by email
      const user = await admin.auth().getUserByEmail(email.trim());

      // Create custom claims with roles and permissions
      const customClaims = createCustomClaims(roles as RoleId[]);

      // Add metadata for audit trail
      const claimsWithMeta = {
        ...customClaims,
        updatedBy: request.auth.uid,
        updatedAt: new Date().toISOString(),
      };

      // Set custom claims
      await admin.auth().setCustomUserClaims(user.uid, claimsWithMeta);

      // Log the action for audit trail
      await db.collection('adminLogs').add({
        action: 'roles_updated',
        targetUser: user.uid,
        targetEmail: email,
        newRoles: roles,
        newPermissions: customClaims.permissions,
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`Roles updated: ${email} → ${roles.join(', ')}`);

      return {
        success: true,
        message: `Roles updated for ${email}`,
        uid: user.uid,
        roles: roles,
        permissions: customClaims.permissions,
      };
    } catch (error: any) {
      logger.error('Error setting user roles:', error);

      if (error.code === 'auth/user-not-found') {
        throw new HttpsError(
          'not-found',
          `User with email ${email} not found. Please create the account first.`
        );
      }

      throw new HttpsError('internal', error.message);
    }
  }
);

/**
 * Legacy function - redirects to setUserRoles for backward compatibility
 * @deprecated Use setUserRoles instead
 */
export const setUserRole = onCall(
  { 
    region: 'australia-southeast1',
    cors: true
  },
  async (request) => {
    // Convert old format to new format
    const { email, role, isAdmin } = request.data;
    
    let roles: RoleId[] = [];
    
    if (isAdmin) {
      // Old "admin" becomes "Admin" role
      roles = [RoleId.ADMIN];
    } else if (role) {
      // Try to map old role string to new RoleId
      roles = [role as RoleId];
    }

    // Call new function
    return setUserRoles.run({
      ...request,
      data: { email, roles },
    });
  }
);

/**
 * List all users with dashboard access (users with roles)
 * Can only be called by users with VIEW_USERS permission
 */
export const listUsers = onCall(
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

    // Get caller's permissions
    const callerPermissions = (request.auth.token.permissions as Permission[]) || [];
    const callerIsSuperAdmin = request.auth.token.superAdmin === true || 
                               request.auth.token.admin === true; // Backward compatibility
    
    // Verify caller can view users (Super Admins always can)
    if (!callerIsSuperAdmin && !canManageUsers(callerPermissions)) {
      throw new HttpsError(
        'permission-denied',
        'You do not have permission to view users'
      );
    }

    try {
      const includeAll: boolean = request.data?.includeAll === true;
      // List all users (paginated for large user bases)
      const listUsersResult = await admin.auth().listUsers(1000);

      // Optionally filter to only dashboard users unless includeAll is set
      const sourceUsers = includeAll
        ? listUsersResult.users
        : listUsersResult.users.filter((user) => {
            // Include users with new roles system
            if (user.customClaims?.roles && Array.isArray(user.customClaims.roles) && user.customClaims.roles.length > 0) {
              return true;
            }
            // Include users with legacy admin claim
            if (user.customClaims?.admin === true) {
              return true;
            }
            return false;
          });

      const users = sourceUsers.map((user) => {
        // Migrate legacy claims if needed
        const roles = user.customClaims?.roles || migrateLegacyAdmin(user.customClaims || {});
        const permissions = user.customClaims?.permissions || getPermissionsFromRoles(roles);

        return {
          uid: user.uid,
          email: user.email || 'No email',
          displayName: user.displayName || null,
          photoURL: user.photoURL || null,
          roles: roles,
          permissions: permissions,
          isSuperAdmin: isSuperAdmin(roles),
          createdAt: user.metadata.creationTime,
          lastSignIn: user.metadata.lastSignInTime || 'Never',
          emailVerified: user.emailVerified === true,
        };
      });

      return { users };
    } catch (error: any) {
      logger.error('Error listing users:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);

/**
 * Legacy function - redirects to listUsers
 * @deprecated Use listUsers instead
 */
export const listAdmins = onCall(
  { 
    region: 'australia-southeast1',
    cors: true
  },
  async (request) => {
    return listUsers.run(request);
  }
);

/**
 * Remove specific roles or all roles from a user
 * Can only be called by users with MANAGE_USERS permission
 */
export const removeUserRoles = onCall(
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

    // Get caller's permissions
    const callerPermissions = (request.auth.token.permissions as Permission[]) || [];
    const callerIsSuperAdmin = request.auth.token.superAdmin === true || 
                               request.auth.token.admin === true; // Backward compatibility
    
    // Verify caller can manage users (Super Admins always can)
    if (!callerIsSuperAdmin && (!canManageUsers(callerPermissions) || !canAssignRoles(callerPermissions))) {
      throw new HttpsError(
        'permission-denied',
        'You do not have permission to manage user roles'
      );
    }

    const { uid, rolesToRemove } = request.data;

    if (!uid || typeof uid !== 'string') {
      throw new HttpsError(
        'invalid-argument',
        'Valid user UID required'
      );
    }

    // Prevent self-removal
    if (uid === request.auth.uid) {
      throw new HttpsError(
        'invalid-argument',
        'Cannot remove your own roles'
      );
    }

    try {
      const user = await admin.auth().getUser(uid);
      const currentRoles = (user.customClaims?.roles as RoleId[]) || migrateLegacyAdmin(user.customClaims || {});

      // Check if target user is a super admin
      if (isSuperAdmin(currentRoles)) {
        // Only Super Admins can remove Super Admin role
        if (!callerPermissions.includes(Permission.MANAGE_SUPER_ADMINS)) {
          throw new HttpsError(
            'permission-denied',
            'Only Super Admins can remove Super Admin role'
          );
        }

        // Check if this is the last Super Admin
        const allUsers = await admin.auth().listUsers();
        const superAdmins = allUsers.users.filter((u) => {
          const roles = (u.customClaims?.roles as RoleId[]) || migrateLegacyAdmin(u.customClaims || {});
          return isSuperAdmin(roles);
        });

        if (superAdmins.length <= 1) {
          throw new HttpsError(
            'failed-precondition',
            'Cannot remove the last Super Admin. At least one must remain.'
          );
        }
      }

      let newRoles: RoleId[];

      if (rolesToRemove && Array.isArray(rolesToRemove)) {
        // Remove specific roles
        newRoles = currentRoles.filter((role: RoleId) => !rolesToRemove.includes(role));
      } else {
        // Remove all roles
        newRoles = [];
      }

      // Create custom claims with new roles
      const customClaims = newRoles.length > 0 
        ? createCustomClaims(newRoles)
        : { roles: [], permissions: [], isSuperAdmin: false, admin: false };

      // Add metadata
      const claimsWithMeta = {
        ...customClaims,
        updatedBy: request.auth.uid,
        updatedAt: new Date().toISOString(),
      };

      // Update custom claims
      await admin.auth().setCustomUserClaims(uid, claimsWithMeta);

      // Log the action
      await db.collection('adminLogs').add({
        action: 'roles_removed',
        targetUser: uid,
        targetEmail: user.email || 'unknown',
        removedRoles: rolesToRemove || 'all',
        newRoles: newRoles,
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`Roles removed from: ${user.email}`);

      return {
        success: true,
        message: `Roles removed from ${user.email}`,
        newRoles: newRoles,
      };
    } catch (error: any) {
      logger.error('Error removing roles:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);

/**
 * Legacy function - redirects to removeUserRoles
 * @deprecated Use removeUserRoles instead
 */
export const removeAdmin = onCall(
  { 
    region: 'australia-southeast1',
    cors: true
  },
  async (request) => {
    // Remove all roles (legacy behavior)
    return removeUserRoles.run({
      ...request,
      data: { uid: request.data.uid, rolesToRemove: null },
    });
  }
);

/**
 * Create a new user account with specific roles
 * Can only be called by users with MANAGE_USERS permission
 */
export const createUserAccount = onCall(
  { 
    region: 'australia-southeast1',
    cors: true,
    secrets: ['RESEND_API_KEY']
  },
  async (request) => {
    // Verify caller is authenticated
    if (!request.auth) {
      throw new HttpsError(
        'unauthenticated',
        'Must be logged in to perform this action'
      );
    }

    // Get caller's permissions
    const callerPermissions = (request.auth.token.permissions as Permission[]) || [];
    const callerIsSuperAdmin = request.auth.token.superAdmin === true || 
                               request.auth.token.admin === true; // Backward compatibility
    
    // Verify caller can manage users (Super Admins always can)
    if (!callerIsSuperAdmin && !canManageUsers(callerPermissions)) {
      throw new HttpsError(
        'permission-denied',
        'You do not have permission to create user accounts'
      );
    }

    const { email, password, displayName, roles } = request.data;

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

    // Validate roles if provided
    let rolesToAssign: RoleId[] = [];
    if (roles && Array.isArray(roles)) {
      if (!areValidRoles(roles)) {
        throw new HttpsError(
          'invalid-argument',
          'Invalid role IDs provided'
        );
      }
      rolesToAssign = roles as RoleId[];

      // Check if caller can assign these roles (Super Admins can assign any role)
      if (!callerIsSuperAdmin) {
        const assignCheck = canUserAssignRoles(callerPermissions, rolesToAssign);
        if (!assignCheck.canAssign) {
          throw new HttpsError(
            'permission-denied',
            assignCheck.reason || 'Cannot assign these roles'
          );
        }
      }
    } else {
      // Legacy support: check isAdmin parameter
      const { isAdmin } = request.data;
      if (isAdmin === true) {
        rolesToAssign = [RoleId.ADMIN];
      }
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

      // Set custom claims if roles provided
      if (rolesToAssign.length > 0) {
        const customClaims = createCustomClaims(rolesToAssign);
        const claimsWithMeta = {
          ...customClaims,
          createdBy: request.auth.uid,
          createdAt: new Date().toISOString(),
        };

        await admin.auth().setCustomUserClaims(userRecord.uid, claimsWithMeta);

        logger.info(`Roles assigned to new user: ${userRecord.email}`, { 
          uid: userRecord.uid,
          roles: rolesToAssign
        });
      }

      // Log the action for audit trail
      await db.collection('adminLogs').add({
        action: 'user_created',
        targetUser: userRecord.uid,
        targetEmail: email,
        roles: rolesToAssign,
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Generate password reset link for user to set their own password
      const continueUrl = request.data?.continueUrl || 'https://alansar.app';
      const resetLink = await admin.auth().generatePasswordResetLink(email, { url: continueUrl });

      logger.info(`Password reset link generated for: ${email}`);

      // Also generate email verification link
      const verifyLink = await admin.auth().generateEmailVerificationLink(email, { url: continueUrl });

      // Send onboarding email via Resend
      const html = `
        <div style="font-family: Arial, sans-serif; line-height:1.5;">
          <h2>Welcome to Al-Ansar Masjid Admin Dashboard</h2>
          <p>Hello ${displayName || email},</p>
          <p>Your admin account has been created. For security, please complete these two steps:</p>
          <ol>
            <li><strong>Set your password</strong>: <a href="${resetLink}">Open password setup link</a></li>
            <li><strong>Verify your email</strong>: <a href="${verifyLink}">Verify your email address</a></li>
          </ol>
          <p>If a link has expired, ask an admin to resend your invite or try the password reset from the login page.</p>
          <p>Dashboard: <a href="${continueUrl}">${continueUrl}</a></p>
          <p>Regards,<br/>Al-Ansar Masjid Team</p>
        </div>
      `;

      const emailSent = await sendEmail({
        to: email,
        subject: 'Your Admin Dashboard Access',
        html,
      });

      // Log email send status
      await db.collection('adminLogs').add({
        action: 'invite_sent',
        targetUser: userRecord.uid,
        targetEmail: email,
        emailSent,
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        message: `Account created successfully for ${email}`,
        uid: userRecord.uid,
        resetLink: resetLink,
        verifyLink: verifyLink,
        roles: rolesToAssign,
        inviteEmailSent: emailSent,
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

/**
 * Send onboarding email to an existing user (password setup + verify email)
 */
export const sendAdminOnboardingEmail = onCall(
  {
    region: 'australia-southeast1',
    cors: true,
    secrets: ['RESEND_API_KEY']
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const callerPermissions = (request.auth.token.permissions as Permission[]) || [];
    const callerIsSuperAdmin = request.auth.token.superAdmin === true || request.auth.token.admin === true;
    if (!callerIsSuperAdmin && !canManageUsers(callerPermissions)) {
      throw new HttpsError('permission-denied', 'You do not have permission');
    }

    const { email, continueUrl } = request.data || {};
    if (!email || typeof email !== 'string') {
      throw new HttpsError('invalid-argument', 'Valid email required');
    }

    try {
      const user = await admin.auth().getUserByEmail(email.trim());
      const targetUrl = continueUrl || 'https://alansar.app';
      const resetLink = await admin.auth().generatePasswordResetLink(email.trim(), { url: targetUrl });
      const verifyLink = await admin.auth().generateEmailVerificationLink(email.trim(), { url: targetUrl });

      const html = `
        <div style="font-family: Arial, sans-serif; line-height:1.5;">
          <h2>Admin Access Instructions</h2>
          <p>Hello ${user.displayName || email},</p>
          <p>Please set your password and verify your email:</p>
          <ul>
            <li><a href="${resetLink}">Set your password</a></li>
            <li><a href="${verifyLink}">Verify your email</a></li>
          </ul>
          <p>If links expire, contact an administrator.</p>
        </div>
      `;

      const emailSent = await sendEmail({ to: email.trim(), subject: 'Admin Onboarding', html });

      await db.collection('adminLogs').add({
        action: 'invite_sent',
        targetUser: user.uid,
        targetEmail: email.trim(),
        emailSent,
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, emailSent };
    } catch (error: any) {
      logger.error('Error sending onboarding email:', error);
      if (error.code === 'auth/user-not-found') {
        throw new HttpsError('not-found', `User with email ${email} not found`);
      }
      throw new HttpsError('internal', error.message);
    }
  }
);

/**
 * Resend onboarding invite (rate limit can be added later)
 */
export const resendAdminInvite = onCall(
  {
    region: 'australia-southeast1',
    cors: true
  },
  async (request) => {
    return sendAdminOnboardingEmail.run(request);
  }
);

/**
 * Send a password reset email to a user
 */
export const sendPasswordReset = onCall(
  {
    region: 'australia-southeast1',
    cors: true,
    secrets: ['RESEND_API_KEY']
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const callerPermissions = (request.auth.token.permissions as Permission[]) || [];
    const callerIsSuperAdmin = request.auth.token.superAdmin === true || request.auth.token.admin === true;
    if (!callerIsSuperAdmin && !canManageUsers(callerPermissions)) {
      throw new HttpsError('permission-denied', 'You do not have permission');
    }

    const { email } = request.data || {};
    if (!email || typeof email !== 'string') {
      throw new HttpsError('invalid-argument', 'Valid email required');
    }

    try {
      const user = await admin.auth().getUserByEmail(email.trim());
      const resetLink = await admin.auth().generatePasswordResetLink(email.trim(), { url: 'https://alansar.app' });

      const html = `<div style="font-family: Arial, sans-serif;">
        <p>Hello ${user.displayName || email},</p>
        <p>You requested a password reset. Click below:</p>
        <p><a href="${resetLink}">Reset your password</a></p>
      </div>`;

      const emailSent = await sendEmail({ to: email.trim(), subject: 'Password Reset', html });

      await db.collection('adminLogs').add({
        action: 'password_reset_sent',
        targetUser: user.uid,
        targetEmail: email.trim(),
        emailSent,
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, emailSent };
    } catch (error: any) {
      logger.error('Error sending password reset:', error);
      if (error.code === 'auth/user-not-found') {
        throw new HttpsError('not-found', `User with email ${email} not found`);
      }
      throw new HttpsError('internal', error.message);
    }
  }
);

/**
 * Send an email verification link to a user
 */
export const sendEmailVerification = onCall(
  {
    region: 'australia-southeast1',
    cors: true,
    secrets: ['RESEND_API_KEY']
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const callerPermissions = (request.auth.token.permissions as Permission[]) || [];
    const callerIsSuperAdmin = request.auth.token.superAdmin === true || request.auth.token.admin === true;
    if (!callerIsSuperAdmin && !canManageUsers(callerPermissions)) {
      throw new HttpsError('permission-denied', 'You do not have permission');
    }

    const { email, continueUrl } = request.data || {};
    if (!email || typeof email !== 'string') {
      throw new HttpsError('invalid-argument', 'Valid email required');
    }

    try {
      const user = await admin.auth().getUserByEmail(email.trim());
      const verifyLink = await admin.auth().generateEmailVerificationLink(email.trim(), { url: continueUrl || 'https://alansar.app' });

      const html = `<div style="font-family: Arial, sans-serif;">
        <p>Hello ${user.displayName || email},</p>
        <p>Please verify your email address to access admin features.</p>
        <p><a href="${verifyLink}">Verify your email</a></p>
      </div>`;

      const emailSent = await sendEmail({ to: email.trim(), subject: 'Verify your email', html });

      await db.collection('adminLogs').add({
        action: 'verification_sent',
        targetUser: user.uid,
        targetEmail: email.trim(),
        emailSent,
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, emailSent };
    } catch (error: any) {
      logger.error('Error sending verification:', error);
      if (error.code === 'auth/user-not-found') {
        throw new HttpsError('not-found', `User with email ${email} not found`);
      }
      throw new HttpsError('internal', error.message);
    }
  }
);
