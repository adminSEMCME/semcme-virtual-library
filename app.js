const state = {
  user: null,
  library: null,
  search: "",
  selectedSections: new Set(),
};

const elements = {
  loginView: document.querySelector("#loginView"),
  portalView: document.querySelector("#portalView"),
  loginForm: document.querySelector("#loginForm"),
  email: document.querySelector("#email"),
  loginError: document.querySelector("#loginError"),
  loginSuccess: document.querySelector("#loginSuccess"),
  previewButton: document.querySelector("#previewButton"),
  registerLink: document.querySelector("#registerLink"),
  signOutButton: document.querySelector("#signOutButton"),
  publicLinks: document.querySelectorAll(".public-nav-link"),
  welcomeText: document.querySelector("#welcomeText"),
  resourceCount: document.querySelector("#resourceCount"),
  searchInput: document.querySelector("#searchInput"),
  sectionFilterButton: document.querySelector("#sectionFilterButton"),
  sectionFilterMenu: document.querySelector("#sectionFilterMenu"),
  clearFiltersButton: document.querySelector("#clearFiltersButton"),
  sectionList: document.querySelector("#sectionList"),
  emptyState: document.querySelector("#emptyState"),
  sourceNote: document.querySelector("#sourceNote"),
  loadingState: document.querySelector("#loadingState"),
};

function setAuthView(isAuthenticated) {
  elements.loginView.hidden = isAuthenticated;
  elements.portalView.hidden = !isAuthenticated;
  elements.signOutButton.hidden = !isAuthenticated;
  elements.publicLinks.forEach((link) => {
    link.hidden = isAuthenticated;
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed.");
    error.data = data;
    throw error;
  }
  return data;
}

function cleanUrlToken() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("token")) return;
  url.searchParams.delete("token");
  window.history.replaceState(
    {},
    document.title,
    `${url.pathname}${url.search}${url.hash}`,
  );
}

function sectionNames() {
  return (state.library?.sections || []).map((section) => section.name);
}

function renderSectionFilter() {
  elements.sectionFilterMenu.innerHTML = "";

  const allLabel = document.createElement("label");
  allLabel.className = "section-option";
  allLabel.innerHTML = `<input type="checkbox" value="__all__" ${state.selectedSections.size === 0 ? "checked" : ""}> All sections`;
  elements.sectionFilterMenu.append(allLabel);

  sectionNames().forEach((name) => {
    const label = document.createElement("label");
    label.className = "section-option";
    const checked = state.selectedSections.has(name) ? "checked" : "";
    label.innerHTML = `<input type="checkbox" value="${escapeAttribute(name)}" ${checked}> ${escapeHtml(name)}`;
    elements.sectionFilterMenu.append(label);
  });

  updateFilterButtonLabel();
}

function updateFilterButtonLabel() {
  const count = state.selectedSections.size;
  elements.sectionFilterButton.textContent = count
    ? `Filter by section (${count})`
    : "Filter by section (All)";
}

function setLoading(isLoading) {
  elements.loadingState.hidden = !isLoading;
  elements.sectionList.hidden = isLoading;
}

function matchesSearch(item, sectionName) {
  const value = state.search.trim().toLowerCase();
  if (!value) return true;
  return [sectionName, item.title, item.speaker, item.date]
    .join(" ")
    .toLowerCase()
    .includes(value);
}

function filteredSections() {
  return (state.library?.sections || [])
    .filter(
      (section) =>
        state.selectedSections.size === 0 ||
        state.selectedSections.has(section.name),
    )
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => matchesSearch(item, section.name)),
    }))
    .filter((section) => section.items.length);
}

function renderLibrary() {
  const sections = filteredSections();
  elements.sectionList.innerHTML = "";
  elements.emptyState.hidden = true;

  sections.forEach((section) => {
    const article = document.createElement("article");
    article.className = `library-section${section.items.length === 1 ? " single-resource-section" : ""}`;
    article.id = section.id;
    article.innerHTML = `
      <div class="section-heading">
        <h3>${escapeHtml(section.name)}</h3>
        <p>${section.items.length} resource${section.items.length === 1 ? "" : "s"}</p>
      </div>
      <div class="resource-grid"></div>
    `;

    const grid = article.querySelector(".resource-grid");
    section.items.forEach((item) => {
      grid.append(renderResourceCard(item));
    });

    elements.sectionList.append(article);
  });

  const total = sections.reduce(
    (sum, section) => sum + section.items.length,
    0,
  );
  elements.emptyState.hidden = total > 0;
  if (total === 0) {
    elements.emptyState.hidden = false;
  }
}

