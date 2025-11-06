/**
 * Shared Role and Permission Utilities for Cloud Functions
 * This file mirrors the frontend role definitions for backend validation
 */

// ============================================================================
// PERMISSIONS (Backend)
// ============================================================================

export enum Permission {
  // Prayer Times & Jumuah
  VIEW_PRAYER_TIMES = 'VIEW_PRAYER_TIMES',
  EDIT_PRAYER_TIMES = 'EDIT_PRAYER_TIMES',
  VIEW_JUMUAH_TIMES = 'VIEW_JUMUAH_TIMES',
  EDIT_JUMUAH_TIMES = 'EDIT_JUMUAH_TIMES',

  // Events
  VIEW_EVENTS = 'VIEW_EVENTS',
  CREATE_EVENTS = 'CREATE_EVENTS',
  EDIT_EVENTS = 'EDIT_EVENTS',
  DELETE_EVENTS = 'DELETE_EVENTS',

  // Donations
  VIEW_DONATIONS = 'VIEW_DONATIONS',
  VIEW_DONATION_ANALYTICS = 'VIEW_DONATION_ANALYTICS',
  EDIT_DONATION_SETTINGS = 'EDIT_DONATION_SETTINGS',
  EXPORT_DONATIONS = 'EXPORT_DONATIONS',

  // Campaigns
  VIEW_CAMPAIGNS = 'VIEW_CAMPAIGNS',
  CREATE_CAMPAIGNS = 'CREATE_CAMPAIGNS',
  EDIT_CAMPAIGNS = 'EDIT_CAMPAIGNS',
  DELETE_CAMPAIGNS = 'DELETE_CAMPAIGNS',

  // Notifications
  VIEW_NOTIFICATIONS = 'VIEW_NOTIFICATIONS',
  SEND_NOTIFICATIONS = 'SEND_NOTIFICATIONS',
  VIEW_NOTIFICATION_HISTORY = 'VIEW_NOTIFICATION_HISTORY',

  // Mosque Settings
  VIEW_MOSQUE_SETTINGS = 'VIEW_MOSQUE_SETTINGS',
  EDIT_MOSQUE_SETTINGS = 'EDIT_MOSQUE_SETTINGS',

  // User Management
  VIEW_USERS = 'VIEW_USERS',
  MANAGE_USERS = 'MANAGE_USERS',
  ASSIGN_ROLES = 'ASSIGN_ROLES',
  MANAGE_SUPER_ADMINS = 'MANAGE_SUPER_ADMINS',
}

// ============================================================================
// ROLE DEFINITIONS (Backend)
// ============================================================================

export enum RoleId {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  PRAYER_MANAGER = 'PRAYER_MANAGER',
  PRAYER_VIEWER = 'PRAYER_VIEWER',
  EVENTS_MANAGER = 'EVENTS_MANAGER',
  EVENTS_EDITOR = 'EVENTS_EDITOR',
  EVENTS_VIEWER = 'EVENTS_VIEWER',
  DONATIONS_MANAGER = 'DONATIONS_MANAGER',
  CAMPAIGN_MANAGER = 'CAMPAIGN_MANAGER',
  DONATIONS_VIEWER = 'DONATIONS_VIEWER',
  NOTIFICATIONS_MANAGER = 'NOTIFICATIONS_MANAGER',
  NOTIFICATIONS_SENDER = 'NOTIFICATIONS_SENDER',
  REPORT_VIEWER = 'REPORT_VIEWER',
}

/**
 * Role to Permissions mapping
 */
