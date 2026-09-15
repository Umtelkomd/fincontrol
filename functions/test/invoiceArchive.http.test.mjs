import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { createArchiveHttpHandler } from "../src/invoiceArchive/http.mjs";
import { createArchiveAuthorizer } from "../src/invoiceArchive/authorize.mjs";
import {
  createArchiveUploader,
  ArchiveUploadError,
} from "../src/invoiceArchive/upload.mjs";
import {
  createArchiveReader,
  ArchiveReadError,
} from "../src/invoiceArchive/read.mjs";
import { MAX_BYTES, sha256 } from "../src/invoiceArchive/blob.mjs";

const PDF = Buffer.from("%PDF-1.7\nloopback fixture\n%%EOF");
const DIGEST = sha256(PDF);
const AUTH = "Bearer fixture-token";
const PATH = "/api/invoice-pdfs";
const result = {
  sha256: DIGEST,
  sizeBytes: PDF.length,
  mimeType: "application/pdf",
};
const headers = { authorization: AUTH, "content-type": "application/pdf" };
const secret = "private-sdk-error/bucket/token";

function fixture(overrides = {}) {
  const calls = [];
  const authorize = async (value) => {
    calls.push("authorize");
    if (value !== AUTH) throw new Error(secret);
    return { uid: "user", tenantId: "tenant", role: "manager" };
  };
  return {
    calls,
    dependencies: {
      authorize,
      upload: async ({ authorization, bytes }) => {
        calls.push("upload");
        assert.equal(authorization, AUTH);
        assert.deepEqual(bytes, PDF);
        return { ...result, internal: secret };
      },
      read: async ({ authorization, sha256: digest }) => {
        calls.push("read");
        assert.equal(authorization, AUTH);
        assert.equal(digest, DIGEST);
        return PDF;
      },
      ...overrides,
    },
  };
}

