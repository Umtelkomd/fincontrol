import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onInit } from "firebase-functions/v2/core";
import { onRequest } from "firebase-functions/v2/https";
import { initializeArchiveRuntime } from "./invoiceArchive/runtime.mjs";

let handler;
onInit(() => {
  handler = initializeArchiveRuntime(process.env, {
    initializeApp,
    getAuth,
    getFirestore,
    getStorage,
  });
});

// Region is proposed metadata, not production location or activation approval.
export const invoicePdfArchive = onRequest(
  {
    region: "europe-west3",
    memory: "512MiB",
    concurrency: 2,
    maxInstances: 2,
    timeoutSeconds: 60,
  },
  (req, res) => handler(req, res),
);
