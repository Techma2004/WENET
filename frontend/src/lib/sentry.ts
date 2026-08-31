import * as Sentry from '@sentry/react';

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.log('[sentry] VITE_SENTRY_DSN not set — crash reporting disabled');
    return;
  }
  Sentry.init({ dsn, tracesSampleRate: 0.1, environment: import.meta.env.MODE });
}

export const captureException = Sentry.captureException;
