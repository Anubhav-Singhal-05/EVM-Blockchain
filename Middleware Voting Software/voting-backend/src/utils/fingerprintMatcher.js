/**
 * fingerprintMatcher.js  (Middleware copy)
 * -----------------------------------------
 * Identical logic to blockchain/scripts/fingerprint_matcher.js.
 * Kept as a copy so the middleware does not depend on the blockchain
 * project's file paths.
 *
 * Compares two AS608 fingerprint templates (Base64 strings) and returns
 * a similarity score (0–100%). See blockchain copy for full docs.
 */

function popcount(byte) {
  let count = 0;
  let x = byte & 0xFF;
  while (x) { count += x & 1; x >>>= 1; }
  return count;
}

function byteSimilarity(buf1, buf2) {
  const len = Math.min(buf1.length, buf2.length);
  let matchingBits = 0;
  for (let i = 0; i < len; i++) {
    matchingBits += 8 - popcount(buf1[i] ^ buf2[i]);
  }
  return (matchingBits / (len * 8)) * 100;
}

function matchScore(template1Base64, template2Base64) {
  if (!template1Base64 || !template2Base64) return 0;
  let buf1, buf2;
  try {
    buf1 = Buffer.from(template1Base64, "base64");
    buf2 = Buffer.from(template2Base64, "base64");
  } catch {
    return template1Base64 === template2Base64 ? 100 : 0;
  }
  // Fallback for demo/mock data shorter than a real AS608 template
  if (buf1.length < 10 || buf2.length < 10) {
    return template1Base64 === template2Base64 ? 100 : 0;
  }
  return byteSimilarity(buf1, buf2);
}

/**
 * Verify two scanned fingerprints against two registered ones.
 * Rule: match(F1, F1_g) > threshold  OR  match(F2, F2_g) > threshold
 */
function verifyFingerprints(f1, f2, f1_g, f2_g, threshold = 80) {
  const score1 = matchScore(f1, f1_g);
  const score2 = matchScore(f2, f2_g);
  return { passed: score1 > threshold || score2 > threshold, score1, score2, threshold };
}

module.exports = { matchScore, verifyFingerprints };
