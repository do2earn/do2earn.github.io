(() => {
  "use strict";

  const checklists = {
    "steem-flags": {
      name: "Steem Flags",
      "on-page": [
        ["Page titles","Give every important page a unique, descriptive title that includes its main search topic."],
        ["Meta descriptions","Write a compelling, unique meta description for each indexable page."],
        ["Heading structure","Use one clear H1 and organize supporting content with logical H2 and H3 headings."],
        ["Search intent and keywords","Use relevant flag game, geography quiz, and Steem-related phrases naturally."],
        ["Useful page content","Explain how the game works, how users participate, and what makes it useful."],
        ["Readable URLs","Use short, descriptive, lowercase URLs and avoid unnecessary parameters."],
        ["Image optimization","Compress images, use descriptive filenames, and add meaningful ALT text."],
        ["Internal linking","Link relevant pages such as the game, FAQ, About, and help content."],
        ["Mobile usability","Verify that navigation, game controls, text, and buttons work on mobile screens."],
        ["Page performance","Check Core Web Vitals, image sizes, JavaScript loading, and layout stability."],
        ["Indexability and canonical URLs","Ensure important pages are crawlable, return the correct status, and use valid canonical URLs."],
        ["Sitemap and robots.txt","Publish an accurate XML sitemap and ensure robots.txt does not block important pages."],
        ["Structured data","Add only valid, relevant schema markup where it accurately describes the page."],
        ["Social metadata","Set suitable Open Graph and social preview titles, descriptions, and images."]
      ],
      "off-page": [
        ["Relevant backlinks","Earn editorial links from websites that genuinely cover blockchain, gaming, or educational quizzes."],
        ["Steem ecosystem mentions","Seek relevant mentions and references from credible Steem ecosystem resources."],
        ["Community participation","Share useful updates in relevant communities without repetitive or spammy promotion."],
        ["Developer and partner links","Ask genuine project partners or collaborators to reference the game where appropriate."],
        ["Social media presence","Maintain accurate project profiles and share useful, original updates."],
        ["Content outreach","Offer useful articles, tutorials, or resources to relevant publishers."],
        ["Gaming directories","Submit accurate project information to reputable and relevant game directories."],
        ["Brand consistency","Use the same project name, logo, description, and canonical website across profiles."],
        ["Natural anchor text","Check that backlinks use varied, relevant wording rather than repetitive exact-match keywords."],
        ["Referral traffic","Review referral sources and identify communities that send engaged visitors."],
        ["Backlink quality review","Monitor new and lost links and investigate suspicious patterns before taking action."],
        ["Reputation and mentions","Track brand mentions and respond constructively to relevant questions and feedback."]
      ]
    },
    "steem-games": {
      name: "Steem Games",
      "on-page": [
        ["Homepage title","Use a unique title that clearly communicates the Steem blockchain gaming directory."],
        ["Homepage meta description","Describe the directory accurately and encourage relevant search visitors to explore."],
        ["Heading hierarchy","Use a clear H1 and logical headings on the homepage and supporting pages."],
        ["Game profile titles","Give every game information page a unique title based on its actual game name."],
        ["Game profile descriptions","Write original, useful descriptions covering gameplay, developer, genres, and relevant details."],
        ["Dedicated game tags","Use clear, crawlable links to each game's dedicated Steem tag or search page."],
        ["Keyword relevance","Use natural terms related to Steem games, blockchain gaming, and each game's genre."],
        ["Internal navigation","Connect game profiles with the homepage, FAQ, About page, and related games."],
        ["Logo and image ALT text","Add descriptive ALT text and meaningful filenames to game logos and other informative images."],
        ["Mobile experience","Test navigation, game tables, profile pages, and controls on narrow screens."],
        ["Page speed and Core Web Vitals","Optimize assets and scripts; test real page performance on mobile and desktop."],
        ["Indexability and canonical URLs","Make intended public pages crawlable and provide correct canonical URLs."],
        ["XML sitemap and robots.txt","Include canonical public pages in the sitemap and avoid blocking important resources."],
        ["Structured data","Use accurate WebSite, Organization, or VideoGame schema only when the visible page supports it."],
        ["Social sharing metadata","Provide suitable Open Graph titles, descriptions, and preview images for key pages."]
      ],
      "off-page": [
        ["Developer backlinks","Invite listed game developers to link to their Steem Games profile when useful."],
        ["Game website references","Seek relevant links from the official websites of listed games."],
        ["Steem community coverage","Share useful directory updates and discoveries in relevant Steem communities."],
        ["Blockchain gaming publications","Build relationships with credible Web3 and blockchain gaming publishers."],
        ["Gaming directory listings","Submit Steem Games to reputable directories that accept relevant blockchain games."],
        ["Social media distribution","Share new game listings, developer updates, and useful directory content."],
        ["Developer announcements","Coordinate accurate references when developers announce or update their game listings."],
        ["Editorial mentions","Earn independent mentions through useful research, guides, and original directory data."],
        ["Partnerships","Build relevant relationships with gaming communities, projects, and ecosystem resources."],
        ["Natural backlink anchors","Review anchor text diversity and avoid manipulative exact-match link campaigns."],
        ["Referral traffic analysis","Measure visits from developer websites, communities, and external publications."],
        ["Backlink quality monitoring","Review new and lost backlinks and investigate spam or suspicious link patterns."],
        ["Brand consistency","Keep the project name, logo, URL, and description consistent across external profiles."],
        ["Community engagement","Answer questions and contribute useful information instead of posting promotional spam."]
      ]
    }
  };

  const projectSelect = document.getElementById("project-select");
  const typeSelect = document.getElementById("type-select");
  const checkButton = document.getElementById("check-button");
  const emptyState = document.getElementById("empty-state");
  const checklistContent = document.getElementById("checklist-content");
  const checklistElement = document.getElementById("checklist");
  const progressPercent = document.getElementById("progress-percent");
  const progressCount = document.getElementById("progress-count");
  const remainingCount = document.getElementById("remaining-count");
  const progressFill = document.getElementById("progress-fill");
  const progressBar = document.getElementById("progress-bar");
  const completeMessage = document.getElementById("complete-message");
  const saveStatus = document.getElementById("save-status");
  const resetButton = document.getElementById("reset-button");

  let activeKey = "";
  let activeItems = [];

  const storageKey = (project, type) => `do2earn-seo-bot:v1:${project}:${type}`;

  function readSaved(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
    } catch (_) {
      return [];
    }
  }

  function saveChecked() {
    const completed = Array.from(checklistElement.querySelectorAll('input[type="checkbox"]:checked'))
      .map(input => input.value);
    try {
      localStorage.setItem(activeKey, JSON.stringify(completed));
      saveStatus.innerHTML = '<span class="status-dot"></span> Saved on this device';
    } catch (_) {
      saveStatus.textContent = "Could not save on this device";
    }
  }

  function updateProgress() {
    const checks = Array.from(checklistElement.querySelectorAll('input[type="checkbox"]'));
    const done = checks.filter(input => input.checked).length;
    const total = checks.length;
    const percent = total ? Math.round(done / total * 100) : 0;
    progressPercent.textContent = percent + "%";
    progressCount.textContent = `${done} of ${total} completed`;
    remainingCount.textContent = `${total - done} remaining`;
    progressFill.style.width = percent + "%";
    progressBar.setAttribute("aria-valuenow", String(percent));
    completeMessage.textContent = percent === 100
      ? "All checklist items completed!"
      : percent >= 50 ? "Great progress — keep it up." : "Keep going — every step counts.";
  }

  function renderChecklist() {
    const projectId = projectSelect.value;
    const typeId = typeSelect.value;
    const project = checklists[projectId];
    activeItems = project[typeId];
    activeKey = storageKey(projectId, typeId);
    const saved = new Set(readSaved(activeKey));

    document.getElementById("list-project").textContent = project.name;
    document.getElementById("list-type").textContent = typeId === "on-page" ? "On-Page SEO" : "Off-Page SEO";
    checklistElement.replaceChildren();

    activeItems.forEach((item, index) => {
      const row = document.createElement("label");
      row.className = "check-item";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = String(index);
      input.checked = saved.has(String(index));
      input.setAttribute("aria-label", item[0]);
      const copy = document.createElement("span");
      copy.className = "check-copy";
      const title = document.createElement("span");
      title.className = "check-title";
      title.textContent = item[0];
      const detail = document.createElement("span");
      detail.className = "check-detail";
      detail.textContent = item[1];
      copy.append(title, detail);
      row.append(input, copy);
      if (input.checked) row.classList.add("is-checked");
      checklistElement.append(row);
    });

    emptyState.hidden = true;
    checklistContent.hidden = false;
    saveStatus.innerHTML = '<span class="status-dot"></span> Saved on this device';
    updateProgress();
  }

  checklistElement.addEventListener("change", event => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    event.target.closest(".check-item").classList.toggle("is-checked", event.target.checked);
    saveChecked();
    updateProgress();
  });

  checkButton.addEventListener("click", renderChecklist);

  resetButton.addEventListener("click", () => {
    if (!activeKey || !window.confirm("Reset all completed items in this checklist?")) return;
    checklistElement.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.checked = false;
      input.closest(".check-item").classList.remove("is-checked");
    });
    saveChecked();
    updateProgress();
  });
})();