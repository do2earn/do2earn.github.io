(() => {
  "use strict";

  // Set this to the deployed Cloudflare Worker URL after deploying worker/.
  const API_BASE = "https://do2earn-seo-audit.YOUR-SUBDOMAIN.workers.dev";
  const projects = {
    "steem-flags": { name: "Steem Flags", url: "https://steemflags.do2earn.dev" },
    "steem-games": { name: "Steem Games", url: "https://steemgames.do2earn.dev" }
  };

  const $ = id => document.getElementById(id);
  const button = $("check-button");
  const helper = $("helper-text");
  const errorBox = $("error-box");
  const emptyState = $("empty-state");
  const reportContent = $("report-content");
  let lastProject = "";

  function setBusy(busy) {
    button.disabled = busy;
    button.classList.toggle("is-loading", busy);
    button.textContent = busy ? "Auditing website…" : "Run Automated SEO Audit";
    $("rerun-button").disabled = busy;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function statusLabel(status) {
    return status === "PASS" ? "Verified" : status === "FAIL" ? "Needs attention" : "Not verified";
  }

  function renderReport(report) {
    emptyState.hidden = true;
    reportContent.hidden = false;
    $("report-project").textContent = report.projectName;
    $("report-url").textContent = report.baseUrl;
    $("audit-time").textContent = "Audited " + new Date(report.auditedAt).toLocaleString();
    $("score-value").textContent = report.score === null ? "—" : report.score + "%";
    $("pass-value").textContent = report.summary.pass;
    $("fail-value").textContent = report.summary.fail;
    $("unknown-value").textContent = report.summary.unknown;
    $("coverage-text").textContent = report.summary.determined + " of " + report.summary.total + " checks determined";
    $("pages-text").textContent = report.pagesCrawled + " pages inspected";
    $("progress-fill").style.width = (report.score || 0) + "%";
    $("progress-bar").setAttribute("aria-valuenow", String(report.score || 0));

    const list = $("checklist");
    list.replaceChildren();
    report.checks.forEach(check => {
      const row = document.createElement("article");
      row.className = "check-item status-" + check.status.toLowerCase();
      const icon = document.createElement("span");
      icon.className = "result-icon";
      icon.textContent = check.status === "PASS" ? "✓" : check.status === "FAIL" ? "!" : "?";
      const body = document.createElement("span");
      body.className = "check-copy";
      const title = document.createElement("strong");
      title.className = "check-title";
      title.textContent = check.title;
      const detail = document.createElement("span");
      detail.className = "check-detail";
      detail.textContent = check.detail;
      body.append(title, detail);
      if (check.evidence) {
        const evidence = document.createElement("span");
        evidence.className = "check-evidence";
        evidence.textContent = check.evidence;
        body.append(evidence);
      }
      const badge = document.createElement("span");
      badge.className = "result-status";
      badge.textContent = check.status;
      row.append(icon, body, badge);
      list.append(row);
    });
    $("report-note").textContent = report.note || "Results are based on the pages the crawler could access during this audit. UNKNOWN means the check could not be reliably verified; it is not treated as a pass or failure.";
    try {
      localStorage.setItem("do2earn-seo-bot:last-report:" + report.projectId, JSON.stringify(report));
    } catch (_) {}
  }

  async function runAudit() {
    const projectId = $("project-select").value;
    const project = projects[projectId];
    errorBox.hidden = true;
    helper.textContent = "Connecting to the audit engine and crawling public pages…";
    setBusy(true);
    try {
      if (API_BASE.includes("YOUR-SUBDOMAIN")) {
        throw new Error("The SEO audit engine has not been deployed yet. Deploy the Cloudflare Worker from the worker folder, then replace API_BASE in script.js with its workers.dev URL.");
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      let response;
      try {
        response = await fetch(API_BASE.replace(/\/$/, "") + "/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Audit request failed (" + response.status + ").");
      if (!data || !Array.isArray(data.checks)) throw new Error("The audit engine returned an invalid report.");
      lastProject = projectId;
      renderReport(data);
      helper.textContent = "Audit completed. Results are based on live website checks.";
    } catch (error) {
      showError(error.name === "AbortError" ? "The audit took too long. Please try again." : error.message || "Could not complete the audit.");
      helper.textContent = "No new results were saved. Previous report, if any, remains unchanged.";
    } finally {
      setBusy(false);
    }
  }

  button.addEventListener("click", runAudit);
  $("rerun-button").addEventListener("click", runAudit);

  try {
    const projectId = $("project-select").value;
    const saved = JSON.parse(localStorage.getItem("do2earn-seo-bot:last-report:" + projectId) || "null");
    if (saved && Array.isArray(saved.checks)) renderReport(saved);
  } catch (_) {}
})();