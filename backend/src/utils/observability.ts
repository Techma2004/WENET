import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;
export const sentryEnabled = !!dsn;

export function initSentry() {
  if (!dsn) {
    console.log('[sentry] SENTRY_DSN not set — crash reporting disabled');
    return;
  }
  Sentry.init({ dsn, tracesSampleRate: 0.1, environment: process.env.NODE_ENV || 'development' });
}

export function captureException(err: unknown, context?: Record<string, unknown>) {
  console.error(err);
  if (sentryEnabled) Sentry.captureException(err, context ? { extra: context } : undefined);
}
