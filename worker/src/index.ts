import { FirebaseTokenVerifier, type VerifiedCaller } from "./auth.js";
import { readObligations, readRegistry } from "./firestore.js";
import { JevObligationMatcher } from "./jevMatcher.js";
import { prefilterObligations, rankShortlist } from "./ranking.js";
import { parseRankingRequest, RequestValidationError } from "./request.js";

export interface Env {
  TYPESAFE_API_KEY: string;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGIN: string;
}
interface TokenVerifier {
  verify(token: string, projectId: string): Promise<VerifiedCaller>;
}
interface Dependencies {
  fetcher: typeof fetch;
  tokenVerifier: TokenVerifier;
}

const corsHeaders = (origin: string): HeadersInit => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});
const json = (
  body: Record<string, unknown>,
  status: number,
  origin?: string,
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
const bearerToken = (request: Request): string | undefined => {
  const match = /^Bearer\s+([^\s]+)$/i.exec(
    request.headers.get("Authorization") || "",
  );
  return match?.[1];
};

export const createHandler = ({ fetcher, tokenVerifier }: Dependencies) => ({
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (origin && origin !== env.ALLOWED_ORIGIN)
      return json({ error: "Forbidden" }, 403);
    const allowedOrigin = origin === env.ALLOWED_ORIGIN ? origin : undefined;
    let pathname: string;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return json({ error: "Invalid request" }, 400, allowedOrigin);
    }
    if (pathname !== "/rank-invoice-obligations")
      return json({ error: "Not found" }, 404, allowedOrigin);
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env.ALLOWED_ORIGIN),
      });
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405, allowedOrigin);

    const token = bearerToken(request);
    if (!token) return json({ error: "Unauthorized" }, 401, allowedOrigin);
    let caller: VerifiedCaller;
    try {
      caller = await tokenVerifier.verify(token, env.FIREBASE_PROJECT_ID);
    } catch {
      return json({ error: "Unauthorized" }, 401, allowedOrigin);
    }

    let invoice;
    try {
      const body = await request.text();
      if (body.length > 10_000) throw new RequestValidationError();
      invoice = parseRankingRequest(JSON.parse(body));
    } catch {
      return json({ error: "Invalid request" }, 400, allowedOrigin);
    }

    try {
      const registry = await readRegistry(
        env.FIREBASE_PROJECT_ID,
        caller.uid,
        token,
        fetcher,
      );
      const role = registry?.role;
      const appId =
        typeof registry?.appId === "string" ? registry.appId.trim() : "";
      if ((role !== "admin" && role !== "manager") || !appId)
        return json({ error: "Forbidden" }, 403, allowedOrigin);
      const candidates = await readObligations(
        env.FIREBASE_PROJECT_ID,
        appId,
        invoice.family,
        token,
        fetcher,
      );
      const matcher = new JevObligationMatcher(env.TYPESAFE_API_KEY, {
        fetcher,
      });
      const result = await rankShortlist(
        invoice,
        prefilterObligations(invoice, candidates),
        matcher,
      );
      return json(
        { matches: result.matches, fallback: result.fallback },
        200,
        allowedOrigin,
      );
    } catch {
      return json({ error: "Service unavailable" }, 503, allowedOrigin);
    }
  },
});

const handler = createHandler({
  fetcher: fetch,
  tokenVerifier: new FirebaseTokenVerifier(),
});
export default handler;
