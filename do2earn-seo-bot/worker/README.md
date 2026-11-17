# Do2Earn SEO Audit Worker

This Cloudflare Worker powers the automated On-Page and Technical SEO audit for:

- https://steemflags.do2earn.dev
- https://steemgames.do2earn.dev

Off-Page SEO is intentionally disabled.

## Deploy

1. Install Wrangler on a computer with Node.js: `npm install -g wrangler`.
2. Open this directory and authenticate: `npx wrangler login`.
3. Deploy: `npx wrangler deploy`.
4. Copy the generated `https://do2earn-seo-audit.<your-subdomain>.workers.dev` URL.
5. In `../script.js`, replace the `API_BASE` placeholder with that exact URL and commit the change to GitHub.

The worker can be deployed from the Cloudflare dashboard too: create a Worker named `do2earn-seo-audit`, paste `index.js`, and deploy. The `workers.dev` subdomain shown by Cloudflare is account-specific.

## Optional PageSpeed Insights

Without a key, mobile and desktop PageSpeed checks are returned as UNKNOWN; the rest of the audit works. To enable them, create a Google PageSpeed Insights API key and add it as a Worker secret:

`npx wrangler secret put PAGESPEED_API_KEY`

Never put API keys in GitHub files or browser JavaScript.

## Scope and safeguards

- Only the two hard-coded Do2Earn project hosts can be audited.
- The API does not accept arbitrary URLs.
- The crawler follows same-origin HTTPS links only and inspects at most 25 pages per run.
- Individual HTML responses are limited to 2 MB.
- Results are evidence-based PASS / FAIL / UNKNOWN.
- UNKNOWN checks are excluded from the verified score.
- The crawler does not claim Google indexing status; use Search Console for authoritative URL indexing data.
- Off-Page SEO and backlink analysis are not included.

## CORS

The Worker accepts browser requests from `https://do2earn.dev` and `https://www.do2earn.dev`. If the site is hosted on a different canonical origin, update `ALLOWED_ORIGIN` in `index.js`.

## GitHub Actions deployment

A workflow is included at `.github/workflows/deploy-seo-audit-worker.yml`. Add these repository Actions secrets under **Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with permission to edit Workers.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID.

After adding both secrets, push a change under `do2earn-seo-bot/worker/` or manually run **Deploy Do2Earn SEO Audit Worker** from the repository Actions tab. The workflow deploys the Worker; it does not configure the browser endpoint automatically.

After the first deployment, copy the exact `workers.dev` URL from the successful deployment log and set it as `API_BASE` in `do2earn-seo-bot/script.js`, then commit that one-line change. Until this endpoint is configured, the website will explain that the audit engine is not yet deployed rather than displaying fabricated results.
