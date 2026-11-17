const PROJECTS = {
  "steem-flags": { name: "Steem Flags", origin: "https://steemflags.do2earn.dev" },
  "steem-games": { name: "Steem Games", origin: "https://steemgames.do2earn.dev" }
};
const MAX_PAGES = 25;
const MAX_HTML_BYTES = 2_000_000;
const ALLOWED_ORIGIN = "https://do2earn.dev";

function response(data, status = 200, origin = ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      "Vary": "Origin"
    }
  });
}
function text(html, pattern) { const match = html.match(pattern); return match ? match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : ""; }
function attrs(tag) {
  const out = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return out;
}
function absolute(value, base) { try { return new URL(value, base); } catch { return null; } }
function check(id, title, status, detail, evidence = "") { return { id, title, status, detail, evidence }; }
function evaluate(items) {
  const pass = items.filter(x => x.status === "PASS").length;
  const fail = items.filter(x => x.status === "FAIL").length;
  const unknown = items.filter(x => x.status === "UNKNOWN").length;
  const determined = pass + fail;
  return { pass, fail, unknown, determined, total: items.length, score: determined ? Math.round(pass / determined * 100) : null };
}
async function safeFetch(url, init = {}) {
  return fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000), ...init });
}
async function getText(url) {
  const res = await safeFetch(url, { headers: { "User-Agent": "Do2EarnSEOAudit/1.0 (+https://do2earn.dev)" } });
  if (!res.ok) return { response: res, body: "" };
  const length = Number(res.headers.get("content-length") || 0);
  if (length > MAX_HTML_BYTES) throw new Error("Resource exceeds the audit size limit.");
  const body = await res.text();
  if (body.length > MAX_HTML_BYTES) throw new Error("Resource exceeds the audit size limit.");
  return { response: res, body };
}
async function inspectPage(url) {
  const { response: res, body: html } = await getText(url);
  if (!res.ok) return { url, finalUrl: res.url || url, status: res.status, html: "" };
  const title = text(html, /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const descriptionTag = (html.match(/<meta\b[^>]*>/gi) || []).find(tag => (attrs(tag).name || "").toLowerCase() === "description");
  const description = descriptionTag ? attrs(descriptionTag).content || "" : "";
  const canonicalTag = (html.match(/<link\b[^>]*>/gi) || []).find(tag => (attrs(tag).rel || "").toLowerCase().split(/\s+/).includes("canonical"));
  const canonical = canonicalTag ? attrs(canonicalTag).href || "" : "";
  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)].map(m => m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => attrs(m[0]));
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map(m => attrs(m[0])).map(a => a.href).filter(Boolean);
  const meta = (html.match(/<meta\b[^>]*>/gi) || []).map(attrs);
  const robots = meta.find(m => (m.name || "").toLowerCase() === "robots");
  const viewport = meta.some(m => (m.name || "").toLowerCase() === "viewport");
  const ogTitle = meta.some(m => (m.property || "").toLowerCase() === "og:title");
  const ogDescription = meta.some(m => (m.property || "").toLowerCase() === "og:description");
  const hasSchema = /application\/ld\+json/i.test(html) || /itemscope/i.test(html);
  const lang = /<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(html);
  const headings = [...html.matchAll(/<h[1-6]\b/gi)].length;
  const noindex = /\bnoindex\b/i.test(robots?.content || "");
  return { url, finalUrl: res.url || url, status: res.status, html, title, description, canonical, h1, images, links, viewport, ogTitle, ogDescription, hasSchema, lang, headings, noindex };
}
function parseSitemap(xml, base) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m => absolute(m[1].trim(), base)).filter(u => u && u.origin === base.origin && u.protocol === "https:").map(u => u.href);
}
async function crawl(project) {
  const base = new URL(project.origin);
  let robotsText = "";
  let robotsStatus = 0;
  try { const r = await safeFetch(base.origin + "/robots.txt"); robotsStatus = r.status; if (r.ok) robotsText = (await r.text()).slice(0, 100000); } catch {}
  const sitemapCandidates = [...robotsText.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map(m => m[1]);
  sitemapCandidates.push(base.origin + "/sitemap.xml");
  let sitemapUrls = [];
  let sitemapStatus = 0;
  for (const candidate of [...new Set(sitemapCandidates)]) {
    try {
      const u = new URL(candidate);
      if (u.origin !== base.origin || u.protocol !== "https:") continue;
      const r = await safeFetch(u.href);
      if (r.ok) { sitemapStatus = r.status; sitemapUrls = parseSitemap(await r.text(), base); if (sitemapUrls.length) break; }
      else if (!sitemapStatus) sitemapStatus = r.status;
    } catch {}
  }
  let queue = [base.origin + "/"];
  for (const url of sitemapUrls) if (!queue.includes(url)) queue.push(url);
  const seen = new Set();
  const pages = [];
  while (queue.length && pages.length < MAX_PAGES) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const page = await inspectPage(url);
      pages.push(page);
      if (page.html) {
        for (const href of page.links) {
          const u = absolute(href, url);
          if (u && u.origin === base.origin && u.protocol === "https:" && !u.hash && !/\.(?:png|jpe?g|gif|svg|webp|pdf|zip|css|js|ico)(?:$|\?)/i.test(u.pathname) && !seen.has(u.href) && queue.length < MAX_PAGES * 3) queue.push(u.href);
        }
      }
    } catch { pages.push({ url, status: 0, html: "" }); }
  }
  return { pages, robotsText, robotsStatus, sitemapStatus, sitemapUrls };
}
function buildChecks(data) {
  const { pages, robotsText, robotsStatus, sitemapStatus, sitemapUrls } = data;
  const okPages = pages.filter(p => p.html);
  const pageCount = okPages.length;
  const all = fn => pageCount ? okPages.every(fn) : null;
  const any = fn => pageCount ? okPages.some(fn) : null;
  const badTitle = okPages.filter(p => !p.title || p.title.length < 10 || p.title.length > 60);
  const duplicateTitles = new Set(okPages.map(p => p.title.toLowerCase()).filter(Boolean)).size < okPages.filter(p => p.title).length;
  const badDesc = okPages.filter(p => !p.description || p.description.length < 50 || p.description.length > 160);
  const badH1 = okPages.filter(p => p.h1.length !== 1);
  const missingCanonical = okPages.filter(p => !p.canonical || absolute(p.canonical, p.url)?.href.replace(/\/$/, "") !== p.url.replace(/\/$/, ""));
  const missingAlt = okPages.flatMap(p => p.images.filter(i => !("alt" in i)));
  const missingAltCount = okPages.flatMap(p => p.images.filter(i => !("alt" in i) || !i.alt.trim())).length;
  const internalLinks = okPages.flatMap(p => p.links).map(h => absolute(h, pages[0]?.url || "https://invalid.local")).filter(u => u && u.origin === new URL(pages[0]?.url || "https://invalid.local").origin).length;
  const externalLinks = okPages.flatMap(p => p.links).map(h => absolute(h, pages[0]?.url || "https://invalid.local")).filter(u => u && u.origin !== new URL(pages[0]?.url || "https://invalid.local").origin).length;
  const hasNoindex = okPages.filter(p => p.noindex);
  const allHttps = pages.every(p => (p.finalUrl || p.url).startsWith("https://"));
  const schemaPages = okPages.filter(p => p.hasSchema).length;
  const checks = [];
  const add = (id, title, result, passDetail, failDetail, evidence = "") => checks.push(check(id, title, result === null ? "UNKNOWN" : result ? "PASS" : "FAIL", result === null ? "Could not verify because no crawlable HTML pages were available." : result ? passDetail : failDetail, evidence));
  add("availability", "Website and page availability", pages.length > 0 && pageCount > 0, pageCount + " HTML pages returned accessible responses.", "The crawler could not retrieve usable HTML pages.", pageCount + " accessible / " + pages.length + " attempted");
  add("https", "HTTPS URLs", pages.length ? allHttps : null, "All inspected URLs use HTTPS.", "One or more inspected URLs are not HTTPS.");
  add("robots", "robots.txt availability", robotsStatus === 200, "robots.txt is publicly accessible.", robotsStatus ? "robots.txt returned HTTP " + robotsStatus + "." : "robots.txt could not be reached.");
  add("robots-policy", "Robots crawl policy", robotsStatus === 200 ? !/^\s*User-agent:\s*\*\s*[\s\S]*?Disallow:\s*\/\s*$/im.test(robotsText) : null, "No global rule blocking all crawling was detected.", "robots.txt appears to disallow all crawling.");
  add("sitemap", "XML sitemap availability", sitemapStatus === 200 && sitemapUrls.length > 0, "Sitemap is accessible and contains " + sitemapUrls.length + " same-site URLs.", "No readable sitemap with same-site URLs was found.", sitemapStatus ? "HTTP " + sitemapStatus : "Not found");
  add("titles", "Unique descriptive page titles", pageCount ? badTitle.length === 0 && !duplicateTitles : null, "All inspected pages have distinct titles within the recommended 10–60 character range.", badTitle.length + " page(s) have missing or unusual title lengths" + (duplicateTitles ? "; duplicate titles were detected." : "."), pageCount + " pages checked");
  add("descriptions", "Meta descriptions", pageCount ? badDesc.length === 0 : null, "All inspected pages have descriptions within the recommended 50–160 character range.", badDesc.length + " page(s) have missing or unusually sized meta descriptions.", pageCount + " pages checked");
  add("headings", "Single H1 heading per page", pageCount ? badH1.length === 0 : null, "Every inspected page contains exactly one H1.", badH1.length + " page(s) do not contain exactly one H1.", pageCount + " pages checked");
  add("canonical", "Canonical URLs", pageCount ? missingCanonical.length === 0 : null, "Every inspected page declares a canonical URL matching its crawled URL.", missingCanonical.length + " page(s) have a missing or non-matching canonical URL.", pageCount + " pages checked");
  add("image-alt", "Image ALT attributes", pageCount ? missingAltCount === 0 : null, "All inspected images include non-empty ALT attributes.", missingAltCount + " image(s) have missing or empty ALT text.", missingAltCount + " missing / empty ALT attributes");
  add("internal-links", "Internal link discovery", pageCount ? internalLinks > 0 : null, internalLinks + " internal links were discovered.", "No internal links were discovered in inspected page HTML.");
  add("external-links", "External link discovery", pageCount ? externalLinks > 0 : null, externalLinks + " external links were discovered.", "No external links were discovered. This is informational and not necessarily an SEO defect.");
  add("mobile", "Mobile viewport configuration", all(p => p.viewport), "All inspected pages declare a mobile viewport.", "One or more pages are missing a viewport meta tag.");
  add("language", "HTML language attribute", all(p => p.lang), "All inspected pages declare an HTML language.", "One or more pages are missing the HTML lang attribute.");
  add("open-graph", "Open Graph metadata", all(p => p.ogTitle && p.ogDescription), "All inspected pages include og:title and og:description.", "One or more pages are missing og:title or og:description.");
  add("schema", "Structured data presence", any(p => p.hasSchema), "Structured data markup was detected on at least one inspected page.", "No JSON-LD or microdata structured data was detected.");
  add("indexability", "Page indexability directives", pageCount ? hasNoindex.length === 0 : null, "No inspected page contains a robots noindex directive.", hasNoindex.length + " inspected page(s) contain noindex.");
  add("page-status", "Successful HTTP page responses", pageCount ? pages.every(p => p.status >= 200 && p.status < 400) : null, "All attempted pages returned successful HTTP responses.", pages.filter(p => p.status < 200 || p.status >= 400).length + " page(s) returned errors or could not be fetched.");
  return checks;
}
async function addPageSpeed(checks, baseUrl, env) {
  if (!env.PAGESPEED_API_KEY) {
    checks.push(check("pagespeed-mobile", "Mobile performance (PageSpeed Insights)", "UNKNOWN", "PageSpeed Insights API key is not configured. Add PAGESPEED_API_KEY as a Cloudflare Worker secret to enable this check."));
    checks.push(check("pagespeed-desktop", "Desktop performance (PageSpeed Insights)", "UNKNOWN", "PageSpeed Insights API key is not configured. Add PAGESPEED_API_KEY as a Cloudflare Worker secret to enable this check."));
    return;
  }
  for (const strategy of ["mobile", "desktop"]) {
    try {
      const url = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
      url.searchParams.set("url", baseUrl);
      url.searchParams.set("strategy", strategy);
      url.searchParams.set("category", "PERFORMANCE");
      url.searchParams.set("key", env.PAGESPEED_API_KEY);
      const res = await safeFetch(url.href);
      if (!res.ok) throw new Error("PageSpeed API HTTP " + res.status);
      const data = await res.json();
      const score = Math.round((data.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
      checks.push(check("pagespeed-" + strategy, strategy[0].toUpperCase() + strategy.slice(1) + " performance (PageSpeed Insights)", score >= 50 ? "PASS" : "FAIL", "Lighthouse performance score: " + score + "/100.", "Lighthouse performance score: " + score + "/100.", "Performance score " + score));
    } catch (e) {
      checks.push(check("pagespeed-" + strategy, strategy[0].toUpperCase() + strategy.slice(1) + " performance (PageSpeed Insights)", "UNKNOWN", "PageSpeed could not return a usable result: " + e.message));
    }
  }
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsOrigin = origin === ALLOWED_ORIGIN || origin === "https://www.do2earn.dev" ? origin : ALLOWED_ORIGIN;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": corsOrigin, "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin" } });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return response({ ok: true, service: "Do2Earn SEO Audit Engine", offPage: "disabled" }, 200, corsOrigin);
    if (request.method !== "POST" || url.pathname !== "/audit") return response({ error: "Not found" }, 404, corsOrigin);
    if (origin && origin !== ALLOWED_ORIGIN && origin !== "https://www.do2earn.dev") return response({ error: "Origin not allowed" }, 403, corsOrigin);
    let body;
    try { body = await request.json(); } catch { return response({ error: "Invalid JSON request" }, 400, corsOrigin); }
    const project = PROJECTS[body.projectId];
    if (!project) return response({ error: "Unknown project. Only configured Do2Earn projects can be audited." }, 400, corsOrigin);
    try {
      const crawlData = await crawl(project);
      const checks = buildChecks(crawlData);
      await addPageSpeed(checks, project.origin, env);
      const summary = evaluate(checks);
      return response({
        projectId: body.projectId,
        projectName: project.name,
        baseUrl: project.origin,
        auditedAt: new Date().toISOString(),
        pagesCrawled: crawlData.pages.length,
        sitemapUrlsFound: crawlData.sitemapUrls.length,
        summary,
        score: summary.score,
        checks,
        note: "Automated crawl of up to " + MAX_PAGES + " same-domain pages. PASS and FAIL are based on detected evidence. UNKNOWN means the check could not be verified; it is excluded from the verified score. Off-page SEO is disabled."
      }, 200, corsOrigin);
    } catch (error) {
      return response({ error: "Audit failed: " + error.message }, 502, corsOrigin);
    }
  }
};