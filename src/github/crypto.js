/* Crypto helpers (loaded on demand as a separate chunk): libsodium-compatible sealed boxes for
   GitHub Actions secrets (#447) and Ed25519 SSH key pairs in OpenSSH format (#500). */
import nacl from 'tweetnacl';
import { blake2b } from 'blakejs';
import { b64FromBytes, bytesFromB64 } from './shared.js';

const enc = new TextEncoder();
// tweetnacl looks for self.crypto / require('crypto'); bundled as ESM we wire Web Crypto explicitly.
if (globalThis.crypto && globalThis.crypto.getRandomValues) nacl.setPRNG((x, n) => { const v = globalThis.crypto.getRandomValues(new Uint8Array(n)); for (let i = 0; i < n; i++) x[i] = v[i]; v.fill(0); });

/** crypto_box_seal: ephemeral pk ‖ box(m, nonce = blake2b(epk ‖ pk, 24), pk, esk). */
export function sealedBox(message, publicKeyB64) {
    const pk = bytesFromB64(publicKeyB64);
    if (pk.length !== 32) throw new Error('مفتاح GitHub العام غير صالح');
    const eph = nacl.box.keyPair();
    const nonceIn = new Uint8Array(64);
    nonceIn.set(eph.publicKey, 0); nonceIn.set(pk, 32);
    const nonce = blake2b(nonceIn, undefined, 24);
    const box = nacl.box(typeof message === 'string' ? enc.encode(message) : message, nonce, pk, eph.secretKey);
    const out = new Uint8Array(32 + box.length);
    out.set(eph.publicKey, 0); out.set(box, 32);
    return b64FromBytes(out);
}

/** Inverse of sealedBox (used by tests to prove compatibility). */
export function openSealedBox(sealedB64, publicKeyB64, secretKeyB64) {
    const data = bytesFromB64(sealedB64), pk = bytesFromB64(publicKeyB64), sk = bytesFromB64(secretKeyB64);
    const epk = data.subarray(0, 32);
    const nonceIn = new Uint8Array(64);
    nonceIn.set(epk, 0); nonceIn.set(pk, 32);
    const m = nacl.box.open(data.subarray(32), blake2b(nonceIn, undefined, 24), epk, sk);
    return m ? new TextDecoder().decode(m) : null;
}

export function boxKeyPair() {
    const kp = nacl.box.keyPair();
    return { publicKey: b64FromBytes(kp.publicKey), secretKey: b64FromBytes(kp.secretKey) };
}

// ------------------------------------------------------------------ SSH (OpenSSH wire format)
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const concat = (...parts) => { const len = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const sshString = (v) => { const b = typeof v === 'string' ? enc.encode(v) : v; return concat(u32(b.length), b); };

export function sshPublicBlob(pub) { return concat(sshString('ssh-ed25519'), sshString(pub)); }

export async function sshFingerprint(blob) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', blob));
    return 'SHA256:' + b64FromBytes(digest).replace(/=+$/, '');
}

/** Fingerprint of an "ssh-ed25519 AAAA… comment" line (any key type works — hashes the blob). */
export async function fingerprintOfPublicLine(line) {
    const m = /^\s*(ssh-[a-z0-9-]+|ecdsa-[a-z0-9-]+|sk-[a-z0-9@.-]+)\s+([A-Za-z0-9+/=]+)/.exec(String(line || ''));
    if (!m) return null;
    return sshFingerprint(bytesFromB64(m[2]));
}

/** New Ed25519 key pair → { publicKey (authorized_keys line), privateKey (OpenSSH PEM), fingerprint }. */
export async function generateSSHKey(comment = 'ox-alpha') {
    const kp = nacl.sign.keyPair(); // secretKey = seed(32) ‖ pub(32) — exactly what OpenSSH stores
    const pubBlob = sshPublicBlob(kp.publicKey);
    const check = crypto.getRandomValues(new Uint8Array(4));
    let priv = concat(check, check, sshString('ssh-ed25519'), sshString(kp.publicKey), sshString(kp.secretKey), sshString(comment));
    const pad = (8 - (priv.length % 8)) % 8;
    priv = concat(priv, Uint8Array.from({ length: pad }, (_, i) => i + 1));
    const body = concat(enc.encode('openssh-key-v1\0'), sshString('none'), sshString('none'), sshString(''), u32(1), sshString(pubBlob), sshString(priv));
    const b64 = b64FromBytes(body);
    const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\n' + b64.match(/.{1,70}/g).join('\n') + '\n-----END OPENSSH PRIVATE KEY-----\n';
    const publicKey = `ssh-ed25519 ${b64FromBytes(pubBlob)} ${comment}`;
    return { publicKey, privateKey, fingerprint: await sshFingerprint(pubBlob) };
}

/** Parse our OpenSSH private key back (tests): returns { pub, secret, comment }. */
export function parseOpenSSHPrivate(pem) {
    const b = bytesFromB64(pem.replace(/-----[^-]+-----/g, ''));
    const magic = 'openssh-key-v1\0';
    if (new TextDecoder().decode(b.subarray(0, magic.length)) !== magic) throw new Error('bad magic');
    let o = magic.length;
    const rd = () => { const n = (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]; o += 4; const v = b.subarray(o, o + n); o += n; return v; };
    const td = (v) => new TextDecoder().decode(v);
    const cipher = td(rd()); rd(); rd();
    o += 4; rd();
    const priv = rd();
    let p = 0;
    const c1 = priv.subarray(0, 4).join(), c2 = priv.subarray(4, 8).join(); p = 8;
    const rd2 = () => { const n = (priv[p] << 24) | (priv[p + 1] << 16) | (priv[p + 2] << 8) | priv[p + 3]; p += 4; const v = priv.subarray(p, p + n); p += n; return v; };
    const type = td(rd2()), pub = rd2(), secret = rd2(), comment = td(rd2());
    return { cipher, checkOk: c1 === c2, type, pub, secret, comment, padded: priv.length % 8 === 0 };
}

/** Ed25519 sign/verify (lets tests prove the private key matches the public key). */
export const signDetached = (msg, secret) => nacl.sign.detached(msg, secret);
export const verifyDetached = (msg, sig, pub) => nacl.sign.detached.verify(msg, sig, pub);
