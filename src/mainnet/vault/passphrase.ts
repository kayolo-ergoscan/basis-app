// Passphrase rules: NFKC, at least 12 code points. The strength is only a hint for the UI (codes, no texts); the
// length is the only hard rule. Nothing here keeps or logs the passphrase.
import { MIN_PASSPHRASE_LENGTH } from "./constants";

export type PassphraseIssue = "too-short" | "one-kind" | "repeats" | "sequence" | "common";

export interface PassphraseCheck {
  /** Meets the minimum length. */
  ok: boolean;
  /** Code points after NFKC normalisation. */
  length: number;
  /** 0 too short, 1 weak … 4 strong (a rough estimate, never a promise). */
  strength: 0 | 1 | 2 | 3 | 4;
  issues: PassphraseIssue[];
}

/** The form that is fed to PBKDF2 (as UTF-8): Unicode NFKC, nothing trimmed. */
export function normalizePassphrase(p: string): string {
  return p.normalize("NFKC");
}

const COMMON = [
  "password", "passw0rd", "qwerty", "123456", "111111", "letmein", "iloveyou", "admin", "welcome", "monkey", "dragon",
  "football", "sunshine", "princess", "trustno1", "abc123", "secret", "bitcoin", "crypto", "wallet", "ergo", "basis",
  "mainnet", "пароль", "йцукен", "qwertz", "azerty",
];
const SEQUENCES = ["abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm", "01234567890", "абвгдеёжзийклмнопрстуфхцчшщъыьэюя", "йцукенгшщзхъфывапролджэячсмитьбю"];

function hasSequence(p: string): boolean {
  const s = p.toLowerCase();
  for (const seq of SEQUENCES) {
    const back = [...seq].reverse().join("");
    for (let i = 0; i + 4 <= seq.length; i++) if (s.includes(seq.slice(i, i + 4)) || s.includes(back.slice(i, i + 4))) return true;
  }
  return false;
}

export function checkPassphrase(input: string): PassphraseCheck {
  const p = normalizePassphrase(typeof input === "string" ? input : "");
  const chars = [...p];
  const length = chars.length;
  const issues: PassphraseIssue[] = [];
  if (length < MIN_PASSPHRASE_LENGTH) issues.push("too-short");
  const kinds = { lower: false, upper: false, digit: false, space: false, symbol: false, letter: false, other: false };
  for (const c of chars) {
    if (c >= "a" && c <= "z") kinds.lower = true;
    else if (c >= "A" && c <= "Z") kinds.upper = true;
    else if (c >= "0" && c <= "9") kinds.digit = true;
    else if (/\s/u.test(c)) kinds.space = true;
    else if (c >= "!" && c <= "~") kinds.symbol = true;
    else if (/\p{L}/u.test(c)) kinds.letter = true;
    else kinds.other = true;
  }
  const pool = (kinds.lower ? 26 : 0) + (kinds.upper ? 26 : 0) + (kinds.digit ? 10 : 0) + (kinds.space ? 1 : 0) + (kinds.symbol ? 33 : 0) + (kinds.letter ? 33 : 0) + (kinds.other ? 100 : 0);
  let bits = length * Math.log2(Math.max(pool, 2));
  if (Object.values(kinds).filter(Boolean).length <= 1 && length > 0) issues.push("one-kind");
  if (length > 0 && new Set(chars).size < Math.max(4, length / 3)) {
    issues.push("repeats");
    bits *= 0.5;
  }
  if (hasSequence(p)) {
    issues.push("sequence");
    bits *= 0.8;
  }
  const lower = p.toLowerCase();
  if (COMMON.some((w) => lower.includes(w))) {
    issues.push("common");
    bits *= 0.7;
  }
  const ok = length >= MIN_PASSPHRASE_LENGTH;
  const strength: PassphraseCheck["strength"] = !ok ? 0 : bits < 50 ? 1 : bits < 70 ? 2 : bits < 90 ? 3 : 4;
  return { ok, length, strength, issues };
}
