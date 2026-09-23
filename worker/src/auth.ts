import { decodeProtectedHeader, importX509, jwtVerify } from "jose";

const CERTIFICATES_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
type ImportCertificate = (
  certificate: string,
  algorithm: string,
) => Promise<CryptoKey | Uint8Array>;
interface Options {
  fetcher?: typeof fetch;
  importCertificate?: ImportCertificate;
}
export interface VerifiedCaller {
  uid: string;
}

export class FirebaseTokenVerifier {
  private readonly fetcher: typeof fetch;
  private readonly importCertificate: ImportCertificate;
  private certificates: Record<string, string> = {};
  private expiresAt = 0;
  constructor(options: Options = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.importCertificate =
      options.importCertificate ??
      ((certificate, algorithm) => importX509(certificate, algorithm));
  }
  private async loadCertificates(): Promise<Record<string, string>> {
    if (Date.now() < this.expiresAt && Object.keys(this.certificates).length)
      return this.certificates;
    const response = await this.fetcher(CERTIFICATES_URL);
    if (!response.ok) throw new Error("Authentication unavailable");
    const certificates = await response.json();
    if (
      !certificates ||
      typeof certificates !== "object" ||
      Array.isArray(certificates)
    )
      throw new Error("Authentication unavailable");
    this.certificates = certificates as Record<string, string>;
    const maxAge = /max-age=(\d+)/i.exec(
      response.headers.get("cache-control") || "",
    )?.[1];
    this.expiresAt = Date.now() + Math.max(60, Number(maxAge) || 300) * 1000;
    return this.certificates;
  }
  async verify(token: string, projectId: string): Promise<VerifiedCaller> {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid)
      throw new Error("Invalid token");
    const certificate = (await this.loadCertificates())[header.kid];
    if (!certificate) throw new Error("Invalid token");
    const key = await this.importCertificate(certificate, "RS256");
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["RS256"],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
      requiredClaims: ["exp"],
    });
    if (
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      typeof payload.sub !== "string" ||
      payload.sub.trim() === ""
    )
      throw new Error("Invalid token");
    return { uid: payload.sub };
  }
}
