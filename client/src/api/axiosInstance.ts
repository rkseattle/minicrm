/**
 * Shared axios instance.
 * All API modules import from here so that withCredentials (for httpOnly cookie
 * handling) and the base URL are applied consistently.
 */

import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default apiClient;
