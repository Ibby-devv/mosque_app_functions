import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

/**
 * ONE-TIME FUNCTION: Set superAdmin protection on a specific user
 * This should only be called once to protect your first admin account
 */
export const setSuperAdminProtection = onCall(
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

    try {
      const user = await admin.auth().getUser(uid);

      logger.info(`Setting superAdmin protection for: ${user.email}`);
      logger.info(`Current claims: ${JSON.stringify(user.customClaims)}`);

      // Check if already a super admin
      if (user.customClaims?.superAdmin === true) {
        return {
          success: true,
          message: `${user.email} already has super admin protection`,
          alreadyProtected: true,
        };
      }

      // Add superAdmin flag to existing claims
      const newClaims = {
        ...user.customClaims,
        superAdmin: true,
        admin: true,
        role: 'super admin',
        updatedBy: request.auth.uid,
        updatedAt: new Date().toISOString(),
      };

      await admin.auth().setCustomUserClaims(uid, newClaims);

      // Log the action
      await admin.firestore().collection('adminLogs').add({
        action: 'super_admin_protection_added',
        targetUser: uid,
        targetEmail: user.email || 'unknown',
        performedBy: request.auth.uid,
        performedByEmail: request.auth.token.email || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`Super admin protection activated for: ${user.email}`);
      logger.info(`New claims: ${JSON.stringify(newClaims)}`);

      return {
        success: true,
        message: `Super admin protection activated for ${user.email}. This account can no longer be deleted.`,
        claims: newClaims,
      };
    } catch (error: any) {
      logger.error('Error setting super admin protection:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);
