import { describe, expect, it, vi } from "vitest";
import { exportSPKI, generateKeyPair, importSPKI, SignJWT } from "jose";
import { FirebaseTokenVerifier } from "./auth.js";

const projectId = "project-a";
const issuer = `https://securetoken.google.com/${projectId}`;

type FixtureClaims = {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number | null;
  kid?: string | null;
};

const fixture = async (claims: FixtureClaims = {}) => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const spki = await exportSPKI(publicKey);
  let builder = new SignJWT({})
    .setProtectedHeader({
      alg: "RS256",
      ...(claims.kid === null ? {} : { kid: claims.kid ?? "key-1" }),
    })
    .setIssuer(claims.iss ?? issuer)
    .setAudience(claims.aud ?? projectId)
    .setSubject(claims.sub ?? "user-1")
    .setIssuedAt();
  if (claims.exp !== null) {
    builder = builder.setExpirationTime(claims.exp ?? "5m");
  }
  const token = await builder.sign(privateKey);
  return { token, spki };
};

const verifierFor = (spki: string) =>
  new FirebaseTokenVerifier({
    fetcher: async () =>
      new Response(JSON.stringify({ "key-1": "certificate" })),
    importCertificate: async () => importSPKI(spki, "RS256"),
  });

describe("FirebaseTokenVerifier", () => {
  it("cryptographically verifies with the Firebase Secure Token key selected by kid", async () => {
    const { token, spki } = await fixture();
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ "key-1": "certificate" }), {
          headers: { "cache-control": "public, max-age=300" },
        }),
    );
    const importCertificate = vi.fn(async () => importSPKI(spki, "RS256"));
    const verifier = new FirebaseTokenVerifier({ fetcher, importCertificate });

    await expect(verifier.verify(token, projectId)).resolves.toEqual({
      uid: "user-1",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
    );
    expect(importCertificate).toHaveBeenCalledWith("certificate", "RS256");
  });

  it.each([
    ["issuer", { iss: "https://securetoken.google.com/other" }],
    ["audience", { aud: "other" }],
    ["subject", { sub: "" }],
  ])("rejects an invalid %s", async (_label, claims) => {
    const { token, spki } = await fixture(claims);

    await expect(verifierFor(spki).verify(token, projectId)).rejects.toThrow();
  });

  it("rejects a token without an expiration claim", async () => {
    const { token, spki } = await fixture({ exp: null });

    await expect(verifierFor(spki).verify(token, projectId)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const { token, spki } = await fixture({ exp: 1 });

    await expect(verifierFor(spki).verify(token, projectId)).rejects.toThrow();
  });

  it("rejects a token using an invalid algorithm", async () => {
    const secret = new TextEncoder().encode(
      "a-secure-test-secret-with-32-bytes",
    );
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", kid: "key-1" })
      .setIssuer(issuer)
      .setAudience(projectId)
      .setSubject("user-1")
      .setExpirationTime("5m")
      .sign(secret);
    const verifier = new FirebaseTokenVerifier({
      fetcher: vi.fn(),
      importCertificate: vi.fn(),
    });

    await expect(verifier.verify(token, projectId)).rejects.toThrow(
      "Invalid token",
    );
  });

  it.each([
    ["missing", null],
    ["unknown", "key-2"],
  ])("rejects a token with a %s kid", async (_label, kid) => {
    const { token, spki } = await fixture({ kid });

    await expect(verifierFor(spki).verify(token, projectId)).rejects.toThrow(
      "Invalid token",
    );
  });
});