export const ROLE_PERMISSIONS: Record<RoleId, Permission[]> = {
  [RoleId.SUPER_ADMIN]: Object.values(Permission), // All permissions

  [RoleId.ADMIN]: [
    // Prayer Times
    Permission.VIEW_PRAYER_TIMES,
    Permission.EDIT_PRAYER_TIMES,
    Permission.VIEW_JUMUAH_TIMES,
    Permission.EDIT_JUMUAH_TIMES,
    // Events
    Permission.VIEW_EVENTS,
    Permission.CREATE_EVENTS,
    Permission.EDIT_EVENTS,
    Permission.DELETE_EVENTS,
    // Donations
    Permission.VIEW_DONATIONS,
    Permission.VIEW_DONATION_ANALYTICS,
    Permission.EDIT_DONATION_SETTINGS,
    Permission.EXPORT_DONATIONS,
    // Campaigns
    Permission.VIEW_CAMPAIGNS,
    Permission.CREATE_CAMPAIGNS,
    Permission.EDIT_CAMPAIGNS,
    Permission.DELETE_CAMPAIGNS,
    // Notifications
    Permission.VIEW_NOTIFICATIONS,
    Permission.SEND_NOTIFICATIONS,
    Permission.VIEW_NOTIFICATION_HISTORY,
    // Mosque Settings
    Permission.VIEW_MOSQUE_SETTINGS,
    Permission.EDIT_MOSQUE_SETTINGS,
    // User Management (but not Super Admin management)
    Permission.VIEW_USERS,
    Permission.MANAGE_USERS,
    Permission.ASSIGN_ROLES,
  ],

  [RoleId.PRAYER_MANAGER]: [
    Permission.VIEW_PRAYER_TIMES,
    Permission.EDIT_PRAYER_TIMES,
    Permission.VIEW_JUMUAH_TIMES,
    Permission.EDIT_JUMUAH_TIMES,
  ],

  [RoleId.PRAYER_VIEWER]: [Permission.VIEW_PRAYER_TIMES, Permission.VIEW_JUMUAH_TIMES],

  [RoleId.EVENTS_MANAGER]: [
    Permission.VIEW_EVENTS,
    Permission.CREATE_EVENTS,
    Permission.EDIT_EVENTS,
    Permission.DELETE_EVENTS,
  ],

  [RoleId.EVENTS_EDITOR]: [Permission.VIEW_EVENTS, Permission.CREATE_EVENTS, Permission.EDIT_EVENTS],

  [RoleId.EVENTS_VIEWER]: [Permission.VIEW_EVENTS],

  [RoleId.DONATIONS_MANAGER]: [
    Permission.VIEW_DONATIONS,
    Permission.VIEW_DONATION_ANALYTICS,
    Permission.EDIT_DONATION_SETTINGS,
    Permission.EXPORT_DONATIONS,
    Permission.VIEW_CAMPAIGNS,
    Permission.CREATE_CAMPAIGNS,
    Permission.EDIT_CAMPAIGNS,
    Permission.DELETE_CAMPAIGNS,
  ],

  [RoleId.CAMPAIGN_MANAGER]: [
    Permission.VIEW_CAMPAIGNS,
    Permission.CREATE_CAMPAIGNS,
    Permission.EDIT_CAMPAIGNS,
    Permission.DELETE_CAMPAIGNS,
  ],

  [RoleId.DONATIONS_VIEWER]: [Permission.VIEW_DONATIONS, Permission.VIEW_DONATION_ANALYTICS],

  [RoleId.NOTIFICATIONS_MANAGER]: [
    Permission.VIEW_NOTIFICATIONS,
    Permission.SEND_NOTIFICATIONS,
    Permission.VIEW_NOTIFICATION_HISTORY,
  ],

  [RoleId.NOTIFICATIONS_SENDER]: [Permission.SEND_NOTIFICATIONS],

  [RoleId.REPORT_VIEWER]: [
    Permission.VIEW_DONATIONS,
    Permission.VIEW_DONATION_ANALYTICS,
    Permission.VIEW_NOTIFICATION_HISTORY,
    Permission.VIEW_EVENTS,
  ],
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get all permissions for a list of role IDs
 */
export function getPermissionsFromRoles(roleIds: RoleId[]): Permission[] {
  const permissionSet = new Set<Permission>();

  roleIds.forEach((roleId) => {
    const permissions = ROLE_PERMISSIONS[roleId];
    if (permissions) {
      permissions.forEach((permission) => {
        permissionSet.add(permission);
      });
    }
  });

  return Array.from(permissionSet);
}

/**
 * Check if a user has a specific permission
 */
export function hasPermission(userPermissions: Permission[], required: Permission): boolean {
  return userPermissions.includes(required);
}

/**
 * Check if user has ANY of the required permissions
 */
export function hasAnyPermission(
  userPermissions: Permission[],
  requiredPermissions: Permission[]
): boolean {
  return requiredPermissions.some((permission) => userPermissions.includes(permission));
}

/**
 * Check if user has ALL of the required permissions
 */
export function hasAllPermissions(
  userPermissions: Permission[],
  requiredPermissions: Permission[]
): boolean {
  return requiredPermissions.every((permission) => userPermissions.includes(permission));
}

/**
 * Validate if role IDs are valid
 */
export function areValidRoles(roleIds: string[]): roleIds is RoleId[] {
  const validRoles = Object.values(RoleId);
  return roleIds.every((role) => validRoles.includes(role as RoleId));
}

/**
 * Check if a user is a Super Admin based on roles
 */
export function isSuperAdmin(roleIds: RoleId[]): boolean {
  return roleIds.includes(RoleId.SUPER_ADMIN);
}

/**
 * Check if user can manage other users
 */
export function canManageUsers(userPermissions: Permission[]): boolean {
  return hasPermission(userPermissions, Permission.MANAGE_USERS);
}

/**
 * Check if user can assign roles
 */
export function canAssignRoles(userPermissions: Permission[]): boolean {
  return hasPermission(userPermissions, Permission.ASSIGN_ROLES);
}

/**
 * Check if user can manage Super Admins
 */
export function canManageSuperAdmins(userPermissions: Permission[]): boolean {
  return hasPermission(userPermissions, Permission.MANAGE_SUPER_ADMINS);
}

/**
 * Validate if a user can assign specific roles
 * Users cannot grant permissions they don't have
 */
export function canUserAssignRoles(
  assignerPermissions: Permission[],
  rolesToAssign: RoleId[]
): { canAssign: boolean; reason?: string } {
  // Super Admin check
  if (hasPermission(assignerPermissions, Permission.MANAGE_SUPER_ADMINS)) {
    return { canAssign: true };
  }

  // Check if trying to assign Super Admin role
  if (rolesToAssign.includes(RoleId.SUPER_ADMIN)) {
    return {
      canAssign: false,
      reason: 'Only Super Admins can assign Super Admin role',
    };
  }

  // Get all permissions that would be granted
  const permissionsToGrant = getPermissionsFromRoles(rolesToAssign);

  // Check if assigner has all permissions they're trying to grant
  const missingPermissions = permissionsToGrant.filter(
    (permission) => !assignerPermissions.includes(permission)
  );

  if (missingPermissions.length > 0) {
    return {
      canAssign: false,
      reason: `Cannot grant permissions you don't have: ${missingPermissions.join(', ')}`,
    };
  }

  return { canAssign: true };
}

/**
 * Create custom claims object for Firebase Auth
 */
export function createCustomClaims(roleIds: RoleId[]): {
  roles: RoleId[];
  permissions: Permission[];
  isSuperAdmin: boolean;
  admin: boolean; // Legacy support
} {
  const permissions = getPermissionsFromRoles(roleIds);
  const isSuperAdminUser = isSuperAdmin(roleIds);

  return {
    roles: roleIds,
    permissions,
    isSuperAdmin: isSuperAdminUser,
    // Legacy support - maintain old admin claim for backward compatibility
    admin: roleIds.length > 0, // Anyone with roles has dashboard access
  };
}

/**
 * Migrate legacy admin claim to new role system
 */
export function migrateLegacyAdmin(oldClaims: any): RoleId[] {
  // If user has new roles system, use it
  if (oldClaims.roles && Array.isArray(oldClaims.roles)) {
    return oldClaims.roles;
  }

  // If user has old superAdmin claim, make them Super Admin
  if (oldClaims.superAdmin === true) {
    return [RoleId.SUPER_ADMIN];
  }

  // If user has old admin claim, make them Admin
  if (oldClaims.admin === true) {
    return [RoleId.ADMIN];
  }

  // No roles
  return [];
}
