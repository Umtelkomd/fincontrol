# Invoice obligation ranking Worker

Cloudflare Worker Free backend for `POST /rank-invoice-obligations`. It verifies a Firebase ID token, resolves the caller's role and tenant from Firestore, reads obligations through Firestore REST under that same token, and returns the provider-neutral `{ matches, fallback }` response. It never writes to Firestore.

## Local checks and development

```bash
npm install --prefix worker
npm test --prefix worker
npm run typecheck --prefix worker
cp worker/.dev.vars.example worker/.dev.vars
# Edit worker/.dev.vars locally and insert the development TypeSafe key.
cd worker
npx wrangler dev
```

Set `FIREBASE_PROJECT_ID` and `ALLOWED_ORIGIN` in `wrangler.toml` for the intended local environment before starting Wrangler. `worker/.dev.vars` is git-ignored; never commit it or place a real TypeSafe/Jev key in any tracked file.

Send requests to the local URL shown by Wrangler, for example `http://localhost:8787/rank-invoice-obligations`, with `Authorization: Bearer <Firebase ID token>` and JSON containing only the six supported invoice fields.

## Free deployment setup

1. Keep the Worker on the Cloudflare Workers Free plan.
2. Set production `FIREBASE_PROJECT_ID` and the exact browser origin in the `[vars]` section of `wrangler.toml` (or equivalent Cloudflare non-secret variables).
3. Create the encrypted secret binding interactively:

   ```bash
   cd worker
   npx wrangler secret put TYPESAFE_API_KEY
   ```

4. When deployment is separately authorized, deploy with `npx wrangler deploy` and set the browser's public `VITE_OBLIGATION_MATCHER_URL` to `https://<worker-name>.<account-subdomain>.workers.dev/rank-invoice-obligations` (or the configured custom-domain URL).

No Cloudflare deployment, authentication, or secret creation was performed as part of this change.
