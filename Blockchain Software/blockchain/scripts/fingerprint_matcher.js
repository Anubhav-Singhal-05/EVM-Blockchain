/**
 * fingerprint_matcher.js
 * ----------------------
 * Compares two AS608 fingerprint templates encoded as Base64 strings
 * and returns a similarity score (0–100%).
 *
 * AS608 FORMAT:
 *   The AS608 sensor generates 512-byte binary templates.
 *   These are Base64-encoded (→ 684 chars) before being stored/transmitted.
 *
 * MATCHING ALGORITHM:
 *   1. Decode both Base64 strings into byte buffers.
 *   2. For each byte pair, compute XOR, then count matching bits
 *      (inverted Hamming distance) as a similarity metric.
 *   3. Return (matchingBits / totalBits) * 100 as a percentage.
 *
 * DEMO / MOCK MODE:
 *   If the decoded buffers are too small to be real AS608 templates
 *   (< 10 bytes, e.g. mock strings like "MOCK_F1_18"), the function
 *   falls back to exact string comparison (100% or 0%).
 *   This lets the system work correctly with mock data during testing.
 *
 * NOTE:
 *   For production, replace this with a proper biometric SDK such as
 *   SourceAFIS, which understands the minutiae points in AS608 templates.
 */

/**
 * Count the number of 1-bits (set bits) in a byte value.
 * @param {number} byte - Value 0–255
 * @returns {number} Number of set bits
 */
function popcount(byte) {
  let count = 0;
  let x = byte & 0xFF;
  while (x) {
    count += x & 1;
    x >>>= 1;
  }
  return count;
}

/**
 * Compute similarity between two byte buffers using inverted Hamming distance.
 * @param {Buffer} buf1
 * @param {Buffer} buf2
 * @returns {number} Similarity percentage (0–100)
 */
function byteSimilarity(buf1, buf2) {
  const len = Math.min(buf1.length, buf2.length);
  let matchingBits = 0;

  for (let i = 0; i < len; i++) {
    const xorByte  = buf1[i] ^ buf2[i];
    const diffBits = popcount(xorByte);      // how many bits differ
    matchingBits  += (8 - diffBits);         // how many bits match
  }

  return (matchingBits / (len * 8)) * 100;
}

/**
 * Calculate fingerprint match score between two Base64-encoded templates.
 *
 * @param {string} template1Base64 - Fingerprint from ESP32 (from E1)
 * @param {string} template2Base64 - Fingerprint from Global MongoDB DB
 * @returns {number} Score 0–100 (higher = more similar)
 */
function matchScore(template1Base64, template2Base64) {
  if (!template1Base64 || !template2Base64) return 0;

  let buf1, buf2;

  try {
    buf1 = Buffer.from(template1Base64, "base64");
    buf2 = Buffer.from(template2Base64, "base64");
  } catch {
    // If decoding fails for any reason, fall back to string equality
    return template1Base64 === template2Base64 ? 100 : 0;
  }

  // If buffers are too small → not a real AS608 template (demo/mock data)
  // Fall back to exact string comparison
  if (buf1.length < 10 || buf2.length < 10) {
    return template1Base64 === template2Base64 ? 100 : 0;
  }

  return byteSimilarity(buf1, buf2);
}

/**
 * Determine if a voter's fingerprints pass verification.
 *
 * Rule: match(F1, F1_g) > THRESHOLD  OR  match(F2, F2_g) > THRESHOLD
 * (Either finger matching above the threshold is sufficient.)
 *
 * @param {string} f1 - Left/primary fingerprint from ESP32 (base64)
 * @param {string} f2 - Right/secondary fingerprint from ESP32 (base64)
 * @param {string} f1_g - Registered primary fingerprint from Global DB (base64)
 * @param {string} f2_g - Registered secondary fingerprint from Global DB (base64)
 * @param {number} [threshold=80] - Minimum score to accept (default 80%)
 * @returns {{ passed: boolean, score1: number, score2: number }}
 */
function verifyFingerprints(f1, f2, f1_g, f2_g, threshold = 80) {
  const score1 = matchScore(f1, f1_g);
  const score2 = matchScore(f2, f2_g);
  const passed = score1 > threshold || score2 > threshold;
  return { passed, score1, score2, threshold };
}

module.exports = { matchScore, verifyFingerprints };
