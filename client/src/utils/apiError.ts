import type { TFunction } from 'i18next';
import type { AxiosError } from 'axios';

interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Resolves a localized error message from an Axios API error.
 *
 * Looks up `errors.<code>` in the i18n catalog; falls back to `fallbackKey`
 * (default: `errors.generic`) for unknown codes, missing responses, or
 * non-Axios errors. (MINCRM-354)
 */
export function resolveApiError(
  error: unknown,
  t: TFunction,
  fallbackKey = 'errors.generic',
): string {
  const axiosError = error as AxiosError<ApiErrorBody>;
  const code = axiosError?.response?.data?.error?.code;
  if (code) {
    const translated = t(`errors.${code}`, { defaultValue: '' });
    if (translated) return translated;
  }
  return t(fallbackKey);
}
