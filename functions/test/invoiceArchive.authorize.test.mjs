import assert from "node:assert/strict";
import test from "node:test";
import {
  ArchiveAccessError,
  createArchiveAuthorizer,
} from "../src/invoiceArchive/authorize.mjs";

const tenantId = "tenant-1";
const uid = "member_1";
const header = "Bearer test-token";
const decoded = () => ({ uid, firebase: { sign_in_provider: "password" } });
const membership = (role = "manager") => ({ tenantId, role });

function fixture(overrides = {}) {
  const calls = [];
  const authorize = createArchiveAuthorizer({
    tenantId,
    verifyIdToken: async (...args) => {
      calls.push(["verify", ...args]);
      return decoded();
    },
    readMembership: async (path) => {
      calls.push(["membership", path]);
      return membership();
    },
    ...overrides,
  });
  return { authorize, calls };
}

function denied(error) {
  assert.ok(error instanceof ArchiveAccessError);
  assert.equal(error.code, "archive/access-denied");
  assert.equal(error.message, "Archive access denied.");
  assert.equal(error.cause, undefined);
  assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
  assert.doesNotMatch(error.stack, /test-token|private-detail/);
  return true;
}

test("factory is lazy; every authorization checks revocation and the exact user path", async () => {
  const { authorize, calls } = fixture();
  assert.deepEqual(calls, []);
  assert.deepEqual(await authorize(header), { uid, tenantId, role: "manager" });
  assert.deepEqual(calls, [
    ["verify", "test-token", true],
    ["membership", `/users/${uid}`],
  ]);
});

