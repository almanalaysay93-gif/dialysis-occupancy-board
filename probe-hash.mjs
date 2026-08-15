import { createHash, randomBytes } from "crypto";
const salt = "9dd400fb568ada0d8f8bb49eca9ab8e0";
const pass = "Auditor1234";
console.log(createHash("sha256").update(salt + pass).digest("hex"));
