import posthog from 'posthog-js';

let enabled = false;

export function initAnalytics() {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) {
    console.log('[analytics] VITE_POSTHOG_KEY not set — analytics disabled');
    return;
  }
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com',
    capture_pageview: false, // this is a single-page chat app - pageviews aren't a meaningful signal
    autocapture: false // no click-tracking on message content or contact names
  });
  enabled = true;
}

// Event names only, no message content, contact names, or chat metadata.
export function track(event: string, properties?: Record<string, unknown>) {
  if (enabled) posthog.capture(event, properties);
}

export function identify(userId: string) {
  if (enabled) posthog.identify(userId);
}

export function resetAnalyticsIdentity() {
  if (enabled) posthog.reset();
}