test("accepts a Firebase app ID tenant and requires exact current membership", async () => {
  const appId = "1:123456789:web:abcdef";
  let memberTenant = appId;
  const { authorize, calls } = fixture({
    tenantId: appId,
    readMembership: async (path) => {
      assert.equal(path, `/users/${uid}`);
      return { tenantId: memberTenant, role: "manager" };
    },
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(await authorize(header), {
    uid,
    tenantId: appId,
    role: "manager",
  });
  assert.deepEqual(calls, [["verify", "test-token", true]]);
  for (memberTenant of ["1:123456789:web:other", ` ${appId}`, `${appId} `]) {
    await assert.rejects(authorize(header), denied);
  }
});

for (const role of ["manager", "admin"]) {
  test(`allows ${role} with a frozen minimal result`, async () => {
    const { authorize } = fixture({
      readMembership: async () => membership(role),
    });
    const result = await authorize(header);
    assert.deepEqual(result, { uid, tenantId, role });
    assert.ok(Object.isFrozen(result));
    assert.throws(() => {
      result.role = "editor";
    }, TypeError);
  });
}

test("accepts case-insensitive Bearer and HTTP space separators", async () => {
  for (const value of ["bearer test-token", "BEARER   test-token"]) {
    const { authorize, calls } = fixture();
    await authorize(value);
    assert.deepEqual(calls[0], ["verify", "test-token", true]);
  }
});

test("malformed and oversized headers fail before dependency calls", async () => {
  const invalid = [
    undefined,
    null,
    42,
    {},
    [header],
    new String(header),
    "",
    "Basic test-token",
    "Bearer",
    "Bearer ",
    "Bearer token token",
    "Bearer one, Bearer two",
    "Bearer one,two",
    'Bearer "test-token"',
    " Bearer test-token",
    "Bearer test-token ",
    "Bearer\ttest-token",
    "Bearer test-token\n",
    "Bearer test-token\r\n",
    "Bearer token\u0000",
    "Bearer\ntest-token",
    "Bearer test\u00a0token",
    "Bearer =",
    `Bearer ${"x".repeat(8186)}`,
  ];
  for (const value of invalid) {
    const { authorize, calls } = fixture();
    await assert.rejects(authorize(value), denied);
    assert.deepEqual(calls, []);
  }
  await fixture().authorize(`Bearer ${"x".repeat(8185)}`);
});

test("invalid factory config fails closed without invoking adapters", () => {
  const adapter = () => assert.fail("factory invoked a dependency");
  const valid = { tenantId, verifyIdToken: adapter, readMembership: adapter };
  const invalid = [
    undefined,
    null,
    {},
    { ...valid, verifyIdToken: null },
    { ...valid, readMembership: {} },
  ];
  for (const tenant of [
    "",
    " ",
    " tenant",
    "tenant ",
    "a/b",
    "a\\b",
    ".",
    "..",
    "a%2Fb",
    "tenant\n",
    "tenant\r",
    "1:123:web:abc/../other",
    "1:123:web:abc\\other",
    "1:123:web:abc\n",
    "1:123:web:abc\u007f",
    " 1:123:web:abc",
    "1:123:web:abc ",
    "1:123:web:abc\t",
    `a:${"x".repeat(127)}`,
    new String("1:123:web:abc"),
    "a\u0000b",
    "a\tb",
    "x".repeat(129),
    42,
  ])
    invalid.push({ ...valid, tenantId: tenant });
  for (const config of invalid)
    assert.throws(() => createArchiveAuthorizer(config), denied);
});

test("malformed decoded tokens and unsafe UIDs never reach membership", async () => {
  const invalid = [
    null,
    undefined,
    [],
    "claims",
    {},
    { ...decoded(), uid: undefined },
  ];
  for (const value of [
    "",
    " member",
    "member ",
    "member\n",
    "member:1",
    "a/b",
    "a\\b",
    ".",
    "..",
    "a%2Fb",
    "a\u0000b",
    "x".repeat(129),
    12,
    new String(uid),
  ])
    invalid.push({ ...decoded(), uid: value });
  for (const claims of invalid) {
    const { authorize, calls } = fixture({ verifyIdToken: async () => claims });
    await assert.rejects(authorize(header), denied);
    assert.deepEqual(calls, []);
  }
});

test("anonymous or unusable provider claims cannot prove non-anonymous identity", async () => {
  const invalid = [undefined, null, [], {}, { sign_in_provider: "anonymous" }];
  for (const provider of [
    "",
    " ",
    "password\n",
    "Anonymous",
    123,
    {},
    "password/other",
    "password:other",
  ]) {
    invalid.push({ sign_in_provider: provider });
  }
  for (const firebase of invalid) {
    const { authorize, calls } = fixture({
      verifyIdToken: async () => ({ uid, firebase }),
    });
    await assert.rejects(authorize(header), denied);
    assert.deepEqual(calls, []);
  }
});

test("supports non-anonymous Firebase providers without email-role inference", async () => {
  for (const provider of ["password", "google.com", "phone", "custom"]) {
    const { authorize } = fixture({
      verifyIdToken: async () => ({
        uid,
        firebase: { sign_in_provider: provider },
      }),
    });
    await authorize(header);
  }
});

test("missing, foreign, or unprivileged membership is denied identically", async () => {
  const invalid = [
    null,
    undefined,
    [],
    "admin",
    {},
    { role: "admin" },
    { tenantId },
    { tenantId: "another-tenant", role: "admin" },
    ...["editor", "Admin", "", null, {}, ["admin"]].map((role) =>
      membership(role),
    ),
  ];
  for (const member of invalid) {
    const { authorize } = fixture({ readMembership: async () => member });
    await assert.rejects(authorize(header), denied);
  }
});

test("membership is reread: downgrade and removal revoke previously granted access", async () => {
  let current = membership("admin");
  let reads = 0;
  const { authorize, calls } = fixture({
    readMembership: async () => {
      reads += 1;
      return current;
    },
  });
  const first = await authorize(header);
  current = membership("editor");
  await assert.rejects(authorize(header), denied);
  current = null;
  await assert.rejects(authorize(header), denied);
  assert.equal(reads, 3);
  assert.deepEqual(
    calls,
    Array.from({ length: 3 }, () => ["verify", "test-token", true]),
  );
  assert.deepEqual(first, { uid, tenantId, role: "admin" });
});

test("token revocation after success fails before rereading membership", async () => {
  let revoked = false;
  const { authorize, calls } = fixture({
    verifyIdToken: async (_token, checkRevoked) => {
      assert.equal(checkRevoked, true);
      if (revoked) throw new Error("private-detail");
      return decoded();
    },
  });
  await authorize(header);
  revoked = true;
  await assert.rejects(authorize(header), denied);
  assert.deepEqual(calls, [["membership", `/users/${uid}`]]);
});

test("caller and token role/tenant/email never override membership", async () => {
  const { authorize } = fixture({
    verifyIdToken: async () => ({
      ...decoded(),
      role: "admin",
      tenantId: "attacker",
      email: "admin@example.invalid",
    }),
    readMembership: async () => membership("editor"),
  });
  await assert.rejects(
    authorize(header, { tenantId, role: "admin", testUser: true }),
    denied,
  );
  await assert.rejects(
    authorize({ authorizationHeader: header, role: "admin" }),
    denied,
  );
});

test("config is captured once and valid path identifiers are never normalized", async () => {
  const memberUid = "Member.1_test-user";
  const paths = [];
  const config = {
    tenantId,
    verifyIdToken: async () => ({ ...decoded(), uid: memberUid }),
    readMembership: async (path) => {
      paths.push(path);
      return membership();
    },
  };
  const authorize = createArchiveAuthorizer(config);
  config.tenantId = "attacker";
  config.readMembership = () => assert.fail("mutated adapter used");
  assert.deepEqual(await authorize(header), {
    uid: memberUid,
    tenantId,
    role: "manager",
  });
  assert.deepEqual(paths, [`/users/${memberUid}`]);
});

test("inherited authorization fields and throwing getters fail closed", async () => {
  const poisoned = Object.defineProperty({}, "uid", {
    get() {
      throw new Error("private-detail test-token");
    },
  });
  poisoned.firebase = decoded().firebase;
  for (const claims of [Object.create(decoded()), poisoned]) {
    const { authorize, calls } = fixture({ verifyIdToken: async () => claims });
    await assert.rejects(authorize(header), denied);
    assert.deepEqual(calls, []);
  }
  const { authorize } = fixture({
    readMembership: async () => Object.create(membership()),
  });
  await assert.rejects(authorize(header), denied);
  assert.throws(
    () =>
      createArchiveAuthorizer({
        get tenantId() {
          throw new Error("private-detail test-token");
        },
      }),
    denied,
  );
});

test("sync throws and async dependency failures expose neither causes nor tokens", async () => {
  for (const dependency of ["verifyIdToken", "readMembership"]) {
    for (const fail of [
      () => {
        throw new Error("private-detail test-token");
      },
      async () => {
        throw { token: "test-token", detail: "private-detail" };
      },
    ]) {
      const { authorize, calls } = fixture({ [dependency]: fail });
      await assert.rejects(authorize(header), denied);
      if (dependency === "verifyIdToken") assert.deepEqual(calls, []);
    }
  }
});
