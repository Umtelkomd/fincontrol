import { createArchiveAuthorizer } from "./authorize.mjs";
import { createGcsArchiveStore } from "./gcsStore.mjs";
import { createArchiveUploader } from "./upload.mjs";
import { createArchiveReader } from "./read.mjs";
import { createArchiveHttpHandler } from "./http.mjs";

/** SDK-shaped dependencies are trusted, never derived from a request. */
export function createArchiveRuntime({ tenantId, auth, firestore, bucket }) {
  const authorize = createArchiveAuthorizer({
    tenantId,
    verifyIdToken: (token, checkRevoked) => auth.verifyIdToken(token, checkRevoked),
    async readMembership(path) {
      // Admin reads are authoritative on every gate; no UI or token role fallback.
      const snapshot = await firestore.doc(path).get();
      if (!snapshot.exists) return null;
      const data = snapshot.data();
      return data ? { tenantId: data.appId, role: data.role } : null;
    },
  });
  const store = createGcsArchiveStore({ bucket });
  return createArchiveHttpHandler({
    authorize,
    upload: createArchiveUploader({ authorize, store }),
    read: createArchiveReader({ authorize, store }),
  });
}

const EMULATOR_HOSTS = {
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
  // firebase-tools 15.29.0 lib/emulator/env.js sets the GCS endpoint with http://.
  STORAGE_EMULATOR_HOST: "http://127.0.0.1:9199",
};

function configuration(env) {
  const projectId = env.GCLOUD_PROJECT;
  const tenantId = env.ARCHIVE_TENANT_ID;
  const bucketName = env.ARCHIVE_BUCKET;
  const invalid = () => { throw new Error("Invalid archive server configuration"); };
  if (
    typeof projectId !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
    typeof tenantId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(tenantId) ||
    typeof bucketName !== "string" || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucketName)
  ) invalid();
  if (env.FUNCTIONS_EMULATOR === "true") {
    if (
      projectId !== "demo-fincontrol" ||
      tenantId !== "1:123456789:web:demo" ||
      bucketName !== "demo-fincontrol.appspot.com" ||
      !Object.entries(EMULATOR_HOSTS).every(([key, value]) => env[key] === value)
    ) invalid();
  } else if (
    projectId.startsWith("demo-") ||
    Object.keys(EMULATOR_HOSTS).some((key) => env[key] !== undefined)
  ) invalid();
  return { projectId, tenantId, bucketName };
}

/** Validate before touching any SDK, including when emulator routing is incomplete. */
export function initializeArchiveRuntime(env, sdk) {
  const { projectId, tenantId, bucketName } = configuration(env);
  const app = sdk.initializeApp({ projectId, storageBucket: bucketName });
  return createArchiveRuntime({
    tenantId,
    auth: sdk.getAuth(app),
    firestore: sdk.getFirestore(app),
    bucket: sdk.getStorage(app).bucket(bucketName),
  });
}
