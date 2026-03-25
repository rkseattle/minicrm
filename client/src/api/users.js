/**
 * Users API module.
 * Wraps the user management endpoints. All write endpoints are admin-only;
 * that restriction is enforced server-side.
 */

import apiClient from './axiosInstance.js';

/**
 * Returns all users. Admin only.
 *
 * @returns {Promise<{users: object[]}>}
 */
export async function listUsers() {
  const response = await apiClient.get('/users');
  return response.data;
}

/**
 * Invites a new user. Admin only.
 *
 * @param {{ email: string, name: string, role: 'admin'|'rep' }} data
 * @returns {Promise<{user: object, inviteToken: string, setPasswordPath: string}>}
 */
export async function inviteUser(data) {
  const response = await apiClient.post('/users/invite', data);
  return response.data;
}

/**
 * Updates a user's role. Admin only.
 *
 * @param {string} id - User UUID
 * @param {'admin'|'rep'} role
 * @returns {Promise<{user: object}>}
 */
export async function updateUserRole(id, role) {
  const response = await apiClient.patch(`/users/${id}/role`, { role });
  return response.data;
}

/**
 * Deactivates a user. Admin only.
 *
 * @param {string} id - User UUID
 * @returns {Promise<{user: object}>}
 */
export async function deactivateUser(id) {
  const response = await apiClient.patch(`/users/${id}/deactivate`);
  return response.data;
}

/**
 * Reactivates a previously deactivated user. Admin only.
 *
 * @param {string} id - User UUID
 * @returns {Promise<{user: object}>}
 */
export async function reactivateUser(id) {
  const response = await apiClient.patch(`/users/${id}/reactivate`);
  return response.data;
}

/**
 * Sets the password for an invited user using their invite token.
 * This is an unauthenticated endpoint.
 *
 * @param {string} token - The JWT from the invite link
 * @param {string} password - The new password (min 8 characters)
 * @returns {Promise<{message: string}>}
 */
export async function setPassword(token, password) {
  const response = await apiClient.post('/users/set-password', { token, password });
  return response.data;
}
