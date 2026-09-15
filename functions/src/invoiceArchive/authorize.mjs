const MAX_HEADER_LENGTH = 8192;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_TENANT_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const BEARER = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i;

export class ArchiveAccessError extends Error {
  constructor() {
    super("Archive access denied.");
    this.name = "ArchiveAccessError";
    this.code = "archive/access-denied";
  }
}

function isSafeSegment(value) {
  return typeof value === "string" && SAFE_SEGMENT.test(value);
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

// Trusted adapters only: verifyIdToken(token, checkRevoked) verifies a Firebase ID
// token; readMembership('/users/{uid}') must fetch uncached { tenantId, role } or null.
// IDs use 1–128 ASCII characters starting with a letter/digit, followed by
// letters/digits/dots/underscores/hyphens; tenants also allow Firebase app ID colons.
// Unsupported identifiers fail closed, never normalize.
// The future upload/read transport must invoke this gate on every request.
export function createArchiveAuthorizer(config) {
  let tenantId;
  let verifyIdToken;
  let readMembership;
  try {
    ({ tenantId, verifyIdToken, readMembership } = config);
    if (
      typeof tenantId !== "string" ||
      !SAFE_TENANT_SEGMENT.test(tenantId) ||
      typeof verifyIdToken !== "function" ||
      typeof readMembership !== "function"
    ) {
      throw new ArchiveAccessError();
    }
  } catch {
    throw new ArchiveAccessError();
  }

  return async function authorize(authorizationHeader) {
    try {
      // Reject non-space whitespace and controls before parsing a single credential.
      if (
        typeof authorizationHeader !== "string" ||
        authorizationHeader.length > MAX_HEADER_LENGTH ||
        /[\s\p{Cc}]/u.test(authorizationHeader.replaceAll(" ", ""))
      ) {
        throw new ArchiveAccessError();
      }
      const match = BEARER.exec(authorizationHeader);
      if (!match) throw new ArchiveAccessError();

      const claims = await verifyIdToken(match[1], true);
      if (
        !isRecord(claims) ||
        !Object.hasOwn(claims, "uid") ||
        !Object.hasOwn(claims, "firebase")
      )
        throw new ArchiveAccessError();
      const { uid, firebase } = claims;
      if (
        !isSafeSegment(uid) ||
        !isRecord(firebase) ||
        !Object.hasOwn(firebase, "sign_in_provider")
      )
        throw new ArchiveAccessError();
      const provider = firebase.sign_in_provider;
      if (!isSafeSegment(provider) || provider.toLowerCase() === "anonymous") {
        throw new ArchiveAccessError();
      }

      // Never trust token role/tenant claims or cache membership across calls.
      const member = await readMembership(`/users/${uid}`);
      if (
        !isRecord(member) ||
        !Object.hasOwn(member, "tenantId") ||
        !Object.hasOwn(member, "role")
      )
        throw new ArchiveAccessError();
      const { tenantId: memberTenant, role } = member;
      if (
        memberTenant !== tenantId ||
        (role !== "manager" && role !== "admin")
      ) {
        throw new ArchiveAccessError();
      }
      return Object.freeze({ uid, tenantId, role });
    } catch {
      // One public failure shape avoids exposing membership existence or SDK causes.
      throw new ArchiveAccessError();
    }
  };
}
