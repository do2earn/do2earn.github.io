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
  async function fetchJson(url) { const response = await fetch(url, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" }); if (!response.ok) throw new Error("GitHub request failed (" + response.status + ") for " + url); return response.json(); }
  async function loadProjectFiles(project) {
    const repoInfo = await fetchJson("https://api.github.com/repos/" + project.repository); const branch = repoInfo.default_branch || project.branch;
    const tree = await fetchJson("https://api.github.com/repos/" + project.repository + "/git/trees/" + encodeURIComponent(branch) + "?recursive=1");
    if (tree.truncated) throw new Error("GitHub returned a truncated file tree. The project is too large for a complete scan.");
    const allowed = new Set(rules.scan.extensions); const files = (tree.tree || []).filter(item => item.type === "blob" && allowed.has("." + item.path.split(".").pop().toLowerCase()));
    if (!files.length) throw new Error("No supported source files were found in " + project.repository + ".");
    const selected = files.slice(0, rules.scan.maxFiles); let cursor = 0; const contents = [];
    async function worker() { while (cursor < selected.length) { const item = selected[cursor++]; try { const response = await fetch("https://raw.githubusercontent.com/" + project.repository + "/" + encodeURIComponent(branch) + "/" + item.path.split("/").map(encodeURIComponent).join("/"), { cache: "no-store" }); if (response.ok) contents.push({ path: item.path, text: await response.text() }); } catch (_) {} } }
    await Promise.all(Array.from({ length: rules.scan.concurrency }, worker)); if (!contents.length) throw new Error("GitHub source files could not be downloaded. Please retry after a short delay."); return { branch, totalFiles: files.length, contents };
  }
  function evaluate(files) {
    const html = files.filter(f => /\.(html?|HTML?)$/.test(f.path)); const all = html.map(f => f.text); const joined = files.map(f => f.text).join("\n");
    const test = (regex, source) => regex.test(source); const count = (regex, source) => (source.match(regex) || []).length; const hasHtml = html.length > 0;
    const results = {
      html:[hasHtml,hasHtml?html.length+" HTML file(s) found.":"No HTML files were found."],
      title:[hasHtml&&all.every(s=>test(/<title\b[^>]*>[\s\S]*?\S[\s\S]*?<\/title>/i,s)),"HTML files checked: "+html.length],
      description:[hasHtml&&all.every(s=>test(/<meta\b(?=[^>]*\bname\s*=\s*[\"']description[\"'])[^>]*\bcontent\s*=\s*[\"'][^\"']+\s*[\"'][^>]*>/i,s)),"HTML files checked: "+html.length],
      h1:[hasHtml&&all.every(s=>test(/<h1\b[^>]*>[\s\S]*?\S[\s\S]*?<\/h1>/i,s)),"HTML files checked: "+html.length],
      lang:[hasHtml&&all.every(s=>test(/<html\b[^>]*\blang\s*=/i,s)),"HTML files checked: "+html.length],
      viewport:[hasHtml&&all.every(s=>test(/<meta\b(?=[^>]*\bname\s*=\s*[\"']viewport[\"'])/i,s)),"HTML files checked: "+html.length],
      canonical:[hasHtml&&all.every(s=>test(/<link\b(?=[^>]*\brel\s*=\s*[\"'][^\"']*canonical)/i,s)),"HTML files checked: "+html.length],
      "robots-meta":[!test(/<meta\b(?=[^>]*\bname\s*=\s*[\"']robots[\"'])[^>]*\bcontent\s*=\s*[\"'][^\"']*noindex/i,joined),"Searchable source files checked"],
      og:[hasHtml&&all.every(s=>test(/property\s*=\s*[\"']og:title[\"']/i,s)&&test(/property\s*=\s*[\"']og:description[\"']/i,s)),"HTML files checked: "+html.length],
      twitter:[hasHtml&&all.some(s=>test(/name\s*=\s*[\"']twitter:card[\"']/i,s)),"At least one HTML page should declare a Twitter card"],
      alt:[hasHtml&&!test(/<img\b(?![^>]*\balt\s*=)[^>]*>|<img\b[^>]*\balt\s*=\s*[\"']\s*[\"'][^>]*>/i,joined),"Image tags found: "+count(/<img\b/gi,joined)],
      schema:[test(/application\/ld\+json|itemscope/i,joined),"JSON-LD or microdata patterns searched"],
      sitemap:[files.some(f=>/(^|\/)sitemap[^/]*\.xml$/i.test(f.path)),"Repository file tree checked"],
      "robots-file":[files.some(f=>/(^|\/)robots\.txt$/i.test(f.path)),"Repository file tree checked"],
      https:[!test(/(?:href|src|content)\s*=\s*[\"']http:\/\//i,joined),"Absolute asset and metadata references searched"],
      "heading-order":[hasHtml&&all.every(s=>test(/<h1\b/i,s)&&!test(/<h[3-6]\b[\s\S]{0,120}?<\/h[3-6]>\s*<h[1-2]\b/i,s)),"HTML heading markup inspected"],
      "image-loading":[hasHtml&&all.every(s=>[...s.matchAll(/<img\b[^>]*>/gi)].every(m=>/\bloading\s*=\s*[\"']lazy[\"']/i.test(m[0])||/\bfetchpriority\s*=\s*[\"']high[\"']/i.test(m[0])),"Image tags found: "+count(/<img\b/gi,joined)],
      "css-imports":[count(/@import\b/gi,joined)<=2,count(/@import\b/gi,joined)+" CSS @import statement(s) found"],
      "mixed-content":[!test(/(?:src|href)\s*=\s*[\"']http:\/\/(?!localhost)/i,joined),"Source files searched for insecure asset URLs"],
      "social-image":[hasHtml&&all.some(s=>test(/property\s*=\s*[\"']og:image[\"']/i,s)),"Open Graph image metadata searched"]
    };
    return rules.checks.map(rule=>{const result=results[rule.id];if(!result)return{...rule,status:"UNKNOWN",detail:"This check is not implemented in the current scanner."};const applicable=["sitemap","robots-file","schema","css-imports","mixed-content","https"].includes(rule.id);const status=!hasHtml&&!applicable?"UNKNOWN":result[0]?"PASS":"FAIL";return{...rule,status,detail:result[1]};});
  }
  function summarize(checks){const pass=checks.filter(x=>x.status==="PASS").length;const fail=checks.filter(x=>x.status==="FAIL").length;const unknown=checks.filter(x=>x.status==="UNKNOWN").length;const determined=pass+fail;return{pass,fail,unknown,determined,total:checks.length,score:determined?Math.round(pass/determined*100):null};}
  async function runAudit(){errorBox.hidden=true;helper.textContent="Loading SEO checklist and scanning the selected GitHub project…";setBusy(true);try{if(!rules){const response=await fetch(RULES_URL+"?v="+Date.now(),{cache:"no-store"});if(!response.ok)throw new Error("Could not load seo-checklist.json.");rules=await response.json();}const projectId=$("project-select").value;const project=rules.projects[projectId];if(!project)throw new Error("Unknown project configuration.");const data=await loadProjectFiles(project);const checks=evaluate(data.contents);const summary=summarize(checks);const report={projectId,projectName:project.name,repository:project.repository+" ("+data.branch+")",website:project.website,auditedAt:new Date().toISOString(),filesScanned:data.contents.length,filesAvailable:data.totalFiles,summary,score:summary.score,checks,note:(data.totalFiles>data.contents.length?"Partial scan: "+data.contents.length+" of "+data.totalFiles+" supported source files were scanned because the configured safety limit was reached. ":"All "+data.contents.length+" supported source files in the repository were scanned. ")+"Every check is recalculated on each run. This source-code audit does not inspect live rendered pages, Google indexing, Core Web Vitals or backlinks. Off-Page SEO remains disabled. Some checks still require manual verification."};renderReport(report);helper.textContent="Check completed. "+data.contents.length+" source files were inspected.";}catch(error){showError(error.message||"The SEO scan could not be completed.");helper.textContent="The latest scan failed. No new report was saved.";}finally{setBusy(false);}}
  button.addEventListener("click",runAudit);$("rerun-button").addEventListener("click",runAudit);$("project-select").addEventListener("change",()=>{emptyState.hidden=false;reportContent.hidden=true;errorBox.hidden=true;});
  try{const projectId=$("project-select").value;const saved=JSON.parse(localStorage.getItem("do2earn-seo-bot:last-report:"+projectId)||"null");if(saved&&Array.isArray(saved.checks))renderReport(saved);}catch(_){}
})();