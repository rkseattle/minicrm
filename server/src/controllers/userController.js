/**
 * User controller — handles user management endpoints.
 * All endpoints except setPassword are admin-gated via requireRole middleware.
 * Request/response shaping only — no direct DB access.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  inviteUserSchema,
  setPasswordSchema,
  updateRoleSchema,
} from '@minicrm/shared/schemas/userSchema.js';
import * as userService from '../services/userService.js';

/** bcrypt work factor */
const BCRYPT_SALT_ROUNDS = 12;

/** Invite token expiry — 72 hours */
const INVITE_TOKEN_EXPIRY = '72h';

/**
 * Strips the password_hash field before returning a user object to the client.
 *
 * @param {import('../services/userService.js').UserRow} user
 * @returns {Omit<import('../services/userService.js').UserRow, 'password_hash'>}
 */
function sanitizeUser(user) {
  const { password_hash, ...safeUser } = user;
  return safeUser;
}

/**
 * POST /api/users/invite
 * Admin creates a new user with status='invited'. No password is set yet.
 * Returns the created user and an invite token the admin can share.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export async function inviteUser(req, res) {
  const parseResult = inviteUserSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0].message,
      },
    });
  }

  const { email, name, role } = parseResult.data;

  const existing = await userService.findUserByEmail(email);
  if (existing) {
    return res.status(409).json({
      error: {
        code: 'USER_EMAIL_CONFLICT',
        message: 'A user with that email already exists',
      },
    });
  }

  const user = await userService.createUser({
    email,
    name,
    role,
    passwordHash: null,
    status: 'invited',
  });

  // Generate a short-lived invite token so the invited user can set their password.
  // In a real deployment this token would be embedded in the invite email link.
  const inviteToken = jwt.sign(
    { id: user.id, purpose: 'invite' },
    process.env.JWT_SECRET,
    { expiresIn: INVITE_TOKEN_EXPIRY },
  );

  return res.status(201).json({
    user: sanitizeUser(user),
    inviteToken,
    // Informational: the frontend would construct /set-password?token=<inviteToken>
    setPasswordPath: `/set-password?token=${inviteToken}`,
  });
}

/**
 * GET /api/users
 * Returns all users. Admin only.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export async function listUsers(req, res) {
  const users = await userService.listUsers();
  return res.status(200).json({ users: users.map(sanitizeUser) });
}

/**
 * PATCH /api/users/:id/role
 * Updates a user's role. Admin only.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export async function updateUserRole(req, res) {
  const parseResult = updateRoleSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0].message,
      },
    });
  }

  const { id } = req.params;
  const { role } = parseResult.data;

  const user = await userService.updateUserRole(id, role);
  if (!user) {
    return res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });
  }

  return res.status(200).json({ user: sanitizeUser(user) });
}

/**
 * PATCH /api/users/:id/deactivate
 * Sets user status to 'inactive'. Admin only.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export async function deactivateUser(req, res) {
  const { id } = req.params;

  const user = await userService.updateUserStatus(id, 'inactive');
  if (!user) {
    return res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });
  }

  return res.status(200).json({ user: sanitizeUser(user) });
}

/**
 * PATCH /api/users/:id/reactivate
 * Sets user status to 'active'. Admin only.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export async function reactivateUser(req, res) {
  const { id } = req.params;

  const user = await userService.updateUserStatus(id, 'active');
  if (!user) {
    return res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });
  }

  return res.status(200).json({ user: sanitizeUser(user) });
}

/**
 * POST /api/users/set-password
 * Unauthenticated endpoint. Accepts an invite token and a new password.
 * Verifies the token, hashes the password, sets it, and activates the user.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
export async function setPassword(req, res) {
  const parseResult = setPasswordSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0].message,
      },
    });
  }

  const { token, password } = parseResult.data;

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(400).json({
      error: {
        code: 'AUTH_INVALID_TOKEN',
        message: 'Invite token is invalid or has expired',
      },
    });
  }

  if (decoded.purpose !== 'invite') {
    return res.status(400).json({
      error: { code: 'AUTH_INVALID_TOKEN', message: 'Invalid invite token' },
    });
  }

  const user = await userService.findUserById(decoded.id);
  if (!user) {
    return res.status(404).json({
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    });
  }

  if (user.status !== 'invited') {
    return res.status(409).json({
      error: {
        code: 'USER_ALREADY_ACTIVATED',
        message: 'This account has already been activated',
      },
    });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  await userService.setUserPassword(user.id, passwordHash);
  await userService.updateUserStatus(user.id, 'active');

  return res.status(200).json({ message: 'Password set successfully. You may now log in.' });
}
