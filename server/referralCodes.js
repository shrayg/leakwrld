'use strict';

const crypto = require('crypto');

/** Human-safe alphabet (no 0/O/1/I confusion). 32 symbols → 32^6 combinations. */
const REF_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateReferralCode() {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += REF_CHARS[bytes[i] % REF_CHARS.length];
  }
  return out;
}

/** Normalize user input: uppercase, strip garbage; empty string if invalid. */
function normalizeReferralCode(raw) {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  if (s.length !== 6) return '';
  for (let i = 0; i < s.length; i += 1) {
    if (!REF_CHARS.includes(s[i])) return '';
  }
  return s;
}

module.exports = { REF_CHARS, generateReferralCode, normalizeReferralCode };
