/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API base URL for a cross-origin deployment; unset uses the dev proxy's same-origin '/api/v1'. */
  readonly VITE_API_BASE_URL?: string;
  /**
   * Mirrors the server's own COVERAGE_DASHBOARD_NO_AUTH — set to 'true' to
   * skip this app's own login/auth check entirely (no GET /auth/me call,
   * ProtectedRoute passes through immediately). Only meaningful when the
   * server this app talks to ALSO has COVERAGE_DASHBOARD_NO_AUTH=true; if
   * only this flag is set, the app renders normally but every request the
   * server actually enforces auth on will still 401. See useAuth.ts.
   */
  readonly VITE_COVERAGE_DASHBOARD_NO_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
