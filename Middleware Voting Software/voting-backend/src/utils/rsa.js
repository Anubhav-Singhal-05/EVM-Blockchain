function modPow(base, exp, mod) {
  let result = 1n;
  base = BigInt(base) % BigInt(mod);
  exp  = BigInt(exp);
  mod  = BigInt(mod);
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return Number(result);
}

const p = 61, q = 53, n = p * q, phi = (p - 1) * (q - 1), e = 17, d = 2753;

function rsaEncrypt(plaintext) {
  return plaintext.split("").map((ch) => modPow(ch.charCodeAt(0), e, n));
}

function rsaDecrypt(cipherArray) {
  return cipherArray.map((c) => String.fromCharCode(modPow(c, d, n))).join("");
}

function encryptToHash(plaintext) {
  return Buffer.from(rsaEncrypt(plaintext).join(",")).toString("base64");
}

function decryptFromHash(hashBase64) {
  return rsaDecrypt(
    Buffer.from(hashBase64, "base64").toString("utf8").split(",").map(Number)
  );
}

module.exports = {
  rsaEncrypt,
  rsaDecrypt,
  encryptToHash,
  decryptFromHash,
  RSA_PARAMS: { p, q, n, phi, e, d },
};