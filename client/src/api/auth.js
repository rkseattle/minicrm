/**
 * Auth API module.
 * Wraps the auth endpoints with typed axios calls.
 */

import apiClient from './axiosInstance.js';

/**
 * Sends login credentials and sets the httpOnly session cookie on success.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: object}>}
 */
export async function login(email, password) {
  const response = await apiClient.post('/auth/login', { email, password });
  return response.data;
}

/**
 * Clears the session cookie server-side.
 *
 * @returns {Promise<{message: string}>}
 */
export async function logout() {
  const response = await apiClient.post('/auth/logout');
  return response.data;
}

/**
 * Returns the currently authenticated user.
 * Throws a 401 axios error if not authenticated.
 *
 * @returns {Promise<{user: object}>}
 */
export async function getMe() {
  const response = await apiClient.get('/auth/me');
  return response.data;
}
