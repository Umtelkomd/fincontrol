import { describe, expect, it, vi } from "vitest";
import { createHandler, type Env } from "./index.js";

const env: Env = {
  TYPESAFE_API_KEY: "jev-secret",
  FIREBASE_PROJECT_ID: "firebase-project",
  ALLOWED_ORIGIN: "https://finance.example.com",
};
const invoice = {
  family: "payable",
  sourceSystem: "ordinary",
  counterpartyName: "Supplier GmbH",
  invoiceNumber: "INV-1",
  grossAmount: 119,
  issueDate: "2026-01-10",
};
const firestoreDocument = (name: string, fields: Record<string, unknown>) => ({
  name,
  fields,
});
const typed = {
  string: (value: string) => ({ stringValue: value }),
  integer: (value: number) => ({ integerValue: String(value) }),
  double: (value: number) => ({ doubleValue: value }),
  boolean: (value: boolean) => ({ booleanValue: value }),
};
const request = (body: unknown = invoice, init: RequestInit = {}) =>
  new Request("https://worker.example/rank-invoice-obligations", {
    method: "POST",
    headers: {
      Authorization: "Bearer firebase-token",
      Origin: env.ALLOWED_ORIGIN,
      "Content-Type": "application/json",
      ...init.headers,
    },
    body: JSON.stringify(body),
    ...init,
  });
const dependencies = (fetcher: typeof fetch) => ({
  fetcher,
  tokenVerifier: { verify: vi.fn(async () => ({ uid: "user-1" })) },
});

describe("ranking Worker", () => {
  it("handles allowed preflight and rejects other browser origins", async () => {
    const handler = createHandler(dependencies(vi.fn() as typeof fetch));
    const allowed = await handler.fetch(
      new Request("https://worker.example/rank-invoice-obligations", {
        method: "OPTIONS",
        headers: { Origin: env.ALLOWED_ORIGIN },
      }),
      env,
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      env.ALLOWED_ORIGIN,
    );

    const denied = await handler.fetch(
      request(invoice, {
        headers: {
          Origin: "https://evil.example",
          Authorization: "Bearer firebase-token",
          "Content-Type": "application/json",
        },
      }),
      env,
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("rejects malformed requests with a generic error", async () => {
    const handler = createHandler(dependencies(vi.fn() as typeof fetch));
    const response = await handler.fetch(request({ family: "payable" }), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
  });

  it("rejects editor registry roles", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            firestoreDocument(
              "projects/firebase-project/databases/(default)/documents/users/user-1",
              { role: typed.string("editor"), appId: typed.string("tenant-a") },
            ),
          ),
        ),
    );
    const handler = createHandler(dependencies(fetcher as typeof fetch));
    const response = await handler.fetch(request(), env);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("uses registry tenant authority, forwards the ID token, paginates typed Firestore values, and performs no Firestore writes", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/documents/users/user-1")) {
          return new Response(
            JSON.stringify(
              firestoreDocument(url, {
                role: typed.string("manager"),
                appId: typed.string("registry-tenant"),
              }),
            ),
          );
        }
        if (
          url.includes("/artifacts/registry-tenant/public/data/payables") &&
          !url.includes("pageToken=")
        ) {
          return new Response(
            JSON.stringify({
              documents: [
                firestoreDocument(`${url}/p-1`, {
                  sourceSystem: typed.string("ordinary"),
                  vendor: typed.string("Supplier GmbH"),
                  invoiceNumber: typed.string("INV-1"),
                  amount: typed.integer(119),
                  openAmount: typed.double(50.5),
                  active: typed.boolean(true),
                }),
              ],
              nextPageToken: "next-token",
            }),
          );
        }
        if (url.includes("pageToken=next-token")) {
          return new Response(
            JSON.stringify({
              documents: [
                firestoreDocument(`${url}/p-2`, {
                  sourceSystem: typed.string("ordinary"),
                  vendor: typed.string("Other Supplier"),
                  amount: typed.integer(200),
                }),
              ],
            }),
          );
        }
        if (url === "https://api.typesafe.ai/v1/systemone") {
          return new Response(
            JSON.stringify({
              answers: {
                candidate_0: { type: "noul", noul: 0.9 },
                candidate_1: { type: "noul", noul: 0.1 },
              },
            }),
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    );
    const handler = createHandler(dependencies(fetcher as typeof fetch));
    const response = await handler.fetch(
      request({
        ...invoice,
        appId: "client-tenant",
        role: "admin",
        candidates: [{ id: "fake" }],
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      fallback: false,
      matches: expect.arrayContaining([
        expect.objectContaining({ recordId: "p-1", score: 0.9 }),
        expect.objectContaining({ recordId: "p-2", score: 0.1 }),
      ]),
    });
    const firestoreCalls = calls.filter(({ url }) =>
      url.includes("firestore.googleapis.com"),
    );
    expect(firestoreCalls).toHaveLength(3);
    expect(firestoreCalls.every(({ init }) => init?.method === "GET")).toBe(
      true,
    );
    expect(
      firestoreCalls.every(
        ({ init }) =>
          (init?.headers as Record<string, string>).Authorization ===
          "Bearer firebase-token",
      ),
    ).toBe(true);
    expect(calls.some(({ url }) => url.includes("client-tenant"))).toBe(false);
  });

  it("returns deterministic fallback when Jev fails", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/documents/users/user-1"))
        return new Response(
          JSON.stringify(
            firestoreDocument(url, {
              role: typed.string("admin"),
              appId: typed.string("tenant-a"),
            }),
          ),
        );
      if (url.includes("/artifacts/tenant-a/public/data/payables"))
        return new Response(
          JSON.stringify({
            documents: [
              firestoreDocument(`${url}/p-1`, {
                sourceSystem: typed.string("ordinary"),
                vendor: typed.string("Supplier GmbH"),
                amount: typed.integer(119),
              }),
            ],
          }),
        );
      return new Response("provider detail must not leak", { status: 500 });
    });
    const handler = createHandler(dependencies(fetcher as typeof fetch));
    const response = await handler.fetch(request(), env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      fallback: boolean;
      matches: unknown[];
    };
    expect(body.fallback).toBe(true);
    expect(body.matches).toHaveLength(1);
  });
});
