require("dotenv").config();

const { encrypt } = require("./utils/encryption");

const token = process.argv[2];

if (!token) {
  console.log('Использование: node encrypt-token.js "TOKEN"');
  process.exit(1);
}

const encrypted = encrypt(token);

console.log("Encrypted token:");
console.log(encrypted);