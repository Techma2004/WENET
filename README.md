# WENET

A WhatsApp-style chat app: Node/Express/Socket.io/Prisma backend + a React web
frontend that adapts between a two-pane desktop layout and a single-pane
mobile layout, like WhatsApp Web / the WhatsApp phone app.

```
backend/    Express + Socket.io + Prisma (Postgres) API
frontend/   Vite + React + TypeScript web client  (folder: wenet-web in this zip)
render.yaml Render blueprint for the backend
```

## How messages are encrypted

Every account has an ECDH (P-256) keypair, generated in the browser on
registration. The public key is stored on the server (`User.publicKey`); the
private key is generated and stored **only** in that browser's
`localStorage` and is never sent anywhere.

- **1:1 chats**: both sides derive the same AES-GCM key from
  (my private key + their public key) via ECDH. The server only ever sees
  ciphertext in `Message.encryptedPayload`.
- **Groups**: the creator generates one random AES-256 key for the group,
  then wraps (encrypts) a copy of it individually for each member using the
  same ECDH trick, and sends each wrapped copy over the socket
  (`client:share_group_key`) directly to that member. A member who doesn't
  have the key yet (new device, joined while offline) can ask the room
  (`client:request_group_key`); any online member who already holds it
  answers them directly.

This is real key-agreement encryption, not just "looks encrypted" - but it
is **not** the full Signal double-ratchet protocol: there's no per-message
key rotation or forward secrecy, and losing the browser's `localStorage`
(clearing site data, switching browsers) loses access to old message
history for that device. Good enough for a personal project; worth
revisiting before this holds real conversations at scale.

## Environment variables

Everything the app reads from the environment is documented in
`backend/.env.example` and `frontend/.env.example` — copy each to `.env`
and fill it in. Nothing is required beyond what's listed there.

Backend, quick summary:
| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres/Neon connection string |
| `JWT_SECRET` | yes | Signs login tokens, hashes phone numbers |
| `CORS_ORIGIN` | yes in prod | Comma-separated allowed frontend origins |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | yes for media | Photo/video uploads |
| `FCM_SERVICE_ACCOUNT_JSON` | no | Push notifications when a recipient is offline |
| `PORT` | no | Render sets this itself |

Frontend:
| Variable | Required | Purpose |
|---|---|---|
| `VITE_API_URL` | yes | Base URL of your deployed backend |

## Running locally

```bash
# backend
cd backend
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET at minimum
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev             # http://localhost:10000

# frontend, in a second terminal
cd frontend
cp .env.example .env    # VITE_API_URL=http://localhost:10000
npm install
npm run dev              # http://localhost:5173
```

## Deploying

1. Push `backend/` and `render.yaml` to your repo, connect it on Render. Fill
   in the env vars listed above (Render will generate `JWT_SECRET` for you).
2. Deploy `frontend/` anywhere that serves a static Vite build (Render
   Static Site, Vercel, Netlify, Cloudflare Pages). Set `VITE_API_URL` to
   your backend's Render URL at build time.
3. Once both are live, set the backend's `CORS_ORIGIN` to your frontend's
   real URL and redeploy the backend.

## What's wired up vs. what's left

Built and working: register/login, 1:1 chat, group chat, real-time delivery
and typing indicators, online/offline presence, offline push notification
fallback (if FCM is configured), responsive desktop/mobile layout, a
Contacts tab (find by username or exact phone number, save/remove).

The backend also has a working REST route for status/stories (`/api/status`)
that this frontend doesn't have a screen for yet.

## How people find each other

Two ways, both under the Contacts tab:

- **By username** — live search as you type, same as the old Chats-tab
  search. Tap a result to message them right away, or "Add" to save them
  as a contact so they show up without searching again next time.
- **By exact phone number** — since phone numbers are never stored in
  plain text (only a salted hash, so the server itself can't read them
  back out), this only confirms an exact match. You can't browse by phone
  number the way you can by username; you have to already know the number.

Saved contacts persist across sessions and appear at the bottom of the
Contacts tab regardless of which method found them.