function renderResourceCard(item) {
  const card = document.createElement("article");
  card.className = "resource-card";

  const media = document.createElement("div");
  media.className = "resource-media";
  if (item.embedUrl && /\.(mp4|webm|mov)(\?|$)/i.test(item.embedUrl)) {
    media.innerHTML = `<video controls preload="metadata" src="${escapeAttribute(item.embedUrl)}"></video>`;
  } else if (item.embedUrl) {
    media.innerHTML = `
      <iframe
        src="${escapeAttribute(item.embedUrl)}"
        title="${escapeAttribute(item.title)}"
        loading="lazy"
        referrerpolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen>
      </iframe>
    `;
  } else {
    media.innerHTML = `<div class="resource-placeholder" aria-hidden="true">VL</div>`;
  }

  const body = document.createElement("div");
  body.className = "resource-body";
  body.innerHTML = `
    <h4><a href="${escapeAttribute(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a></h4>
    <div class="resource-meta">
      ${item.speaker ? `<span>${escapeHtml(item.speaker)}</span>` : ""}
      ${item.date ? `<span>${escapeHtml(item.date)}</span>` : ""}
    </div>
  `;

  card.append(media, body);
  return card;
}

function updateLibrarySummary() {
  const total = state.library?.totalItems || 0;
  elements.resourceCount.textContent = String(total);

  const searchActive = state.search.trim() || state.selectedSections.size;
  elements.sourceNote.textContent = state.library?.warning || "";
  elements.sourceNote.hidden = !state.library?.warning && !searchActive;
  if (searchActive && !state.library?.warning) {
    elements.sourceNote.textContent = "Filters are active.";
  }
  elements.sourceNote.classList.toggle(
    "warning",
    Boolean(state.library?.warning),
  );
}

async function loadLibrary({ preview = false } = {}) {
  setLoading(true);
  try {
    state.library = await requestJson(
      preview ? "/api/library-preview" : "/api/library",
    );
    renderSectionFilter();
    updateLibrarySummary();
    renderLibrary();
  } finally {
    setLoading(false);
  }
}

async function showPortal(user, options = {}) {
  state.user = user;
  elements.welcomeText.textContent = `Welcome back, ${user.name || user.email}.`;
  setAuthView(true);
  await loadLibrary(options);
}

async function bootstrap() {
  const settings = await requestJson("/api/public-settings").catch(() => ({}));
  if (settings.registrationUrl)
    elements.registerLink.href = settings.registrationUrl;

  const token = new URLSearchParams(window.location.search).get("token");
  if (token) {
    try {
      const user = await requestJson(
        `/api/verify-magic-link?token=${encodeURIComponent(token)}`,
      );
      cleanUrlToken();
      await showPortal(user);
      return;
    } catch (error) {
      cleanUrlToken();
      elements.loginError.textContent = error.message;
    }
  }

  try {
    const user = await requestJson("/api/me");
    await showPortal(user);
  } catch {
    setAuthView(false);
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginError.textContent = "";
  elements.loginSuccess.textContent = "";
  const button = elements.loginForm.querySelector("button");
  button.disabled = true;

  try {
    const data = await requestJson("/api/request-magic-link", {
      method: "POST",
      body: JSON.stringify({ email: elements.email.value }),
    });
    elements.loginSuccess.textContent = data.message;
  } catch (error) {
    elements.loginError.textContent = error.message;
    if (error.data?.registrationUrl)
      elements.registerLink.href = error.data.registrationUrl;
  } finally {
    button.disabled = false;
  }
});

elements.previewButton.addEventListener("click", async () => {
  elements.loginError.textContent = "";
  elements.loginSuccess.textContent = "Loading preview library...";
  elements.previewButton.disabled = true;

  try {
    await showPortal(
      { name: "Preview User", email: "preview@semcme.org" },
      { preview: true },
    );
    elements.loginSuccess.textContent = "";
  } catch (error) {
    elements.loginError.textContent = error.message;
    elements.loginSuccess.textContent = "";
  } finally {
    elements.previewButton.disabled = false;
  }
});

elements.signOutButton.addEventListener("click", async () => {
  await requestJson("/api/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  state.library = null;
  setAuthView(false);
});

elements.searchInput.addEventListener("input", () => {
  state.search = elements.searchInput.value;
  renderLibrary();
  updateLibrarySummary();
});

elements.sectionFilterButton.addEventListener("click", () => {
  const isOpen = !elements.sectionFilterMenu.hidden;
  elements.sectionFilterMenu.hidden = isOpen;
  elements.sectionFilterButton.setAttribute("aria-expanded", String(!isOpen));
});

elements.sectionFilterMenu.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;

  if (input.value === "__all__") {
    state.selectedSections.clear();
  } else if (input.checked) {
    state.selectedSections.add(input.value);
  } else {
    state.selectedSections.delete(input.value);
  }

  renderSectionFilter();
  renderLibrary();
  updateLibrarySummary();
});

elements.clearFiltersButton.addEventListener("click", () => {
  state.search = "";
  state.selectedSections.clear();
  elements.searchInput.value = "";
  renderSectionFilter();
  renderLibrary();
  updateLibrarySummary();
});

document.addEventListener("click", (event) => {
  if (elements.sectionFilterMenu.hidden) return;
  if (
    elements.sectionFilterMenu.contains(event.target) ||
    elements.sectionFilterButton.contains(event.target)
  )
    return;
  elements.sectionFilterMenu.hidden = true;
  elements.sectionFilterButton.setAttribute("aria-expanded", "false");
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

bootstrap();
