const state = {
  sections: [],
  selectedSectionId: "",
  selectedItemId: "",
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  loginView: $("#loginView"),
  dashboard: $("#dashboard"),
  loginForm: $("#loginForm"),
  username: $("#username"),
  password: $("#password"),
  loginMessage: $("#loginMessage"),
  dashboardMessage: $("#dashboardMessage"),
  refreshButton: $("#refreshButton"),
  importButton: $("#importButton"),
  signOutButton: $("#signOutButton"),
  postedList: $("#postedList"),
  sectionForm: $("#sectionForm"),
  sectionSelect: $("#sectionSelect"),
  sectionName: $("#sectionName"),
  sectionSlug: $("#sectionSlug"),
  sectionOrder: $("#sectionOrder"),
  sectionDescription: $("#sectionDescription"),
  sectionVisible: $("#sectionVisible"),
  newSectionButton: $("#newSectionButton"),
  deleteSectionButton: $("#deleteSectionButton"),
  itemForm: $("#itemForm"),
  itemSelect: $("#itemSelect"),
  itemTitle: $("#itemTitle"),
  itemUrl: $("#itemUrl"),
  itemSpeaker: $("#itemSpeaker"),
  itemDate: $("#itemDate"),
  itemType: $("#itemType"),
  itemOrder: $("#itemOrder"),
  itemVisible: $("#itemVisible"),
  newItemButton: $("#newItemButton"),
  deleteItemButton: $("#deleteItemButton"),
};

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
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function message(value, type = "") {
  elements.dashboardMessage.textContent = value || "";
  elements.dashboardMessage.className = `message ${type}`;
}

function loginMessage(value) {
  elements.loginMessage.textContent = value || "";
}

function setBusy(button, busy, text) {
  button.disabled = busy;
  if (text) {
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
    button.textContent = busy ? text : button.dataset.originalText;
  }
}

function activeSection() {
  return state.sections.find((section) => String(section.id) === String(state.selectedSectionId)) || null;
}

function activeItem() {
  return activeSection()?.items.find((item) => String(item.id) === String(state.selectedItemId)) || null;
}

function render() {
  renderSectionSelect();
  renderItemSelect();
  renderPostedList();
  fillSectionForm();
  fillItemForm();
}

function renderSectionSelect() {
  elements.sectionSelect.innerHTML = [
    `<option value="">Create a new section</option>`,
    ...state.sections.map((section) => `<option value="${esc(section.id)}">${esc(section.name)}</option>`),
  ].join("");
  elements.sectionSelect.value = state.selectedSectionId || "";
}

function renderItemSelect() {
  const section = activeSection();
  const options = [`<option value="">Create a new resource</option>`];
  if (section) {
    options.push(...section.items.map((item) => `<option value="${esc(item.id)}">${esc(item.title)}</option>`));
  }
  elements.itemSelect.innerHTML = options.join("");
  elements.itemSelect.value = state.selectedItemId || "";
}

function renderPostedList() {
  if (!state.sections.length) {
    elements.postedList.innerHTML = `<p>No editable content has been added yet. Use Import current library to start from the existing library content.</p>`;
    return;
  }

  elements.postedList.innerHTML = state.sections.map((section) => `
    <section class="posted-section">
      <div class="posted-section-header">
        <h3>${esc(section.name)}</h3>
        <span>${section.items.length} item${section.items.length === 1 ? "" : "s"}</span>
      </div>
      ${
        section.items.length
          ? section.items.map((item) => `
              <button class="posted-item" type="button" data-section-id="${esc(section.id)}" data-item-id="${esc(item.id)}">
                <span class="pill">${esc(item.itemType || "resource")}</span>
                <span>
                  <strong>${esc(item.title)}</strong>
                  <small>${esc([item.speaker, item.date].filter(Boolean).join(" - ") || item.url)}</small>
                </span>
              </button>
            `).join("")
          : `<button class="posted-item" type="button" data-section-id="${esc(section.id)}"><span class="pill">empty</span><span><strong>No resources in this section</strong><small>Click to edit this section.</small></span></button>`
      }
    </section>
  `).join("");
}

function fillSectionForm() {
  const section = activeSection();
  elements.sectionName.value = section?.name || "";
  elements.sectionSlug.value = section?.slug || "";
  elements.sectionOrder.value = section?.displayOrder ?? state.sections.length;
  elements.sectionDescription.value = section?.description || "";
  elements.sectionVisible.checked = section?.isVisible ?? true;
  elements.deleteSectionButton.disabled = !section;
}

function fillItemForm() {
  const item = activeItem();
  elements.itemTitle.value = item?.title || "";
  elements.itemUrl.value = item?.url || "";
  elements.itemSpeaker.value = item?.speaker || "";
  elements.itemDate.value = item?.date || "";
  elements.itemType.value = item?.itemType || "resource";
  elements.itemOrder.value = item?.displayOrder ?? (activeSection()?.items.length || 0);
  elements.itemVisible.checked = item?.isVisible ?? true;
  elements.deleteItemButton.disabled = !item;
}

async function loadLibrary() {
  const data = await requestJson("/api/admin/library");
  state.sections = data.sections || [];
  if (state.selectedSectionId && !activeSection()) state.selectedSectionId = "";
  if (!state.selectedSectionId && state.sections[0]) state.selectedSectionId = String(state.sections[0].id);
  if (state.selectedItemId && !activeItem()) state.selectedItemId = "";
  render();
}

