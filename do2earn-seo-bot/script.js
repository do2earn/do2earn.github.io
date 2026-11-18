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
  async function fetchManifest(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error("Project file manifest could not be loaded (HTTP " + response.status + "). The automatic file-list workflow may not have completed yet. Please retry later.");
    return response.json();
  }
  function rawFileUrl(project, commit, path) {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    return "https://raw.githubusercontent.com/" + project.repository + "/" + commit + "/" + encodedPath;
  }
  async function loadProjectFiles(project) {
    const manifest = await fetchManifest(project.manifestUrl);
    if (!manifest || manifest.repository !== project.repository ||
        !/^[a-f0-9]{40}$/i.test(manifest.commit || "") ||
        !Array.isArray(manifest.files) || !Array.isArray(manifest.allPaths)) {
      throw new Error("The generated file manifest is invalid or belongs to a different repository. Please run the manifest workflow again.");
    }
    const allowed = new Set(rules.scan.extensions);
    const files = manifest.files.filter(path =>
      typeof path === "string" &&
      !path.startsWith("/") &&
      !path.split("/").includes("..") &&
      allowed.has("." + path.split(".").pop().toLowerCase())
    );
    if (!files.length) throw new Error("No supported source files were listed in the generated manifest for " + project.repository + ".");
    const selected = files.slice(0, rules.scan.maxFiles);
    let cursor = 0;
    const contents = [];
    const failed = [];
    async function worker() {
      while (cursor < selected.length) {
        const path = selected[cursor++];
        try {
          const response = await fetch(rawFileUrl(project, manifest.commit, path), { cache: "default" });
          if (!response.ok) {
            failed.push(path);
            continue;
          }
          contents.push({ path, text: await response.text() });
        } catch (_) {
          failed.push(path);
        }
      }
    }
    await Promise.all(Array.from({ length: rules.scan.concurrency }, worker));
    if (!contents.length) throw new Error("GitHub Raw could not provide the listed source files. Please retry after a short delay or regenerate the file manifest.");
    return {
      branch: manifest.branch || "main",
      commit: manifest.commit,
      generatedAt: manifest.generatedAt || null,
      totalFiles: files.length,
      selectedFiles: selected.length,
      allPaths: manifest.allPaths,
      contents,
      failedFiles: failed.length,
      manifestUrl: project.manifestUrl
    };
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
    // Classify only images whose own attributes or nearest semantic containers clearly identify their role.
    // Static source cannot reliably establish viewport position, so ambiguous images remain UNKNOWN.
    const imageLoading = (() => {
      const totals = { total: 0, hero: 0, below: 0, unknown: 0, heroMissing: 0, belowMissing: 0, unknownMissing: 0 };
      for (const page of html) {
        const doc = new DOMParser().parseFromString(page.text, "text/html");
        for (const img of doc.querySelectorAll("img")) {
          const own = [img.getAttribute("class"), img.id, img.getAttribute("alt"), img.getAttribute("src"), img.getAttribute("title")].filter(Boolean).join(" ");
          const ancestors = [];
          let parent = img.parentElement;
          for (let depth = 0; parent && depth < 3; depth++, parent = parent.parentElement) {
            ancestors.push([parent.tagName, parent.id, parent.getAttribute("class")].filter(Boolean).join(" "));
          }
          const semantic = (own + " " + ancestors.join(" ")).toLowerCase();
          const explicitHero = /(?:^|[\s_-])(?:hero|banner|cover|featured|masthead|main-visual|mainvisual|lcp)(?:$|[\s_-])/.test(semantic);
          const explicitBelow = /(?:^|[\s_-])(?:below[-_ ]?fold|thumbnail|gallery|related|recommendations|footer)(?:$|[\s_-])/.test(semantic) ||
            ancestors.some(value => /^FOOTER(?:\s|$)/i.test(value));
          const loading = (img.getAttribute("loading") || "").toLowerCase();
          const priority = (img.getAttribute("fetchpriority") || "").toLowerCase();
          const hasHint = ["lazy", "eager"].includes(loading) || ["high", "low"].includes(priority);
          totals.total++;
          if (explicitHero && !explicitBelow) {
            totals.hero++;
            if (loading === "lazy") totals.heroMissing++;
            else if (loading !== "eager" && priority !== "high") totals.unknownMissing++;
          } else if (explicitBelow) {
            totals.below++;
            if (loading !== "lazy") totals.belowMissing++;
          } else {
            totals.unknown++;
            if (!hasHint) totals.unknownMissing++;
          }
        }
      }
      let status = true;
      if (totals.heroMissing || totals.belowMissing) status = false;
      else if (totals.unknownMissing) status = null;
      const detail = "Public-page images: " + totals.total +
        "; clearly identified hero images: " + totals.hero + " (incorrect lazy loading: " + totals.heroMissing + ")" +
        "; clearly identified below-the-fold images: " + totals.below + " (missing loading=lazy: " + totals.belowMissing + ")" +
        "; position-uncertain images: " + totals.unknown + " (without an explicit loading/priority hint: " + totals.unknownMissing + "). " +
        "Only explicit image/ancestor semantics are classified; source code cannot reliably determine the rendered viewport position of other images.";
      return { status: totals.total === 0 ? true : status, detail };
    })();
    const paths = new Set(allPaths);
    const sitemapPaths = [...paths].filter(path => /(^|\/)sitemap[^/]*\.xml$/i.test(path));
    const robotsPaths = [...paths].filter(path => /(^|\/)robots\.txt$/i.test(path));
    const cssImports = count(/@import\b/gi, joined);
    const insecureAssets = [...joined.matchAll(/(?:src|href)\s*=\s*["']http:\/\/[^"']+/gi)].map(match => match[0]);
    const insecureCanonicalOrSitemap = /<link\b(?=[^>]*\brel\s*=\s*["'][^"']*canonical)[^>]*\bhref\s*=\s*["']http:\/\//i.test(publicJoined) || /<loc>\s*http:\/\//i.test(joined);

    const parsedPages = html.map(file => ({ file, doc: new DOMParser().parseFromString(file.text, "text/html") }));
    const pageMeta = parsedPages.map(x => ({path:x.file.path,title:x.doc.querySelector("title")?.textContent.trim()||"",description:x.doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim()||""}));
    const duplicateValues = key => {const grouped=new Map();pageMeta.filter(x=>x[key]).forEach(x=>{const v=x[key].toLocaleLowerCase();grouped.set(v,[...(grouped.get(v)||[]),x.path]);});return [...grouped.values()].filter(g=>g.length>1);};
    const titleDup=duplicateValues("title"),descDup=duplicateValues("description");
    const titleLong=pageMeta.filter(x=>x.title&&(x.title.length<15||x.title.length>70));
    const descLong=pageMeta.filter(x=>x.description&&(x.description.length<50||x.description.length>160));
    const multiH1=parsedPages.filter(x=>x.doc.querySelectorAll("h1").length>1);
    const links=parsedPages.flatMap(x=>[...x.doc.querySelectorAll("a")].map(a=>({page:x.file.path,href:a.getAttribute("href")||"",label:(a.textContent||"").trim()||a.getAttribute("aria-label")||""})));
    const unlabeledLinks=links.filter(x=>!x.label);
    const localLinks=links.filter(x=>x.href&&!/^(#|mailto:|tel:|javascript:|data:|https?:|\/\/)/i.test(x.href));
    const missingLinks=localLinks.filter(x=>{try{const u=new URL(x.href,"https://seo-audit.invalid/"+x.page);if(u.origin!=="https://seo-audit.invalid")return false;let p=decodeURIComponent(u.pathname.replace(/^\//,""));if(!p)p="index.html";if(!p.includes("."))p=p.replace(/\/$/,"")+"/index.html";return (p.endsWith(".html")||p.endsWith(".htm"))&&!paths.has(p);}catch(_){return false;}});
    const canonicalInfo=parsedPages.map(x=>({path:x.file.path,links:[...x.doc.querySelectorAll('link[rel~="canonical"]')]}));
    const badCanonical=canonicalInfo.filter(x=>x.links.length===1&&(()=>{try{const u=new URL(x.links[0].getAttribute("href")||"");return u.protocol!=="https:"||!u.host;}catch(_){return true;}})());
    // Check URL-addressable pages and browser assets only; repository documentation/configuration is not a public URL.
    const publicUrlPaths = [...new Set([
      ...html.map(file => file.path),
      ...allPaths.filter(path =>
        /\.(?:css|mjs?|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm|json|xml|txt|webmanifest)$/i.test(path) &&
        !/(^|\/)(?:README|LICENSE|CHANGELOG)(?:\.|$)/i.test(path) &&
        !/(^|\/)(?:bots|docs|\.github)\//i.test(path)
      )
    ])];
    const urlBad = publicUrlPaths.filter(path => /[A-Z ]/.test(path) || path.includes("?") || path.includes("#"));
    const sitemapFiles=files.filter(f=>/sitemap[^/]*\.xml$/i.test(f.path));
    const sitemapBad=sitemapFiles.filter(f=>{const d=new DOMParser().parseFromString(f.text,"application/xml");return !!d.querySelector("parsererror")||!["urlset","sitemapindex"].includes(d.documentElement?.localName);});
    const robotsFiles=files.filter(f=>f.path.endsWith("robots.txt"));
    const robotsMap=robotsFiles.filter(f=>f.text.split(/\r?\n/).some(line=>/^\s*sitemap\s*:/i.test(line)));
    const hreflangTags=parsedPages.flatMap(x=>[...x.doc.querySelectorAll('link[rel~="alternate"][hreflang]')].map(tag=>({page:x.file.path,tag})));
    const hreflangBad=hreflangTags.filter(x=>{const l=x.tag.getAttribute("hreflang")||"",h=x.tag.getAttribute("href")||"";return !/^(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})*|x-default)$/i.test(l)||!h.startsWith("https://");});
    const jsonLd=parsedPages.flatMap(x=>[...x.doc.querySelectorAll('script[type="application/ld+json"]')].map(n=>({page:x.file.path,text:n.textContent})));
    const invalidJsonLd=jsonLd.filter(x=>{try{JSON.parse(x.text);return false;}catch(_){return true;}});
    const noImageDimensions=imageTags.filter(tag=>{const d=new DOMParser().parseFromString(tag,"text/html"),img=d.querySelector("img");return !img?.hasAttribute("width")||!img?.hasAttribute("height");});
    const modernImages=parsedPages.flatMap(x=>[...x.doc.querySelectorAll("img,source")]).filter(n=>/\.(webp|avif)(?:[?#,\s]|$)/i.test((n.getAttribute("src")||"")+" "+(n.getAttribute("srcset")||"")));
    const blockingScripts=parsedPages.filter(x=>[...x.doc.head.querySelectorAll("script[src]")].some(n=>!n.hasAttribute("defer")&&!n.hasAttribute("async")&&n.getAttribute("type")!=="module"));
    const missingLandmarks=parsedPages.filter(x=>!x.doc.querySelector("main")||!x.doc.querySelector("nav"));
    const incompleteOg=parsedPages.filter(x=>!x.doc.querySelector('meta[property="og:description"]')||!x.doc.querySelector('meta[property="og:type"]')||!x.doc.querySelector('meta[property="og:url"]'));
    const extra={
      "title-length":[!hasHtml?null:titleLong.length===0,titleLong.length?"Titles outside advisory 15–70 characters: "+titleLong.map(x=>x.path+" ("+x.title.length+")").join(", "):"Available titles fall within advisory 15–70 character range."],
      "title-unique":[!hasHtml?null:titleDup.length===0,titleDup.length?"Duplicate titles: "+titleDup.map(x=>x.join(", ")).join("; "):"No duplicate static titles detected."],
      "description-length":[!hasHtml?null:pageMeta.every(x=>!x.description)?null:descLong.length===0,descLong.length?"Descriptions outside advisory 50–160 characters: "+descLong.map(x=>x.path+" ("+x.description.length+")").join(", "):"Available descriptions fall within advisory range."],
      "description-unique":[!hasHtml?null:descDup.length===0,descDup.length?"Duplicate descriptions: "+descDup.map(x=>x.join(", ")).join("; "):"No duplicate static descriptions detected."],
      "single-h1":[!hasHtml?null:multiH1.length===0,multiH1.length?"Multiple H1 elements: "+multiH1.map(x=>x.file.path).join(", "):"No multiple static H1 elements; one H1 is a structural recommendation, not a strict ranking rule."],
      "descriptive-links":[!hasHtml?null:unlabeledLinks.length===0,unlabeledLinks.length+" links without visible text or aria-label."],
      "internal-links":[!hasHtml?null:localLinks.length>0,localLinks.length+" local navigation links detected."],
      "broken-internal-links":[!hasHtml?null:missingLinks.length===0,missingLinks.length?"Potential missing local HTML targets: "+missingLinks.slice(0,10).map(x=>x.page+" → "+x.href).join("; "):"No missing local HTML targets detected by repository-path matching; runtime routes are not tested."],
      "clean-urls":[urlBad.length===0,urlBad.length?"Unclean public URL paths: "+urlBad.slice(0,10).join(", "):"Public page and browser-asset paths use lowercase URL-friendly names; repository docs/config files are excluded."],
      "sitemap-structure":[!sitemapFiles.length?null:sitemapBad.length===0,sitemapFiles.length?(sitemapBad.length?"Basic XML structure issue: "+sitemapBad.map(x=>x.path).join(", "):"Sitemap XML is well-formed with a recognized root element."):"No sitemap available."],
      "robots-sitemap":[!robotsFiles.length?null:robotsMap.length>0,robotsFiles.length?(robotsMap.length?"Sitemap directive found.":"No Sitemap directive; recommended, not mandatory."):"No robots.txt available."],
      "canonical-single":[!hasHtml?null:canonicalInfo.every(x=>x.links.length===1),canonicalInfo.filter(x=>x.links.length!==1).length?"Pages without exactly one canonical: "+canonicalInfo.filter(x=>x.links.length!==1).map(x=>x.path).join(", "):"Exactly one canonical link per audited page."],
      "canonical-absolute":[!hasHtml?null:badCanonical.length===0,badCanonical.length?"Canonical not absolute HTTPS: "+badCanonical.map(x=>x.path).join(", "):"Detected canonical URLs are absolute HTTPS URLs."],
      "hreflang":[!hasHtml?null:!hreflangTags.length?null:hreflangBad.length===0,hreflangTags.length?(hreflangBad.length?"Invalid hreflang syntax/target in "+hreflangBad.length+" tag(s).":"Hreflang syntax looks valid; reciprocal mapping is not checked."):"Not required unless multilingual/regional variants exist."],
      "jsonld-valid":[!hasHtml?null:!jsonLd.length?null:invalidJsonLd.length===0,jsonLd.length?(invalidJsonLd.length?"Invalid JSON-LD syntax in "+invalidJsonLd.length+" block(s).":"All JSON-LD blocks parse as JSON; schema meaning is not validated."):"No JSON-LD blocks; structured-data presence is checked separately."],
      "image-dimensions":[!hasHtml?null:imageTags.length===0?true:noImageDimensions.length===0,noImageDimensions.length+" of "+imageTags.length+" images lack explicit width and/or height."],
      "modern-images":[!hasHtml?null:imageTags.length===0?true:modernImages.length?true:null,modernImages.length+" WebP/AVIF references found; absence is UNKNOWN, not a failure."],
      "render-blocking-scripts":[!hasHtml?null:blockingScripts.length===0,blockingScripts.length?"Potential blocking head scripts: "+blockingScripts.map(x=>x.file.path).join(", "):"No classic blocking external scripts detected in document heads."],
      "semantic-landmarks":[!hasHtml?null:missingLandmarks.length===0,missingLandmarks.length?"Missing main/nav landmarks: "+missingLandmarks.map(x=>x.file.path).join(", "):"All pages contain main and nav landmarks; primarily an accessibility signal."],
      "og-completeness":[!hasHtml?null:incompleteOg.length===0,incompleteOg.length?"Missing OG description/type/url: "+incompleteOg.map(x=>x.file.path).join(", "):"OG description, type and URL are present."]
    };
    const results = {
      ...extra,
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
      "image-loading": [!hasHtml ? null : imageLoading.status, imageLoading.detail],
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
  async function runAudit(){errorBox.hidden=true;helper.textContent="Loading SEO checklist and scanning the selected GitHub project…";setBusy(true);try{if(!rules){const response=await fetch(RULES_URL+"?v="+Date.now(),{cache:"no-store"});if(!response.ok)throw new Error("Could not load seo-checklist.json.");rules=await response.json();}const projectId=$("project-select").value;const project=rules.projects[projectId];if(!project)throw new Error("Unknown project configuration.");const data=await loadProjectFiles(project);const checks=evaluate(data.contents,data.allPaths);const summary=summarize(checks);const report={projectId,projectName:project.name,repository:project.repository+" ("+data.branch+" · "+data.commit.slice(0,7)+")",website:project.website,manifestGeneratedAt:data.generatedAt,manifestUrl:data.manifestUrl,filesFailed:data.failedFiles,auditedAt:new Date().toISOString(),filesScanned:data.contents.length,filesAvailable:data.totalFiles,publicPagesAudited:checks.find(x=>x.id==="html")?.detail||"",summary,score:summary.score,checks,note:(data.totalFiles>data.selectedFiles?"Selected "+data.selectedFiles+" of "+data.totalFiles+" supported source files because the configured safety limit was reached. ":"")+(data.failedFiles?"Downloaded "+data.contents.length+" of "+data.selectedFiles+" selected source files; "+data.failedFiles+" could not be downloaded. ":"All "+data.contents.length+" selected supported source files were downloaded. ")+"Only complete public HTML documents are used for page-level checks; nested admin tools, redirect aliases and HTML fragments are excluded. Dynamic headings may be marked UNKNOWN for live verification. Every check is recalculated on each run. This source-code audit does not inspect live rendered pages, Google indexing, Core Web Vitals or backlinks. Off-Page SEO remains disabled. Some checks still require manual verification."};renderReport(report);helper.textContent="Check completed. "+data.contents.length+" source files were inspected."+(data.failedFiles?" "+data.failedFiles+" files could not be downloaded.":"");}catch(error){showError(error.message||"The SEO scan could not be completed.");helper.textContent="The latest scan failed. No new report was saved.";}finally{setBusy(false);}}
  button.addEventListener("click",runAudit);$("rerun-button").addEventListener("click",runAudit);$("project-select").addEventListener("change",()=>{emptyState.hidden=false;reportContent.hidden=true;errorBox.hidden=true;});
  try{const projectId=$("project-select").value;const saved=JSON.parse(localStorage.getItem("do2earn-seo-bot:last-report:"+projectId)||"null");if(saved&&Array.isArray(saved.checks))renderReport(saved);}catch(_){}
})();