import { describe, expect, it } from "vitest";
import Arweave from "arweave";
import { deriveAddress, validateJWKShape } from "./jwk";
import { generateJWK } from "../signer/keys";
import { userErrorMessage } from "../models/user-errors";
import { base64UrlToBytes, bytesToBase64Url } from "../vault/base64";

describe("deriveAddress", () => {
  it("is deterministic for the same JWK", async () => {
    const jwk = await generateJWK();
    const first = await deriveAddress(jwk);
    const second = await deriveAddress(jwk);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  }, 20_000);

  it("derives different addresses for different JWKs", async () => {
    const jwkA = await generateJWK();
    const jwkB = await generateJWK();
    const addressA = await deriveAddress(jwkA);
    const addressB = await deriveAddress(jwkB);
    expect(addressA).not.toBe(addressB);
  }, 20_000);

  it("matches arweave-js's address for the same key", async () => {
    const jwk = await generateJWK();
    expect(await deriveAddress(jwk)).toBe(await Arweave.init({}).wallets.jwkToAddress(jwk));
  }, 20_000);
});

describe("validateJWKShape", () => {
  it("rejects null", () => {
    const result = validateJWKShape(null);
    expect(result.valid).toBe(false);
  });

  it("rejects a non-object", () => {
    const result = validateJWKShape("not a keyfile");
    expect(result.valid).toBe(false);
  });

  it("rejects an array", () => {
    const result = validateJWKShape([]);
    expect(result.valid).toBe(false);
  });

  it("rejects an object missing required fields, with a reason naming the missing field", () => {
    const result = validateJWKShape({ kty: "RSA", n: "abc" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/missing required field/i);
    }
  });

  it("rejects a non-RSA key type with a specific reason", () => {
    const result = validateJWKShape({
      kty: "EC",
      e: "AQAB",
      n: "abc",
      d: "abc",
      p: "abc",
      q: "abc",
      dp: "abc",
      dq: "abc",
      qi: "abc",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/RSA/);
    }
  });

  it("rejects a field with invalid base64url characters", () => {
    const result = validateJWKShape({
      kty: "RSA",
      e: "AQAB",
      n: "not valid base64url!!",
      d: "abc",
      p: "abc",
      q: "abc",
      dp: "abc",
      dq: "abc",
      qi: "abc",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/base64url/i);
    }
  });

  it("rejects an empty-string field", () => {
    const result = validateJWKShape({
      kty: "RSA",
      e: "",
      n: "abc",
      d: "abc",
      p: "abc",
      q: "abc",
      dp: "abc",
      dq: "abc",
      qi: "abc",
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a generated 4096-bit Arweave key", async () => {
    const jwk = await generateJWK();
    expect(validateJWKShape(jwk)).toEqual({ valid: true, jwk });
  });

  it("refuses a 2048-bit key", async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "RSA-PSS", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    expect(validateJWKShape(jwk)).toEqual({ valid: false, reason: userErrorMessage("keyfileUnsupportedSize") });
  });

  it("refuses a 512-byte modulus whose top bit is clear", async () => {
    const jwk = await generateJWK();
    const bytes = base64UrlToBytes(jwk.n);
    bytes[0] = 0x7f;
    const result = validateJWKShape({ ...jwk, n: bytesToBase64Url(bytes) });
    expect(result).toEqual({ valid: false, reason: userErrorMessage("keyfileUnsupportedSize") });
  });

  it("refuses an exponent other than 65537", async () => {
    const jwk = await generateJWK();
    expect(validateJWKShape({ ...jwk, e: "Aw" })).toEqual({
      valid: false,
      reason: userErrorMessage("keyfileUnsupportedSize"),
    });
  });
});
