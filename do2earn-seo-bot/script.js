(() => {
  "use strict";
  const RULES_URL = "./seo-checklist.json";
  const $ = id => document.getElementById(id);
  const button = $("check-button");
  const helper = $("helper-text");
  const errorBox = $("error-box");
  const emptyState = $("empty-state");
  const reportContent = $("report-content");
  let rules = null;
  function setBusy(busy) { button.disabled = busy; button.textContent = busy ? "Scanning project files…" : "Check SEO"; $("rerun-button").disabled = busy; }
  function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
  function renderReport(report) {
    emptyState.hidden = true; reportContent.hidden = false;
    $("report-project").textContent = report.projectName; $("report-url").textContent = report.repository;
    $("audit-time").textContent = "Checked " + new Date(report.auditedAt).toLocaleString();
    $("score-value").textContent = report.score === null ? "—" : report.score + "%";
    $("pass-value").textContent = report.summary.pass; $("fail-value").textContent = report.summary.fail; $("unknown-value").textContent = report.summary.unknown;
    $("coverage-text").textContent = report.summary.determined + " of " + report.summary.total + " checks determined"; $("pages-text").textContent = report.filesScanned + " source files scanned";
    $("progress-fill").style.width = (report.score || 0) + "%"; $("progress-bar").setAttribute("aria-valuenow", String(report.score || 0));
    const list = $("checklist"); list.replaceChildren(); let category = "";
    report.checks.forEach(check => {
      if (check.category !== category) { category = check.category; const heading = document.createElement("h4"); heading.className = "check-category"; heading.textContent = category; list.append(heading); }
      const row = document.createElement("article"); row.className = "check-item status-" + check.status.toLowerCase();
      const icon = document.createElement("span"); icon.className = "result-icon"; icon.textContent = check.status === "PASS" ? "✓" : check.status === "FAIL" ? "!" : "?";
      const body = document.createElement("span"); body.className = "check-copy";
      const title = document.createElement("strong"); title.className = "check-title"; title.textContent = check.title;
      const detail = document.createElement("span"); detail.className = "check-detail"; detail.textContent = check.detail; body.append(title, detail);
      if (check.evidence) { const evidence = document.createElement("span"); evidence.className = "check-evidence"; evidence.textContent = check.evidence; body.append(evidence); }
      const badge = document.createElement("span"); badge.className = "result-status"; badge.textContent = check.status; row.append(icon, body, badge); list.append(row);
    });
    $("report-note").textContent = report.note;
    try { localStorage.setItem("do2earn-seo-bot:last-report:" + report.projectId, JSON.stringify(report)); } catch (_) {}
  }
  function retryTime(response) {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter && /^\\d+$/.test(retryAfter)) return new Date(Date.now() + Number(retryAfter) * 1000).toLocaleString();
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0) return new Date(reset * 1000).toLocaleString();
    return "";
  }
  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      cache: "no-store"
    });
    if (!response.ok) {
      const raw = await response.text();
      let message = "";
      try { const payload = JSON.parse(raw); message = payload.message || ""; }
      catch (_) { message = raw.slice(0, 300); }
      const rateLimited = response.status === 429 ||
        response.headers.get("x-ratelimit-remaining") === "0" ||
        /rate limit|secondary rate limit|abuse detection/i.test(message);
      const retry = retryTime(response);
      let detail = "GitHub API returned HTTP " + response.status + ".";
      if (message) detail += " GitHub: " + message;
      if (rateLimited) detail += retry ? " Rate limit reached. Try again after: " + retry + "." : " GitHub rate limit reached. Please wait before retrying.";
      else if (response.status === 403) detail += " This may be a permission restriction or an API rate limit.";
      else if (response.status === 404) detail += " The repository or requested branch/tree was not found, or is not accessible.";
      throw new Error(detail);
    }
    return response.json();
  }
  async function loadProjectFiles(project) {
    const branch = project.branch || "main";
    const tree = await fetchJson("https://api.github.com/repos/" + project.repository + "/git/trees/" + encodeURIComponent(branch) + "?recursive=1");
    if (tree.truncated) throw new Error("GitHub returned a truncated file tree. The project is too large for a complete scan.");
    const allowed = new Set(rules.scan.extensions); const files = (tree.tree || []).filter(item => item.type === "blob" && allowed.has("." + item.path.split(".").pop().toLowerCase()));
    if (!files.length) throw new Error("No supported source files were found in " + project.repository + ".");
    const selected = files.slice(0, rules.scan.maxFiles); let cursor = 0; const contents = [];
    async function worker() { while (cursor < selected.length) { const item = selected[cursor++]; try { const response = await fetch("https://raw.githubusercontent.com/" + project.repository + "/" + encodeURIComponent(branch) + "/" + item.path.split("/").map(encodeURIComponent).join("/"), { cache: "no-store" }); if (response.ok) contents.push({ path: item.path, text: await response.text() }); } catch (_) {} } }
    await Promise.all(Array.from({ length: rules.scan.concurrency }, worker)); if (!contents.length) throw new Error("GitHub source files could not be downloaded. Please retry after a short delay."); return { branch, totalFiles: files.length, allPaths: files.map(item => item.path), contents };
  }
  function evaluate(files, allPaths = files.map(file => file.path)) {
    const isDocument = source => /<!doctype\s+html|<html\b/i.test(source);
    const isRedirect = source => /<meta\b[^>]*http-equiv\s*=\s*["']refresh["']/i.test(source) || /\blocation\.replace\s*\(/i.test(source);
    // Only complete, top-level HTML documents are treated as public pages.
    // Fragments, redirect aliases, and nested admin utilities are not page-level SEO targets.
    const htmlFiles = files.filter(file => /\.(html?|HTML?)$/.test(file.path) && isDocument(file.text));
    const publicPages = htmlFiles.filter(file =>
      !file.path.includes("/") &&
      !/^(?:sg-.*checker|.*-checker)\.html?$/i.test(file.path) &&
      !isRedirect(file.text)
    );
    const html = publicPages.length ? publicPages : htmlFiles.filter(file => file.path === "index.html");
    const all = html.map(file => file.text);
    const joined = files.map(file => file.text).join("\n");
    const publicJoined = all.join("\n");
    const count = (regex, source) => (source.match(regex) || []).length;
    const test = (regex, source) => regex.test(source);
    const hasHtml = html.length > 0;
    const pageNames = html.map(file => file.path).join(", ") || "No eligible public HTML documents";
    const perPage = (regex, label) => {
      if (!hasHtml) return [null, "No eligible public HTML documents were found."];
      const missing = html.filter(file => !test(regex, file.text)).map(file => file.path);
      return [missing.length === 0, missing.length ? "Missing on: " + missing.join(", ") : "Verified on: " + pageNames];
    };
    const titleCheck = perPage(/<title\b[^>]*>[\s\S]*?\S[\s\S]*?<\/title>/i, "title");
    const descriptionCheck = perPage(/<meta\b(?=[^>]*\bname\s*=\s*["']description["'])[^>]*\bcontent\s*=\s*["'][^"']+\s*["'][^>]*>/i, "description");
    const langCheck = perPage(/<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i, "language");
    const viewportCheck = perPage(/<meta\b(?=[^>]*\bname\s*=\s*["']viewport["'])[^>]*>/i, "viewport");
    const canonicalCheck = perPage(/<link\b(?=[^>]*\brel\s*=\s*["'][^"']*canonical)/i, "canonical");
    const h1Missing = html.filter(file => !/<h1\b[^>]*>[\s\S]*?\S[\s\S]*?<\/h1>/i.test(file.text));
    const h1Dynamic = h1Missing.filter(file => /<script\b|\bonload\s*=|document\.createElement|innerHTML|insertAdjacentHTML/i.test(file.text));
    const h1Check = !hasHtml ? [null, "No eligible public HTML documents were found."] :
      h1Missing.length === 0 ? [true, "A static H1 was found on: " + pageNames] :
      h1Missing.length === h1Dynamic.length ? [null, "No static H1 found in: " + h1Missing.map(file => file.path).join(", ") + ". JavaScript may render the heading; verify the live page."] :
      [false, "Missing static H1 on: " + h1Missing.filter(file => !h1Dynamic.includes(file)).map(file => file.path).join(", ") + (h1Dynamic.length ? "; dynamic/uncertain: " + h1Dynamic.map(file => file.path).join(", ") : "")];
    const hasRobotsNoindex = /<meta\b(?=[^>]*\bname\s*=\s*["']robots["'])[^>]*\bcontent\s*=\s*["'][^"']*\bnoindex\b/i.test(publicJoined);
    const imageTags = [...publicJoined.matchAll(/<img\b[^>]*>/gi)].map(match => match[0]);
    const missingAlt = imageTags.filter(tag => !/\balt\s*=/i.test(tag));
    const emptyAlt = imageTags.filter(tag => /\balt\s*=\s*["']\s*["']/i.test(tag));
    const imageWithoutHint = imageTags.filter(tag =>
      !/\bloading\s*=\s*["'](?:lazy|eager)["']/i.test(tag) &&
      !/\bfetchpriority\s*=\s*["']high["']/i.test(tag)
    );
    const paths = new Set(allPaths);
    const sitemapPaths = [...paths].filter(path => /(^|\/)sitemap[^/]*\.xml$/i.test(path));
    const robotsPaths = [...paths].filter(path => /(^|\/)robots\.txt$/i.test(path));
    const cssImports = count(/@import\b/gi, joined);
    const insecureAssets = [...joined.matchAll(/(?:src|href)\s*=\s*["']http:\/\/[^"']+/gi)].map(match => match[0]);
    const insecureCanonicalOrSitemap = /<link\b(?=[^>]*\brel\s*=\s*["'][^"']*canonical)[^>]*\bhref\s*=\s*["']http:\/\//i.test(publicJoined) || /<loc>\s*http:\/\//i.test(joined);
    const results = {
      html: [hasHtml, hasHtml ? html.length + " public HTML page(s) audited: " + pageNames : "No eligible public HTML documents were found."],
      title: titleCheck,
      description: descriptionCheck,
      h1: h1Check,
      lang: langCheck,
      viewport: viewportCheck,
      canonical: canonicalCheck,
      "robots-meta": [!hasRobotsNoindex, hasRobotsNoindex ? "A noindex directive was found in public page source." : "No accidental noindex directive found in public page source."],
      og: perPage(/property\s*=\s*["']og:title["']/i, "Open Graph"),
      twitter: perPage(/name\s*=\s*["']twitter:card["']/i, "Twitter card"),
      alt: [hasHtml ? missingAlt.length === 0 : null, "Public-page images: " + imageTags.length + "; missing ALT: " + missingAlt.length + "; empty ALT (may be decorative): " + emptyAlt.length],
      schema: [test(/application\/ld\+json|itemscope/i, publicJoined), "Structured data patterns searched in public page source."],
      sitemap: [sitemapPaths.length > 0, sitemapPaths.length ? "Found: " + sitemapPaths.join(", ") : "No sitemap XML file found in the repository tree."],
      "robots-file": [robotsPaths.length > 0, robotsPaths.length ? "Found: " + robotsPaths.join(", ") : "No robots.txt found in the repository tree."],
      https: [!insecureCanonicalOrSitemap, insecureCanonicalOrSitemap ? "An HTTP canonical or sitemap URL was found; use HTTPS." : "Canonical and sitemap URLs use HTTPS or no insecure URL was found."],
      "heading-order": [!hasHtml ? null : h1Missing.length && h1Missing.every(file => h1Dynamic.includes(file)) ? null : html.every(file => /<h1\b/i.test(file.text) && !/<h[3-6]\b[^>]*>[\s\S]{0,160}?<\/h[3-6]>\s*<h[1-2]\b/i.test(file.text)), "Heading markup inspected on: " + pageNames + ". Dynamic headings require live-page verification."],
      "image-loading": [!hasHtml ? null : imageTags.length === 0 ? true : imageWithoutHint.length === 0 ? true : null, "Public-page images: " + imageTags.length + "; without an explicit loading/fetch priority hint: " + imageWithoutHint.length + ". Missing hints are UNKNOWN because source code alone cannot determine whether an image is above or below the fold. Use eager/high priority for the hero image and lazy loading for below-the-fold images."],
      "css-imports": [cssImports <= 2, cssImports + " CSS @import statement(s) found across scanned source files."],
      "mixed-content": [insecureAssets.length === 0, insecureAssets.length ? insecureAssets.length + " HTTP asset reference(s) found." : "No insecure HTTP asset references found."],
      "social-image": perPage(/property\s*=\s*["']og:image["']/i, "social sharing image")
    };
    return rules.checks.map(rule => {
      const result = results[rule.id];
      if (!result) return { ...rule, status: "UNKNOWN", detail: "This check is not implemented in the current scanner." };
      const status = result[0] === null ? "UNKNOWN" : result[0] ? "PASS" : "FAIL";
      return { ...rule, status, detail: result[1] };
    });
  }
  function summarize(checks){const pass=checks.filter(x=>x.status==="PASS").length;const fail=checks.filter(x=>x.status==="FAIL").length;const unknown=checks.filter(x=>x.status==="UNKNOWN").length;const determined=pass+fail;return{pass,fail,unknown,determined,total:checks.length,score:determined?Math.round(pass/determined*100):null};}
  async function runAudit(){errorBox.hidden=true;helper.textContent="Loading SEO checklist and scanning the selected GitHub project…";setBusy(true);try{if(!rules){const response=await fetch(RULES_URL+"?v="+Date.now(),{cache:"no-store"});if(!response.ok)throw new Error("Could not load seo-checklist.json.");rules=await response.json();}const projectId=$("project-select").value;const project=rules.projects[projectId];if(!project)throw new Error("Unknown project configuration.");const data=await loadProjectFiles(project);const checks=evaluate(data.contents,data.allPaths);const summary=summarize(checks);const report={projectId,projectName:project.name,repository:project.repository+" ("+data.branch+")",website:project.website,auditedAt:new Date().toISOString(),filesScanned:data.contents.length,filesAvailable:data.totalFiles,publicPagesAudited:checks.find(x=>x.id==="html")?.detail||"",summary,score:summary.score,checks,note:(data.totalFiles>data.contents.length?"Partial scan: "+data.contents.length+" of "+data.totalFiles+" supported source files were scanned because the configured safety limit was reached. ":"All "+data.contents.length+" supported source files in the repository were scanned. ")+"Only complete public HTML documents are used for page-level checks; nested admin tools, redirect aliases and HTML fragments are excluded. Dynamic headings may be marked UNKNOWN for live verification. Every check is recalculated on each run. This source-code audit does not inspect live rendered pages, Google indexing, Core Web Vitals or backlinks. Off-Page SEO remains disabled. Some checks still require manual verification."};renderReport(report);helper.textContent="Check completed. "+data.contents.length+" source files were inspected.";}catch(error){showError(error.message||"The SEO scan could not be completed.");helper.textContent="The latest scan failed. No new report was saved.";}finally{setBusy(false);}}
  button.addEventListener("click",runAudit);$("rerun-button").addEventListener("click",runAudit);$("project-select").addEventListener("change",()=>{emptyState.hidden=false;reportContent.hidden=true;errorBox.hidden=true;});
  try{const projectId=$("project-select").value;const saved=JSON.parse(localStorage.getItem("do2earn-seo-bot:last-report:"+projectId)||"null");if(saved&&Array.isArray(saved.checks))renderReport(saved);}catch(_){}
})();