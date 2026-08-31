import { PostHog } from 'posthog-node';

const apiKey = process.env.POSTHOG_API_KEY;
let client: PostHog | null = null;

if (apiKey) {
  client = new PostHog(apiKey, { host: process.env.POSTHOG_HOST || 'https://app.posthog.com' });
} else {
  console.log('[analytics] POSTHOG_API_KEY not set — analytics disabled');
}

// Server-side events for things the client can't reliably report itself
// (e.g. registration succeeding even if the browser tab closes right after).
// No message content, contact names, or any chat metadata is ever sent —
// only counts of actions and their type.
export function track(userId: string, event: string, properties?: Record<string, unknown>) {
  client?.capture({ distinctId: userId, event, properties });
}

export async function shutdownAnalytics() {
  await client?.shutdown();
}
