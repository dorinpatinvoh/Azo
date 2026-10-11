import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import { Injectable } from "@nestjs/common";

function readKey(name: "NPI_ENCRYPTION_KEY" | "NPI_HASH_KEY"): Buffer {
  const value = process.env[name]?.trim();
  if (!value || value.length < 32) {
    throw new Error(`[AZƆ̀ Sécurité] ${name} est obligatoire et doit contenir au moins 32 caractères.`);
  }
  return createHash("sha256").update(value, "utf8").digest();
}

@Injectable()
export class NpiCryptoService {
  private readonly encryptionKey = readKey("NPI_ENCRYPTION_KEY");
  private readonly hashKey = readKey("NPI_HASH_KEY");

  constructor() {
    if (this.encryptionKey.equals(this.hashKey)) {
      throw new Error("[AZƆ̀ Sécurité] NPI_ENCRYPTION_KEY et NPI_HASH_KEY doivent être différentes.");
    }
  }

  hash(npi: string): string {
    return createHmac("sha256", this.hashKey).update(npi).digest("hex");
  }

  encrypt(npi: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(npi, "utf8"), cipher.final()]);
    return `v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ciphertext.toString("hex")}`;
  }

  decrypt(value: string): string {
    const [version, ivHex, tagHex, ciphertextHex] = value.split(":");
    if (version !== "v1" || !ivHex || !tagHex || !ciphertextHex) {
      throw new Error("Format de NPI chiffré invalide");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  }
}
