const crypto = require("crypto");

const algorithm = "aes-256-gcm";

function getKey() {
  const key = process.env.MASTER_ENCRYPTION_KEY;

  if (!key) {
    throw new Error("MASTER_ENCRYPTION_KEY не найден в .env");
  }

  if (key.length !== 64) {
    throw new Error("MASTER_ENCRYPTION_KEY должен быть 64 символа hex");
  }

  return Buffer.from(key, "hex");
}

function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(algorithm, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(encryptedText) {
  const key = getKey();

  const [ivHex, authTagHex, encryptedHex] = encryptedText.split(":");

  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error("Неверный формат зашифрованного текста");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

module.exports = {
  encrypt,
  decrypt,
};