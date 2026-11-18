(() => {
  "use strict";
  const ON_PAGE_RULES_URL = "./on-page-checklist.json";
  const OFF_PAGE_RULES_URL = "./off-page-checklist.json";
  const $ = id => document.getElementById(id);
  const button = $("check-button");
  const helper = $("helper-text");
  const errorBox = $("error-box");
  const emptyState = $("empty-state");
  const reportContent = $("report-content");
  let rules = null;
  let offPageRules = null;
  function setBusy(busy) { button.disabled = busy; button.textContent = busy ? (selectedAuditType() === "off-page" ? "Discovering external SEO…" : "Scanning project files…") : "Check SEO"; $("rerun-button").disabled = busy; }
  function selectedAuditType() { return document.querySelector('input[name="audit-type"]:checked')?.value || "on-page"; }
  function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
  function renderReport(report) {
    emptyState.hidden = true; reportContent.hidden = false;
    $("report-project").textContent = report.projectName; $("report-url").textContent = report.repository;
    $("audit-time").textContent = "Checked " + new Date(report.auditedAt).toLocaleString();
    $("score-value").textContent = report.score === null ? "—" : report.score + "%";
    $("pass-value").textContent = report.summary.pass; $("fail-value").textContent = report.summary.fail; $("unknown-value").textContent = report.summary.unknown; $("na-value").textContent = report.summary.na || 0;
    $("coverage-text").textContent = report.summary.determined + " of " + (report.summary.applicable ?? report.summary.total) + " applicable checks determined"; $("pages-text").textContent = report.filesScanned + " source files scanned";
    $("progress-fill").style.width = (report.score || 0) + "%"; $("progress-bar").setAttribute("aria-valuenow", String(report.score || 0));
    const list = $("checklist"); list.replaceChildren(); let category = "";
    report.checks.forEach(check => {
      if (check.category !== category) { category = check.category; const heading = document.createElement("h4"); heading.className = "check-category"; heading.textContent = category; list.append(heading); }
      const row = document.createElement("article"); row.className = "check-item status-" + check.status.toLowerCase();
      const icon = document.createElement("span"); icon.className = "result-icon"; icon.textContent = check.status === "PASS" ? "✓" : check.status === "FAIL" ? "!" : check.status === "N/A" ? "—" : "?";
      const body = document.createElement("span"); body.className = "check-copy";
      const title = document.createElement("strong"); title.className = "check-title"; title.textContent = check.title;
      const detail = document.createElement("span"); detail.className = "check-detail"; detail.textContent = check.detail; body.append(title, detail);
      if (check.evidence) { const evidence = document.createElement("span"); evidence.className = "check-evidence"; evidence.textContent = check.evidence; body.append(evidence); }
      const badge = document.createElement("span"); badge.className = "result-status"; badge.textContent = check.status; row.append(icon, body, badge); list.append(row);
    });

    const panel=$("offpage-panel"), evidenceList=$("offpage-results");
    if(panel&&evidenceList){
      panel.hidden = report.auditType !== "off-page";
      if(report.auditType !== "off-page") evidenceList.replaceChildren();
      else {
      panel.hidden=false;evidenceList.replaceChildren();
      const evidence=report.offPageEvidence||{candidates:[],errors:[]};
      if(!evidence.candidates.length){
        const empty=document.createElement("p");empty.className="offpage-empty";
        empty.textContent="No external search candidates were returned. This does not mean that no mentions or backlinks exist.";
        evidenceList.append(empty);
      }
      evidence.candidates.forEach(candidate=>{
        const card=document.createElement("article");card.className="offpage-source";
        const copy=document.createElement("div");copy.className="offpage-source-copy";
        const title=document.createElement("strong");title.textContent=candidate.title||candidate.host;
        const link=document.createElement("a");link.href=candidate.url;link.target="_blank";link.rel="noopener noreferrer";link.textContent=candidate.host;
        const desc=document.createElement("p");desc.textContent=candidate.description||candidate.query;
        copy.append(title,link,desc);
        const action=document.createElement("button");action.type="button";action.className="verify-source";
        action.textContent=candidate.verification?(candidate.verification.passed?"Verified":"Retry verification"):"Verify source";
        action.addEventListener("click",async()=>{
          action.disabled=true;action.textContent="Checking…";
          try{const result=await verifyOffPageCandidate(candidate,report);updateOffPageCandidate(candidate,result,report);}
          catch(error){action.disabled=false;action.textContent="Retry verification";const note=document.createElement("p");note.className="offpage-error";note.textContent=error.message||"Could not verify this page.";card.append(note);}
        });
        card.append(copy,action);
        if(candidate.verification){
          const status=document.createElement("p");status.className=candidate.verification.passed?"offpage-verified":"offpage-error";
          status.textContent=candidate.verification.detail||"Verification complete.";card.append(status);
        }
        evidenceList.append(card);
      });
      if(evidence.errors&&evidence.errors.length){
        const note=document.createElement("p");note.className="offpage-error";
        note.textContent="Some searches could not be completed: "+evidence.errors.join(" · ");evidenceList.append(note);
      }
      }
    }
    $("report-note").textContent = report.note;
    try { localStorage.setItem("do2earn-seo-bot:last-report-v3:" + report.projectId, JSON.stringify(report)); } catch (_) {}
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

  async function searchOffPage(project) {
    const domain=new URL(project.website).hostname.replace(/^www\./,"");
    const name=project.name;
    const queries=[
      {id:"backlink-profile",label:"Exact-domain references",q:'"'+domain+'"'},
      {id:"digital-pr",label:"Digital PR and editorial coverage",q:'"'+name+'" (news OR announcement OR press OR launch)'},
      {id:"brand-mentions",label:"Independent brand mentions",q:'"'+name+'" "'+domain+'"'},
      {id:"social-presence",label:"Social profiles and posts",q:'"'+name+'" (site:x.com OR site:facebook.com OR site:youtube.com OR site:discord.com)'},
      {id:"community",label:"Community discussions",q:'"'+name+'" (site:steemit.com OR site:steemitkorea.com OR site:reddit.com OR site:discord.com)'},
      {id:"guest-posting",label:"Guest articles and reviews",q:'"'+name+'" ("guest post" OR contributor OR review OR gameplay)'},
      {id:"directories",label:"Directories and specialist listings",q:'"'+name+'" (directory OR listing OR database OR catalog)'}
    ];
    const candidates=[],errors=[];
    for(const item of queries){
      try{
        const response=await fetch("https://s.jina.ai/"+encodeURIComponent(item.q),{headers:{Accept:"application/json"},cache:"no-store"});
        if(!response.ok) throw new Error("HTTP "+response.status);
        const payload=await response.json();
        let rows=Array.isArray(payload.data)?payload.data:(Array.isArray(payload.results)?payload.results:(Array.isArray(payload.data?.results)?payload.data.results:[]));
        const searchText=payload.content||payload.data?.content||"";
        if(!rows.length&&typeof searchText==="string"){
          const urls=[...new Set(searchText.match(/https?:\/\/[^\s)\]>]+/g)||[])];
          rows=urls.map(url=>({url,title:url}));
        }
        rows.slice(0,4).forEach((row,i)=>{
          const url=row.url||row.link;
          if(!url||!/^https?:\/\//i.test(url)||candidates.some(x=>x.url===url))return;
          let host;try{host=new URL(url).hostname.replace(/^www\./,"");}catch(_){return;}
          if(host===domain||host.endsWith("."+domain))return;
          candidates.push({id:item.id+"-"+i,checkId:item.id,query:item.label,url,title:row.title||host,host,description:row.description||row.snippet||"",verified:false});
        });
      }catch(error){errors.push(item.label+": "+(error.message||"Search unavailable"));}
    }
    return {candidates,errors,queriesRun:queries.length,domain};
  }
  async function verifyOffPageCandidate(candidate,report){
    const response=await fetch("https://r.jina.ai/"+candidate.url,{headers:{Accept:"application/json","X-With-Links-Summary":"true"},cache:"no-store"});
    if(!response.ok)throw new Error("Reader HTTP "+response.status);
    const payload=await response.json(),data=payload.data||payload;
    const content=String(data.content||payload.content||"");
    if(!content)throw new Error("No readable page content returned.");
    const target=String(report.website).replace(/^https?:\/\//,"").split("/")[0].replace(/^www\./,"");
    const markdownLinks=[...content.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi)].map(m=>m[1]);
    const extractedLinks=Array.isArray(data.links)?data.links.map(x=>typeof x==="string"?x:(x.url||x.href||"")):[];
    const links=[...markdownLinks,...extractedLinks];
    const hasLink=links.some(url=>{try{const host=new URL(url).hostname.replace(/^www\./,"");return host===target||host.endsWith("."+target);}catch(_){return false;}});
    const lower=content.toLowerCase(),brand=String(report.projectName).toLowerCase(),hasBrand=lower.includes(brand);
    const host=new URL(candidate.url).hostname.toLowerCase();
    const social=/\b(x\.com|twitter\.com|facebook\.com|instagram\.com|youtube\.com|youtu\.be|discord\.com|t\.me|linkedin\.com)\b/.test(host);
    const community=/\b(steemit\.com|steemitkorea\.com|reddit\.com|discord\.com|bitcointalk\.org)\b/.test(host);
    const editorial=/\b(press release|news|announc|launch|media|interview|coverage)\b/.test(lower);
    const guest=/\b(guest post|contributor|written by|author|review|gameplay)\b/.test(lower);
    const directory=/\b(directory|listing|catalog|database|collection|discover)\b/.test(lower);
    let passed=false,detail="";
    if(candidate.checkId==="backlink-profile"){passed=hasLink;detail=passed?"A live external page contains a link to "+target+".":"No live link to "+target+" was found in the extracted links. A plain-text mention does not count as a backlink.";}
    else if(candidate.checkId==="social-presence"){passed=hasBrand&&social;detail=passed?"The project name was found on a recognized social platform. Engagement and audience size are not measured.":"A matching project mention on a recognized social platform was not confirmed.";}
    else if(candidate.checkId==="community"){passed=hasBrand&&community;detail=passed?"The project name was found on a recognized community platform. Participation quality is not measured.":"A matching project mention on a recognized community platform was not confirmed.";}
    else if(candidate.checkId==="digital-pr"){passed=hasBrand&&editorial;detail=passed?"The project name and editorial/news context were found on this external page. Publication authority is not scored.":"The page did not provide both a project mention and clear editorial/news context.";}
    else if(candidate.checkId==="guest-posting"){passed=hasBrand&&guest;detail=passed?"The project name and article/review context were found on this external page. Editorial independence is not scored.":"The page did not provide both a project mention and guest-article/review context.";}
    else if(candidate.checkId==="directories"){passed=hasBrand&&directory;detail=passed?"The project name and directory/listing context were found on this external page. Listing quality is not scored.":"The page did not provide both a project mention and directory/listing context.";}
    else{passed=hasBrand;detail=passed?"The project name was found in readable external content.":"The project name was not confirmed in the readable page.";}
    return {passed,detail,checkedAt:new Date().toISOString(),host,hasBacklink:hasLink,hasBrand};
  }
  function updateOffPageCandidate(candidate,result,report){
    candidate.verification=result;candidate.verified=true;
    const check=report.checks.find(x=>x.id===candidate.checkId);
    if(check){
      const positives=report.offPageEvidence.candidates.filter(x=>x.checkId===candidate.checkId&&x.verification&&x.verification.passed);
      if(positives.length){check.status="PASS";check.detail=positives.length+" external source(s) verified. "+result.detail;}
      else{check.status="UNKNOWN";check.detail=result.detail+" Search results are not exhaustive.";}
    }
    report.summary=summarize(report.checks);report.score=report.summary.score;renderReport(report);
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
      const totals = { total: 0, hero: 0, below: 0, unknown: 0, heroMissing: 0, belowMissing: 0 };
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
          totals.total++;
          if (explicitHero && !explicitBelow) {
            totals.hero++;
            if (loading === "lazy" || (loading !== "eager" && priority !== "high")) totals.heroMissing++;
          } else if (explicitBelow) {
            totals.below++;
            if (loading !== "lazy" || priority === "high") totals.belowMissing++;
          } else {
            totals.unknown++;
          }
        }
      }
      let status = true;
      if (totals.heroMissing || totals.belowMissing) status = false;
      else if (totals.unknown) status = null;
      const detail = "Public-page images: " + totals.total +
        "; clearly identified hero images: " + totals.hero + " (missing eager/high-priority treatment: " + totals.heroMissing + ")" +
        "; clearly identified below-the-fold images: " + totals.below + " (missing loading=lazy: " + totals.belowMissing + ")" +
        "; position-uncertain images: " + totals.unknown + ". Ambiguous images remain UNKNOWN even when a loading hint exists, because source hints alone cannot prove their rendered viewport position.";
      return { status: totals.total === 0 ? "N/A" : status, detail };
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
    const pageLanguages = new Set(parsedPages.map(x => (x.doc.documentElement.getAttribute("lang") || "").trim().toLowerCase().split("-")[0]).filter(Boolean));
    const localeCodes = new Set(["ar","de","en","es","fa","fr","it","ja","ko","nl","pl","pt","ru","tr","zh"]);
    const localePaths = allPaths.filter(path => path.split("/").some(segment => localeCodes.has(segment.toLowerCase())));
    const multilingualEvidence = hreflangTags.length > 0 || pageLanguages.size > 1 || localePaths.length > 0;
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
      "hreflang":[!hasHtml?null:!multilingualEvidence?"N/A":!hreflangTags.length?false:hreflangBad.length===0,!multilingualEvidence?"Not applicable: no multilingual or regional page variants were detected.":hreflangTags.length?(hreflangBad.length?"Invalid hreflang syntax/target in "+hreflangBad.length+" tag(s).":"Hreflang syntax looks valid; reciprocal mapping is not checked."):"Multiple language or regional variants were detected, but no hreflang annotations were found."],
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
      const status = result[0] === "N/A" ? "N/A" : result[0] === null ? "UNKNOWN" : result[0] ? "PASS" : "FAIL";
      return { ...rule, status, detail: result[1] };
    });
  }
  function summarize(checks){const pass=checks.filter(x=>x.status==="PASS").length;const fail=checks.filter(x=>x.status==="FAIL").length;const unknown=checks.filter(x=>x.status==="UNKNOWN").length;const na=checks.filter(x=>x.status==="N/A").length;const determined=pass+fail;const applicable=checks.length-na;return{pass,fail,unknown,na,determined,applicable,total:checks.length,coverage:applicable?Math.round(determined/applicable*100):null,score:determined?Math.round(pass/determined*100):null};}
  async function runAudit(){
    errorBox.hidden=true;
    const auditType=selectedAuditType();
    helper.textContent=auditType==="off-page"?"Loading off-page checklist and discovering external references…":"Loading on-page checklist and scanning source files…";
    setBusy(true);
    try{
      if(!rules){const response=await fetch(ON_PAGE_RULES_URL+"?v="+Date.now(),{cache:"no-store"});if(!response.ok)throw new Error("Could not load on-page-checklist.json.");rules=await response.json();}
      if(!offPageRules){const response=await fetch(OFF_PAGE_RULES_URL+"?v="+Date.now(),{cache:"no-store"});if(!response.ok)throw new Error("Could not load off-page-checklist.json.");offPageRules=await response.json();}
      const projectId=$("project-select").value,project=rules.projects[projectId];
      if(!project)throw new Error("Unknown project configuration.");
      let checks=[],offPageEvidence={candidates:[],errors:[]},data=null,note="";
      if(auditType==="on-page"){
        data=await loadProjectFiles(project);checks=evaluate(data.contents,data.allPaths);
        note=(data.totalFiles>data.selectedFiles?"Selected "+data.selectedFiles+" of "+data.totalFiles+" supported source files because the configured safety limit was reached. ":"")+(data.failedFiles?"Downloaded "+data.contents.length+" of "+data.selectedFiles+" selected source files; "+data.failedFiles+" could not be downloaded. ":"All "+data.contents.length+" selected supported source files were downloaded. ")+"Only complete public HTML documents are used for page-level checks; nested admin tools, redirect aliases and HTML fragments are excluded. Dynamic headings may be marked UNKNOWN for live verification. Every on-page check is recalculated on each run and is based on public source files.";
      }else{
        offPageEvidence=await searchOffPage(project);
        checks=offPageRules.checks.map(rule=>({...rule,status:"UNKNOWN",detail:rule.evidence+" Public search candidates are discovery leads only; verify individual pages below. Search coverage is not exhaustive."}));
        note="Off-page discovery searches public web results for independent references. Candidate pages must be opened and verified individually; search results are not a complete backlink index. Backlink quality, referring-domain totals, historical link gains/losses and social engagement still require specialist data or human review. Unverified checks remain UNKNOWN.";
      }
      const summary=summarize(checks);
      const report={auditType,projectId,projectName:project.name,repository:project.repository+(data?" ("+data.branch+" · "+data.commit.slice(0,7)+")":""),website:project.website,manifestGeneratedAt:data?.generatedAt||null,manifestUrl:data?.manifestUrl||null,filesFailed:data?.failedFiles||0,auditedAt:new Date().toISOString(),filesScanned:data?.contents.length||0,filesAvailable:data?.totalFiles||0,publicPagesAudited:checks.find(x=>x.id==="html")?.detail||"",summary,score:summary.score,checks,offPageEvidence,note};
      renderReport(report);
      helper.textContent=auditType==="off-page"?"Off-Page SEO discovery completed. Verify the candidate sources below.":"On-Page SEO check completed. "+data.contents.length+" source files were inspected."+(data.failedFiles?" "+data.failedFiles+" files could not be downloaded.":"");
    }catch(error){showError(error.message||"The SEO scan could not be completed.");helper.textContent="The latest scan failed. No new report was saved.";}
    finally{setBusy(false);}
  }
  button.addEventListener("click",runAudit);$("rerun-button").addEventListener("click",runAudit);$("project-select").addEventListener("change",()=>{emptyState.hidden=false;reportContent.hidden=true;errorBox.hidden=true;});document.querySelectorAll('input[name="audit-type"]').forEach(input=>input.addEventListener("change",()=>{emptyState.hidden=false;reportContent.hidden=true;errorBox.hidden=true;helper.textContent=input.value==="off-page"?"Off-Page SEO is selected. Only external discovery and verification checks will run.":"On-Page SEO is selected. Only source-code and technical checks will run.";}));
  try{const projectId=$("project-select").value;const saved=JSON.parse(localStorage.getItem("do2earn-seo-bot:last-report-v3:"+projectId)||"null");if(saved&&Array.isArray(saved.checks))renderReport(saved);}catch(_){}
})();