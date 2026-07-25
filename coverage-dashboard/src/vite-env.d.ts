/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API base URL for a cross-origin deployment; unset uses the dev proxy's same-origin '/api/v1'. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
