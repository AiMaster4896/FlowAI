// assets/js/ai-bot.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { isManagerOrAdmin } from "./permissions.js";

const CATEGORY_STYLES = {
  Audit: { bg: "#eff6ff", text: "#2563eb", icon: "📊" },
  Tax: { bg: "#ecfdf5", text: "#059669", icon: "🧮" },
  Automation: { bg: "#f5f3ff", text: "#7c3aed", icon: "📄" },
  Insights: { bg: "#fff7ed", text: "#ea580c", icon: "💡" },
  General: { bg: "#fefce8", text: "#ca8a04", icon: "💬" },
};
const DEFAULT_STYLE = { bg: "#f3f4f6", text: "#4b5563", icon: "🤖" };

function styleFor(category) {
  return CATEGORY_STYLES[category] || DEFAULT_STYLE;
}

let aiToolsCache = [];
let aiCategoryFilter = "";

export async function renderAiBot(el) {
  aiCategoryFilter = "";
  el.innerHTML = `
    <div class="page-header">
      <div>
        <h1>AI Bot</h1>
        <p class="page-subtitle">Your AI assistants for audit and financial tasks.</p>
      </div>
      <div class="page-actions">
        <select id="ai-bot-category-filter" class="filter-select">
          <option value="">All Categories</option>
          ${Object.keys(CATEGORY_STYLES).map((cat) => `<option value="${cat}">${cat}</option>`).join("")}
        </select>
      </div>
    </div>
    <div id="ai-bot-grid" class="ai-bot-grid">Loading...</div>
  `;
  document.getElementById("ai-bot-category-filter").addEventListener("change", (e) => {
    aiCategoryFilter = e.target.value;
    renderGrid();
  });
  await loadAndRenderGrid();
}

async function loadAndRenderGrid() {
  const orgId = getIdentity()?.organisationId;
  const grid = document.getElementById("ai-bot-grid");
  const { data, error } = await supabase
    .from("ai_tools")
    .select("id, name, url, description, category")
    .eq("organisation_id", orgId)
    .eq("active", true)
    .order("sort_order");

  if (error) {
    grid.innerHTML = `<div class="empty-state">Could not load AI tools.</div>`;
    return;
  }
  aiToolsCache = data || [];
  renderGrid();
}

function renderGrid() {
  const grid = document.getElementById("ai-bot-grid");
  const admin = isManagerOrAdmin();
  const visibleTools = aiCategoryFilter ? aiToolsCache.filter((t) => t.category === aiCategoryFilter) : aiToolsCache;

  const cards = visibleTools
    .map((tool) => {
      const s = styleFor(tool.category);
      return `
        <div class="ai-bot-card">
          ${admin ? `
            <div class="ai-bot-card-actions">
              <button class="icon-btn icon-btn-edit" data-edit="${tool.id}" title="Edit">✎</button>
              <button class="icon-btn icon-btn-delete" data-delete="${tool.id}" data-name="${tool.name}" title="Delete">🗑</button>
            </div>` : ""}
          <div class="ai-bot-icon-circle" style="background:${s.bg};">${s.icon}</div>
          <h3 class="ai-bot-name">${tool.name}</h3>
          <p class="ai-bot-description">${tool.description ?? ""}</p>
          ${tool.category ? `<span class="ai-bot-tag" style="background:${s.bg};color:${s.text};">${tool.category}</span>` : ""}
          <a href="${tool.url}" target="_blank" rel="noopener" class="ai-bot-open-btn">↗ Open</a>
        </div>`;
    })
    .join("");

  const addCard = admin
    ? `
      <button id="add-ai-bot-card" class="ai-bot-add-card">
        <span class="ai-bot-add-icon">+</span>
        <span class="ai-bot-add-title">Add New AI Bot</span>
        <span class="ai-bot-add-hint">Create a new AI assistant by adding name, description and link.</span>
      </button>`
    : "";

  grid.innerHTML = (visibleTools.length ? cards : `<div class="empty-state">No AI tools in this category.</div>`) + addCard;

  const addCardBtn = document.getElementById("add-ai-bot-card");
  if (addCardBtn) addCardBtn.addEventListener("click", () => openAiBotModal(null));

  grid.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tool = aiToolsCache.find((t) => t.id === btn.dataset.edit);
      openAiBotModal(tool);
    });
  });
  grid.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Delete "${btn.dataset.name}"? This cannot be undone.`)) return;
      const { error: delError } = await supabase.from("ai_tools").delete().eq("id", btn.dataset.delete);
      if (delError) { alert("Could not delete: " + delError.message); return; }
      await loadAndRenderGrid();
    });
  });
}

function openAiBotModal(existing) {
  const isEdit = !!existing;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:480px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${isEdit ? "Edit AI Bot" : "Add New AI Bot"}</h2>
          <p class="modal-subtitle">${isEdit ? "Update this tool's details." : "Add a name, description, and link to your AI tool."}</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <form id="ai-bot-form">
        <label style="display:block;margin-bottom:14px;">Name
          <input type="text" id="ab-name" required value="${existing?.name ?? ""}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
        </label>
        <label style="display:block;margin-bottom:14px;">Description
          <input type="text" id="ab-description" value="${existing?.description ?? ""}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
        </label>
        <label style="display:block;margin-bottom:14px;">Category
          <select id="ab-category" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;">
            <option value="">No category</option>
            ${Object.keys(CATEGORY_STYLES).map((cat) => `<option value="${cat}" ${existing?.category === cat ? "selected" : ""}>${cat}</option>`).join("")}
          </select>
        </label>
        <label style="display:block;margin-bottom:4px;">URL
          <input type="url" id="ab-url" required placeholder="https://" value="${existing?.url ?? ""}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
        </label>
        <p id="ab-error" class="form-error hidden"></p>
        <div class="modal-actions">
          <button type="button" id="ab-cancel" class="btn-secondary">Cancel</button>
          <button type="submit" class="btn-dark">${isEdit ? "Save Changes" : "Add Bot"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#ab-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector("#ai-bot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const orgId = getIdentity()?.organisationId;
    const errorEl = backdrop.querySelector("#ab-error");

    const payload = {
      organisation_id: orgId,
      name: backdrop.querySelector("#ab-name").value.trim(),
      description: backdrop.querySelector("#ab-description").value.trim() || null,
      category: backdrop.querySelector("#ab-category").value || null,
      url: backdrop.querySelector("#ab-url").value.trim(),
    };

    const { error } = isEdit
      ? await supabase.from("ai_tools").update(payload).eq("id", existing.id)
      : await supabase.from("ai_tools").insert(payload);

    if (error) {
      errorEl.textContent = "Could not save: " + error.message;
      errorEl.classList.remove("hidden");
      return;
    }

    close();
    await loadAndRenderGrid();
  });
}
