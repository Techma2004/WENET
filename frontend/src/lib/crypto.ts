// Real key-agreement encryption using the browser's built-in Web Crypto API.
// Each account has an ECDH keypair. The public key is stored on the server
// (the `publicKey` column that already existed in the schema); the private
// key never leaves this device. Two people chatting derive the same AES-GCM
// key from (my private key + their public key) via ECDH, so the server only
// ever sees ciphertext in `encryptedPayload`.
//
// This is not the full Signal double-ratchet protocol (no per-message key
// rotation or forward secrecy), but it is genuine end-to-end encryption:
// the server cannot read message contents even if it wanted to.

const PRIVATE_KEY_STORAGE_PREFIX = 'wenet_privkey_';

function bufToB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function generateKeyPair(): Promise<{ publicKeyB64: string; privateJwk: JsonWebKey }> {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  return { publicKeyB64: bufToB64(spki), privateJwk };
}

export function savePrivateKey(userId: string, privateJwk: JsonWebKey) {
  localStorage.setItem(PRIVATE_KEY_STORAGE_PREFIX + userId, JSON.stringify(privateJwk));
}

export function loadPrivateKey(userId: string): JsonWebKey | null {
  const raw = localStorage.getItem(PRIVATE_KEY_STORAGE_PREFIX + userId);
  return raw ? JSON.parse(raw) : null;
}

async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
}

async function importPublicKey(spkiB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', b64ToBuf(spkiB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

const sharedKeyCache = new Map<string, CryptoKey>();

async function deriveSharedKey(myPrivateJwk: JsonWebKey, theirPublicKeyB64: string): Promise<CryptoKey> {
  const cached = sharedKeyCache.get(theirPublicKeyB64);
  if (cached) return cached;

  const privateKey = await importPrivateKey(myPrivateJwk);
  const publicKey = await importPublicKey(theirPublicKeyB64);
  const key = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  sharedKeyCache.set(theirPublicKeyB64, key);
  return key;
}

export async function encryptText(
  myPrivateJwk: JsonWebKey,
  theirPublicKeyB64: string,
  text: string
): Promise<{ encryptedPayload: string; iv: string }> {
  const key = await deriveSharedKey(myPrivateJwk, theirPublicKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { encryptedPayload: bufToB64(cipher), iv: bufToB64(iv.buffer) };
}

// --- Group symmetric key wrapping ---
// A group's messages are all encrypted with one shared AES-GCM key. That
// raw key is generated once (by whoever creates the group) and handed to
// each member individually: wrapped (encrypted) with the same ECDH
// key-agreement trick used for 1:1 chats, so only that specific member can
// unwrap it. The server only ever sees wrapped (encrypted) key material and
// encrypted message bodies - it cannot read either.

export async function generateGroupKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportGroupKeyRaw(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey('raw', key);
}

export async function importGroupKeyRaw(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// Wrap a group's raw AES key for one recipient, using the same ECDH shared
// secret as a 1:1 chat between us and them.
export async function wrapGroupKeyForMember(
  myPrivateJwk: JsonWebKey,
  theirPublicKeyB64: string,
  groupKey: CryptoKey
): Promise<{ wrappedKey: string; iv: string }> {
  const raw = await exportGroupKeyRaw(groupKey);
  const key = await deriveSharedKey(myPrivateJwk, theirPublicKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw);
  return { wrappedKey: bufToB64(cipher), iv: bufToB64(iv.buffer) };
}

export async function unwrapGroupKey(
  myPrivateJwk: JsonWebKey,
  theirPublicKeyB64: string,
  wrappedKey: string,
  iv: string
): Promise<CryptoKey> {
  const key = await deriveSharedKey(myPrivateJwk, theirPublicKeyB64);
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(iv) }, key, b64ToBuf(wrappedKey));
  return importGroupKeyRaw(raw);
}

export async function encryptWithGroupKey(groupKey: CryptoKey, text: string): Promise<{ encryptedPayload: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, groupKey, new TextEncoder().encode(text));
  return { encryptedPayload: bufToB64(cipher), iv: bufToB64(iv.buffer) };
}

export async function decryptWithGroupKey(groupKey: CryptoKey, encryptedPayload: string, iv: string): Promise<string> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(iv) }, groupKey, b64ToBuf(encryptedPayload));
    return new TextDecoder().decode(plain);
  } catch {
    return '[unable to decrypt]';
  }
}

const GROUP_KEY_STORAGE_PREFIX = 'wenet_groupkey_';

export async function saveGroupKey(groupId: string, key: CryptoKey) {
  const raw = await exportGroupKeyRaw(key);
  localStorage.setItem(GROUP_KEY_STORAGE_PREFIX + groupId, bufToB64(raw));
}

export async function loadGroupKey(groupId: string): Promise<CryptoKey | null> {
  const b64 = localStorage.getItem(GROUP_KEY_STORAGE_PREFIX + groupId);
  if (!b64) return null;
  return importGroupKeyRaw(b64ToBuf(b64));
}

export async function decryptText(
  myPrivateJwk: JsonWebKey,
  theirPublicKeyB64: string,
  encryptedPayload: string,
  iv: string
): Promise<string> {
  try {
    const key = await deriveSharedKey(myPrivateJwk, theirPublicKeyB64);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(iv) }, key, b64ToBuf(encryptedPayload));
    return new TextDecoder().decode(plain);
  } catch {
    return '[unable to decrypt]';
  }
}