async function serve(dependencies, run, prepare = () => {}) {
  const handler = createArchiveHttpHandler(dependencies);
  const pending = [];
  const server = createServer((req, res) => {
    prepare(req);
    pending.push(handler(req, res));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const send = ({
    method = "POST",
    path = PATH,
    body = PDF,
    ...options
  } = {}) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          method,
          path,
          headers,
          agent: false,
          ...options,
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      if (typeof body === "function") body(req);
      else req.end(body);
    });
  try {
    await run(send);
    await Promise.all(pending);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function privateHeaders(response) {
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers.vary, "Authorization");
  assert.equal(response.headers["access-control-allow-origin"], undefined);
}

function failure(response, status, code) {
  assert.equal(response.status, status);
  privateHeaders(response);
  assert.deepEqual(JSON.parse(response.body), { error: code });
  assert.equal(response.body.includes(secret), false);
  assert.equal(response.body.includes(PDF), false);
}

test("raw upload and private verified GET expose only the public contract", async () => {
  const { dependencies, calls } = fixture();
  await serve(dependencies, async (send) => {
    const uploaded = await send();
    assert.equal(uploaded.status, 200);
    assert.deepEqual(JSON.parse(uploaded.body), result);
    privateHeaders(uploaded);
    const downloaded = await send({
      method: "GET",
      path: `${PATH}/${DIGEST}`,
      body: null,
    });
    assert.equal(downloaded.status, 200);
    privateHeaders(downloaded);
    assert.equal(downloaded.headers["content-type"], "application/pdf");
    assert.equal(downloaded.headers["content-length"], String(PDF.length));
    assert.equal(
      downloaded.headers["content-disposition"],
      `inline; filename="${DIGEST}.pdf"`,
    );
    assert.deepEqual(downloaded.body, PDF);
    assert.deepEqual(calls, ["authorize", "upload", "authorize", "read"]);
  });
});

test("authentication precedes body access; duplicate, missing and malformed auth fail closed", async () => {
  const invalid = [undefined, "Basic secret", [AUTH, AUTH], "Bearer bad,token"];
  for (const authorization of invalid) {
    const { dependencies, calls } = fixture();
    await serve(
      dependencies,
      async (send) => {
        failure(
          await send({
            headers: authorization === undefined ? {} : { authorization },
            body: (req) => req.flushHeaders(),
          }),
          403,
          "access-denied",
        );
        assert.deepEqual(calls, ["authorize"]);
      },
      (req) => {
        Object.defineProperty(req, "rawBody", {
          get() {
            throw new Error("body touched before auth");
          },
        });
      },
    );
  }
  const { dependencies, calls } = fixture();
  await serve(
    dependencies,
    async (send) => {
      failure(await send(), 403, "access-denied");
      assert.deepEqual(calls, ["authorize"]);
    },
    (req) => {
      req.headers.authorization = [AUTH];
    },
  );
});

test("strict routes reject queries, encoded paths, tenant injection and unsupported methods", async () => {
  const { dependencies, calls } = fixture();
  await serve(dependencies, async (send) => {
    for (const path of [
      "/unknown",
      `${PATH}/`,
      `${PATH}/${DIGEST.toUpperCase()}`,
      `${PATH}?token=secret`,
      `${PATH}/${DIGEST}?tenant=other`,
      `${PATH}/%2e%2e`,
      `${PATH}/${DIGEST}/extra`,
      `https://example.invalid${PATH}`,
      `//api/invoice-pdfs`,
      `${PATH}#fragment`,
      `${PATH}/../invoice-pdfs`,
    ]) {
      failure(await send({ path }), 404, "not-found");
    }
    for (const method of ["PUT", "DELETE", "OPTIONS"]) {
      const response = await send({ method });
      failure(response, 405, "method-not-allowed");
      assert.equal(response.headers.allow, "GET, POST");
    }
    const head = await send({ method: "HEAD", body: null });
    assert.equal(head.status, 405);
    assert.equal(head.body.length, 0);
    privateHeaders(head);
    failure(
      await send({ method: "GET", body: null }),
      405,
      "method-not-allowed",
    );
    failure(
      await send({ path: `${PATH}/${DIGEST}` }),
      405,
      "method-not-allowed",
    );
    assert.deepEqual(calls, []);
  });
});

test("media types, encoding and malformed or absent bodies never reach upload", async () => {
  const { dependencies, calls } = fixture();
  await serve(dependencies, async (send) => {
    for (const type of [
      undefined,
      "text/plain",
      "application/pdf; charset=utf-8",
    ]) {
      failure(
        await send({
          headers: {
            authorization: AUTH,
            ...(type && { "content-type": type }),
          },
        }),
        415,
        "unsupported-media-type",
      );
    }
    failure(
      await send({ headers: { ...headers, "content-encoding": "gzip" } }),
      415,
      "unsupported-media-type",
    );
    failure(await send({ body: null }), 400, "invalid-body");
    failure(
      await send({
        headers: { ...headers, "content-length": String(MAX_BYTES + 1) },
        body: (req) => req.flushHeaders(),
      }),
      413,
      "too-large",
    );
    assert.equal(calls.includes("upload"), false);
  });
});

test("stream overflow responds and closes without waiting for the sender to finish", async () => {
  const { dependencies, calls } = fixture();
  let closed;
  await serve(dependencies, async (send) => {
    const response = await send({
      body: (req) => {
        closed = new Promise((resolve) => req.on("close", resolve));
        req.write(Buffer.alloc(MAX_BYTES));
        req.write(Buffer.alloc(1));
        // Deliberately never end: the boundary must stop this connection itself.
      },
    });
    failure(response, 413, "too-large");
    assert.equal(response.headers.connection, "close");
    await closed;
    assert.deepEqual(calls, ["authorize"]);
  });
});

test("rawBody supports Express buffering but validates type, limit and declared length", async () => {
  for (const [rawBody, length, status, code] of [
    [PDF, String(PDF.length), 200],
    [Buffer.alloc(0), "0", 400, "invalid-body"],
    [PDF, "2", 400, "invalid-body"],
    [PDF, "bad", 400, "invalid-body"],
    [PDF, ["2"], 400, "invalid-body"],
    ["not bytes", undefined, 400, "invalid-body"],
    [Buffer.alloc(MAX_BYTES + 1), undefined, 413, "too-large"],
  ]) {
    const { dependencies, calls } = fixture();
    await serve(
      dependencies,
      async (send) => {
        const response = await send();
        if (status === 200) assert.deepEqual(JSON.parse(response.body), result);
        else failure(response, status, code);
        assert.equal(calls.includes("upload"), status === 200);
      },
      (req) => {
        req.rawBody = rawBody;
        if (length === undefined) delete req.headers["content-length"];
        else req.headers["content-length"] = length;
      },
    );
  }
});

test("stream errors, abort and length mismatches are generic and do not call core", async () => {
  for (const mode of ["error", "aborted", "mismatch"]) {
    const { dependencies, calls } = fixture();
    await serve(
      dependencies,
      async (send) => {
        failure(
          await send({
            body: mode === "mismatch" ? PDF : (req) => req.flushHeaders(),
          }),
          400,
          "invalid-body",
        );
        assert.deepEqual(calls, ["authorize"]);
      },
      (req) => {
        if (mode === "mismatch")
          req.headers["content-length"] = String(PDF.length + 1);
        else setImmediate(() => req.emit(mode, new Error(secret)));
      },
    );
  }
});

test("original Express target cannot hide a query or trailing control character", async () => {
  for (const originalUrl of [`${PATH}?token=secret`, `${PATH}/${DIGEST}\n`]) {
    const { dependencies, calls } = fixture();
    await serve(
      dependencies,
      async (send) => {
        failure(await send({ method: "GET", body: null }), 404, "not-found");
        assert.deepEqual(calls, []);
      },
      (req) => {
        req.originalUrl = originalUrl;
        req.url = `${PATH}/${DIGEST}`;
      },
    );
  }
});

test("exactly 20 MiB is accepted without truncation", async () => {
  const bytes = Buffer.alloc(MAX_BYTES);
  PDF.copy(bytes);
  const expected = { ...result, sha256: sha256(bytes), sizeBytes: MAX_BYTES };
  const { dependencies } = fixture({
    upload: async ({ bytes: received }) => {
      assert.deepEqual(received, bytes);
      return expected;
    },
  });
  await serve(dependencies, async (send) => {
    const response = await send({
      body: bytes,
      headers: {
        ...headers,
        "content-length": String(MAX_BYTES),
        "content-encoding": "identity",
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), expected);
  });
});

test("actual client disconnect settles the handler without invoking a core", async () => {
  const { dependencies, calls } = fixture();
  let client;
  await serve(
    dependencies,
    async (send) => {
      await assert.rejects(
        send({
          body: (req) => {
            client = req;
            req.flushHeaders();
          },
        }),
        { code: "ECONNRESET" },
      );
      assert.deepEqual(calls, ["authorize"]);
    },
    () => {
      setImmediate(() => client.destroy());
    },
  );
});

test("known core failures map to fixed codes; SDK failures never reflect details", async () => {
  const cases = [
    [
      "upload",
      new ArchiveUploadError("invalidpdf"),
      415,
      "unsupported-media-type",
    ],
    ["upload", new ArchiveUploadError("conflict"), 409, "conflict"],
    ["upload", new ArchiveUploadError("accessdenied"), 403, "access-denied"],
    ["upload", new ArchiveUploadError("storagefailure"), 500, "internal-error"],
    ["read", new ArchiveReadError("invalidblob"), 500, "internal-error"],
    ["read", new ArchiveReadError("storagefailure"), 500, "internal-error"],
    ["read", new ArchiveReadError("accessdenied"), 403, "access-denied"],
    ["read", new ArchiveReadError("invaliddigest"), 400, "invalid-body"],
    ["read", new ArchiveReadError("notfound"), 404, "not-found"],
    [
      "upload",
      Object.assign(new Error(secret), { code: "conflict" }),
      500,
      "internal-error",
    ],
  ];
  for (const [operation, error, status, code] of cases) {
    const { dependencies } = fixture({
      [operation]: async () => {
        throw error;
      },
    });
    await serve(dependencies, async (send) => {
      failure(
        await send(
          operation === "read"
            ? {
                method: "GET",
                path: `${PATH}/${DIGEST}`,
                body: null,
              }
            : {},
        ),
        status,
        code,
      );
    });
  }
});

test("authorization runs before the store lookup: an unauthorized GET of a missing digest is 403, not 404", async () => {
  const { dependencies, calls } = fixture({
    read: async () => {
      calls.push("read");
      throw new ArchiveReadError("notfound");
    },
  });
  await serve(dependencies, async (send) => {
    failure(
      await send({
        method: "GET",
        path: `${PATH}/${DIGEST}`,
        headers: { authorization: "Bearer wrong-token" },
        body: null,
      }),
      403,
      "access-denied",
    );
    assert.deepEqual(calls, ["authorize"]);
  });
});

test("unexpected core returns cannot leak metadata or unverified PDF bytes", async () => {
  for (const value of [
    null,
    { ...result, sha256: secret },
    { ...result, sizeBytes: -1 },
    { ...result, mimeType: secret },
    { ...result, toJSON: () => secret },
  ]) {
    const { dependencies } = fixture({ upload: async () => value });
    await serve(dependencies, async (send) => {
      const response = await send();
      if (value?.toJSON) assert.deepEqual(JSON.parse(response.body), result);
      else failure(response, 500, "internal-error");
    });
  }
  for (const value of [
    secret,
    Buffer.from("%PDF-wrong"),
    Buffer.alloc(0),
    Buffer.alloc(MAX_BYTES + 1),
  ]) {
    const { dependencies } = fixture({ read: async () => value });
    await serve(dependencies, async (send) => {
      failure(
        await send({ method: "GET", path: `${PATH}/${DIGEST}`, body: null }),
        500,
        "internal-error",
      );
    });
  }
});

test("real authorizer/uploader/reader compose with an in-memory store and recheck access", async () => {
  let authorized = 0;
  let revoked = false;
  let snapshot;
  let membershipRead = () => {};
  const authorize = createArchiveAuthorizer({
    tenantId: "tenant",
    verifyIdToken: async (_, checkRevoked) => {
      assert.equal(checkRevoked, true);
      authorized++;
      if (revoked) throw new Error(secret);
      return { uid: "user", firebase: { sign_in_provider: "password" } };
    },
    readMembership: async () => {
      membershipRead();
      return { tenantId: "tenant", role: "manager" };
    },
  });
  const store = {
    createOnly: async ({ bytes, metadata }) => {
      snapshot = { bytes, metadata, generation: "1" };
    },
    readSnapshot: async () => snapshot,
  };
  const dependencies = {
    authorize,
    upload: createArchiveUploader({ authorize, store }),
    read: createArchiveReader({ authorize, store }),
  };
  await serve(dependencies, async (send) => {
    assert.deepEqual(JSON.parse((await send()).body), result);
    const downloaded = await send({
      method: "GET",
      path: `${PATH}/${DIGEST}`,
      body: null,
    });
    assert.deepEqual(downloaded.body, PDF);
    assert.equal(authorized, 4);
    failure(
      await send({ body: Buffer.from("not a PDF") }),
      415,
      "unsupported-media-type",
    );
    const gatePassed = new Promise((resolve) => {
      membershipRead = resolve;
    });
    failure(
      await send({
        body: (req) => {
          req.flushHeaders();
          gatePassed.then(() => {
            revoked = true;
            req.end(PDF);
          });
        },
      }),
      403,
      "access-denied",
    );
  });
});