async function showDashboard() {
  elements.loginView.hidden = true;
  elements.dashboard.hidden = false;
  await loadLibrary();
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage("");
  const button = elements.loginForm.querySelector("button");
  setBusy(button, true, "Signing in...");
  try {
    await requestJson("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username: elements.username.value,
        password: elements.password.value,
      }),
    });
    await showDashboard();
  } catch (error) {
    loginMessage(error.message);
  } finally {
    setBusy(button, false, "Sign in");
  }
});

elements.refreshButton.addEventListener("click", async () => {
  setBusy(elements.refreshButton, true, "Refreshing...");
  try {
    await loadLibrary();
    message("Library data refreshed.", "success");
  } catch (error) {
    message(error.message, "error");
  } finally {
    setBusy(elements.refreshButton, false, "Refresh data");
  }
});

elements.importButton.addEventListener("click", async () => {
  if (!confirm("Import the current library into the admin editor? This will add editable copies of the current sections and resources.")) return;
  setBusy(elements.importButton, true, "Importing...");
  try {
    const data = await requestJson("/api/admin/library/import-source", { method: "POST" });
    state.sections = data.sections || [];
    state.selectedSectionId = state.sections[0] ? String(state.sections[0].id) : "";
    state.selectedItemId = "";
    render();
    message("Current library imported. Future edits can be managed here.", "success");
  } catch (error) {
    message(error.message, "error");
  } finally {
    setBusy(elements.importButton, false, "Import current library");
  }
});

elements.signOutButton.addEventListener("click", async () => {
  await requestJson("/api/admin/logout", { method: "POST" }).catch(() => {});
  window.location.reload();
});

elements.sectionSelect.addEventListener("change", () => {
  state.selectedSectionId = elements.sectionSelect.value;
  state.selectedItemId = "";
  render();
});

elements.itemSelect.addEventListener("change", () => {
  state.selectedItemId = elements.itemSelect.value;
  fillItemForm();
});

elements.newSectionButton.addEventListener("click", () => {
  state.selectedSectionId = "";
  state.selectedItemId = "";
  render();
});

elements.newItemButton.addEventListener("click", () => {
  state.selectedItemId = "";
  renderItemSelect();
  fillItemForm();
});

elements.sectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!confirm("Save this section?")) return;
  const payload = {
    name: elements.sectionName.value,
    slug: elements.sectionSlug.value,
    description: elements.sectionDescription.value,
    displayOrder: elements.sectionOrder.value,
    isVisible: elements.sectionVisible.checked,
  };
  const section = activeSection();
  const url = section ? `/api/admin/library/sections/${section.id}` : "/api/admin/library/sections";
  const method = section ? "PUT" : "POST";
  try {
    const result = await requestJson(url, { method, body: JSON.stringify(payload) });
    state.selectedSectionId = String(result.section.id);
    await loadLibrary();
    message("Section saved.", "success");
  } catch (error) {
    message(error.message, "error");
  }
});

elements.deleteSectionButton.addEventListener("click", async () => {
  const section = activeSection();
  if (!section) return;
  if (!confirm(`Delete "${section.name}" and all resources in this section?`)) return;
  try {
    await requestJson(`/api/admin/library/sections/${section.id}`, { method: "DELETE" });
    state.selectedSectionId = "";
    state.selectedItemId = "";
    await loadLibrary();
    message("Section deleted.", "success");
  } catch (error) {
    message(error.message, "error");
  }
});

elements.itemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const section = activeSection();
  if (!section) {
    message("Choose or create a section before saving a resource.", "error");
    return;
  }
  if (!confirm("Save this resource?")) return;
  const payload = {
    sectionId: section.id,
    title: elements.itemTitle.value,
    url: elements.itemUrl.value,
    speaker: elements.itemSpeaker.value,
    date: elements.itemDate.value,
    itemType: elements.itemType.value,
    displayOrder: elements.itemOrder.value,
    isVisible: elements.itemVisible.checked,
  };
  const item = activeItem();
  const url = item ? `/api/admin/library/items/${item.id}` : "/api/admin/library/items";
  const method = item ? "PUT" : "POST";
  try {
    const result = await requestJson(url, { method, body: JSON.stringify(payload) });
    state.selectedItemId = String(result.item.id);
    await loadLibrary();
    message("Resource saved.", "success");
  } catch (error) {
    message(error.message, "error");
  }
});

elements.deleteItemButton.addEventListener("click", async () => {
  const item = activeItem();
  if (!item) return;
  if (!confirm(`Delete "${item.title}"?`)) return;
  try {
    await requestJson(`/api/admin/library/items/${item.id}`, { method: "DELETE" });
    state.selectedItemId = "";
    await loadLibrary();
    message("Resource deleted.", "success");
  } catch (error) {
    message(error.message, "error");
  }
});

elements.postedList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-section-id]");
  if (!button) return;
  state.selectedSectionId = button.dataset.sectionId || "";
  state.selectedItemId = button.dataset.itemId || "";
  render();
  document.querySelector(".accent-panel").scrollIntoView({ behavior: "smooth", block: "start" });
});

async function bootstrap() {
  try {
    await requestJson("/api/admin/me");
    await showDashboard();
  } catch {
    elements.loginView.hidden = false;
    elements.dashboard.hidden = true;
  }
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

bootstrap();
