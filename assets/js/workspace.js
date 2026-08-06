// assets/js/workspace.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";

// ---------- avatar rendering (local SVG — no network dependency) ----------
const DEFAULT_SETTINGS = { base_style: "", skin_tone: "light", hairstyle: "shortHairShortFlat", hair_color: "black", shirt_color: "blue03", has_glasses: false, has_tie: false, has_hat: false };

const TOP_OPTIONS = [
  { value: "shortHairShortFlat", label: "Short" },
  { value: "longHairStraight", label: "Long" },
  { value: "noHair", label: "Bald" },
];
const HAIR_COLOR_OPTIONS = [
  { value: "black", swatch: "#2c1b18" },
  { value: "brownDark", swatch: "#4a312c" },
  { value: "blonde", swatch: "#e8c88e" },
  { value: "red", swatch: "#a55728" },
  { value: "silverGray", swatch: "#b5b5b5" },
];
const SKIN_OPTIONS = [
  { value: "light", swatch: "#ffe0bd" },
  { value: "tanned", swatch: "#eaa971" },
  { value: "brown", swatch: "#ae5d29" },
  { value: "darkBrown", swatch: "#7a4530" },
  { value: "black", swatch: "#5a3a22" },
];
const CLOTHES_COLOR_OPTIONS = [
  { value: "white", swatch: "#f3f4f6" },
  { value: "blue03", swatch: "#65c9ff" },
  { value: "gray01", swatch: "#e6e6e6" },
  { value: "pastelGreen", swatch: "#77dd77" },
  { value: "red", swatch: "#ff5c5c" },
  { value: "black", swatch: "#262e33" },
];

function swatchFor(list, value, fallback) {
  const found = list.find((o) => o.value === value);
  return found ? found.swatch : fallback;
}

// Renders the avatar as an inline SVG string — pure local generation, no
// image request, so nothing here can ever be blocked by a network/firewall.
function avatarImg(settings, seed, size = 56) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const skin = swatchFor(SKIN_OPTIONS, s.skin_tone, SKIN_OPTIONS[0].swatch);
  const hair = swatchFor(HAIR_COLOR_OPTIONS, s.hair_color, HAIR_COLOR_OPTIONS[0].swatch);
  const shirt = swatchFor(CLOTHES_COLOR_OPTIONS, s.shirt_color, CLOTHES_COLOR_OPTIONS[0].swatch);
  const isBald = s.hairstyle === "noHair" || s.hairstyle === "bald";
  const isLongHair = /long/i.test(s.hairstyle || "") || s.hairstyle === "bob" || s.hairstyle === "ponytail";

  return `
    <svg viewBox="0 0 60 60" width="${size}" height="${size}" style="flex-shrink:0;">
      <rect x="8" y="40" width="44" height="18" rx="9" fill="${shirt}" stroke="#e2e5ea" stroke-width="1"/>
      <circle cx="30" cy="24" r="15" fill="${skin}"/>
      ${s.has_tie ? `<path d="M28,40 L32,40 L34,45 L30,58 L26,45 Z" fill="#7f1d1d"/>` : ""}
      ${!isBald ? `<path d="M13,22 A17,17 0 1,1 47,22 Z" fill="${hair}"/>` : ""}
      ${isLongHair && !isBald ? `
        <path d="M13,22 Q9,34 11,49 Q14.5,53 18.5,50 L18.5,24 Z" fill="${hair}"/>
        <path d="M47,22 Q51,34 49,49 Q45.5,53 41.5,50 L41.5,24 Z" fill="${hair}"/>
      ` : ""}
      ${s.has_glasses ? `
        <rect x="17" y="22" width="10" height="7" rx="2" fill="none" stroke="#333" stroke-width="1.6"/>
        <rect x="33" y="22" width="10" height="7" rx="2" fill="none" stroke="#333" stroke-width="1.6"/>
        <line x1="27" y1="25" x2="33" y2="25" stroke="#333" stroke-width="1.6"/>
      ` : ""}
      ${s.has_hat ? `
        <path d="M12,21 A18,18 0 1,1 48,21 Z" fill="#374151"/>
        <rect x="10" y="18" width="40" height="6" rx="3" fill="#1f2937"/>
      ` : ""}
    </svg>`;
}

// ---------- room layout ----------
const AI_ROBOT_SVG = `
  <svg viewBox="0 0 60 60" width="30" height="30">
    <line x1="30" y1="4" x2="30" y2="12" stroke="#93c5fd" stroke-width="3" stroke-linecap="round"/>
    <circle cx="30" cy="4" r="3.5" fill="#93c5fd"/>
    <circle cx="9" cy="30" r="5" fill="#1e3a5f"/>
    <circle cx="51" cy="30" r="5" fill="#1e3a5f"/>
    <rect x="10" y="12" width="40" height="34" rx="12" fill="#f3f4f6"/>
    <rect x="16" y="19" width="28" height="20" rx="7" fill="#0b1220"/>
    <circle cx="24" cy="29" r="3.2" fill="#60a5fa"/>
    <circle cx="36" cy="29" r="3.2" fill="#60a5fa"/>
    <path d="M23,34.5 Q30,39 37,34.5" stroke="#60a5fa" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </svg>`;
const ROOM = { width: 860, height: 620 };
const DESK_ZONE = { top: 150, bottom: 480, left: 120, right: 760 };
const AI_POSITION = { x: 700, y: 545 };
const SPEED = 220; // px/sec
const MIN_DESKS = 10; // always show room for the team you're growing into, not just who's joined so far

// Desks are organized into facing "pods" of 2 (like real desk clusters),
// with an aisle between pods — not just an evenly-spaced grid.
function generateDeskSlots(count) {
  const total = Math.max(count, MIN_DESKS);
  const podColumns = [200, 280, 600, 680];
  const rows = Math.ceil(total / podColumns.length);
  const yStep = rows > 1 ? (DESK_ZONE.bottom - DESK_ZONE.top) / (rows - 1) : 0;
  const slots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < podColumns.length; c++) {
      if (slots.length >= total) break;
      slots.push({
        x: podColumns[c],
        y: rows > 1 ? DESK_ZONE.top + r * yStep : (DESK_ZONE.top + DESK_ZONE.bottom) / 2,
      });
    }
  }
  return slots;
}

// ---------- module state ----------
let orgMembersCache = [];
let onlineUserIds = new Set();
let mySettings = { ...DEFAULT_SETTINGS };
let myPosition = { x: 430, y: 300 };
let otherPositions = {};
let officeChannel = null;
let chatChannel = null;
let reactionsChannel = null;
let activeChatRoomId = null;
let privateRoomsCache = [];
let keydownHandlerAttached = false;
let visibleMessages = [];

export async function renderWorkspace(el) {
  el.innerHTML = `
    <div class="page-header"><h1>Virtual Workspace</h1></div>
    <div class="workspace-layout">
      <div class="workspace-main">
        <div class="import-card">
          <div class="workspace-toolbar">
            <h3 style="margin:0;">The Office <span id="online-count" class="hint"></span></h3>
            <button id="customize-avatar-btn" class="btn-secondary">Customize My Avatar</button>
          </div>
          <div id="avatar-customizer"></div>
          <div id="office-room-wrap">Loading...</div>
        </div>
      </div>
      <div class="workspace-chat import-card">
        <div class="chat-tabs">
          <button id="tab-public" class="chat-tab active">Public Chat</button>
          <button id="tab-private" class="chat-tab">Private Chat</button>
        </div>
        <div id="private-room-list" class="private-room-list hidden"></div>
        <div id="chat-back-row" class="hidden"><button id="chat-back-btn" class="btn-link">← Conversations</button></div>
        <div id="chat-messages" class="chat-messages">Loading...</div>
        <form id="chat-form" class="chat-form">
          <input type="text" id="chat-input" placeholder="Type a message..." autocomplete="off" />
          <button type="submit" class="btn-primary" style="width:auto;">Send</button>
        </form>
      </div>
    </div>
    <div id="ai-assistant-popup" class="ai-assistant-popup hidden"></div>
  `;

  document.getElementById("customize-avatar-btn").addEventListener("click", toggleCustomizer);
  document.getElementById("tab-public").addEventListener("click", () => switchTab("public"));
  document.getElementById("tab-private").addEventListener("click", () => switchTab("private"));
  document.getElementById("chat-back-btn").addEventListener("click", () => switchTab("private"));

  const identity = getIdentity();
  const orgId = identity.organisationId;

  const [{ data: members }, { data: myRow }, { data: org }, { data: orgSettings }] = await Promise.all([
    supabase.from("organisation_members").select("user_id, role, profiles(display_name, email)").eq("organisation_id", orgId).eq("status", "active"),
    supabase.from("workspace_user_settings").select("*").eq("user_id", identity.user.id).maybeSingle(),
    supabase.from("organisations").select("name").eq("id", orgId).single(),
    supabase.from("organisation_settings").select("logo_url, workspace_background_url").eq("organisation_id", orgId).maybeSingle(),
  ]);
  orgMembersCache = members || [];
  if (myRow) mySettings = { ...DEFAULT_SETTINGS, ...myRow };

  const { data: settingsRows } = await supabase.from("workspace_user_settings").select("*").eq("organisation_id", orgId);
  const settingsByUser = Object.fromEntries((settingsRows || []).map((s) => [s.user_id, s]));

  renderOfficeRoom(settingsByUser, {
    firmName: org?.name || "",
    logoUrl: orgSettings?.logo_url || null,
    backgroundUrl: orgSettings?.workspace_background_url || null,
  });
  setupOfficeChannel();

  await openPublicChat();

  if (!keydownHandlerAttached) {
    keydownHandlerAttached = true;
    document.addEventListener("keydown", (e) => {
      const hint = document.getElementById("ai-interact-hint");
      if ((e.key === "e" || e.key === "E") && hint && !hint.classList.contains("hidden")) {
        toggleAiPopup();
      }
    });
  }
}

// ---------- avatar customizer ----------
async function toggleCustomizer() {
  const container = document.getElementById("avatar-customizer");
  if (container.dataset.open === "true") {
    container.innerHTML = "";
    container.dataset.open = "false";
    return;
  }
  container.dataset.open = "true";
  const current = { ...mySettings };

  container.innerHTML = `
    <div class="avatar-customizer">
      <div class="avatar-preview" id="avatar-preview">${avatarImg(current, getIdentity().user.id, 84, getIdentity().profile?.display_name)}</div>
      <div class="avatar-options">
        <div class="option-group">
          <label class="option-label">Gender (optional)</label>
          <div class="swatch-row">
            <button type="button" class="choice-btn" data-field="base_style" data-value="masculine">Male</button>
            <button type="button" class="choice-btn" data-field="base_style" data-value="feminine">Female</button>
            <button type="button" class="choice-btn" data-field="base_style" data-value="">Skip</button>
          </div>
        </div>
        <div class="option-group">
          <label class="option-label">Hair Style</label>
          <div class="swatch-row">
            ${TOP_OPTIONS.map((o) => `<button type="button" class="choice-btn" data-field="hairstyle" data-value="${o.value}">${o.label}</button>`).join("")}
          </div>
        </div>
        <div class="option-group">
          <label class="option-label">Hair Color</label>
          <div class="swatch-row">
            ${HAIR_COLOR_OPTIONS.map((o) => `<button type="button" class="swatch-btn" data-field="hair_color" data-value="${o.value}" style="background:${o.swatch};"></button>`).join("")}
          </div>
        </div>
        <div class="option-group">
          <label class="option-label">Skin Tone</label>
          <div class="swatch-row">
            ${SKIN_OPTIONS.map((o) => `<button type="button" class="swatch-btn" data-field="skin_tone" data-value="${o.value}" style="background:${o.swatch};"></button>`).join("")}
          </div>
        </div>
        <div class="option-group">
          <label class="option-label">Shirt Color</label>
          <div class="swatch-row">
            ${CLOTHES_COLOR_OPTIONS.map((o) => `<button type="button" class="swatch-btn" data-field="shirt_color" data-value="${o.value}" style="background:${o.swatch};border:1px solid var(--gray-200);"></button>`).join("")}
          </div>
        </div>
        <label class="option-label">Accessories</label>
        <label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:13px;margin-bottom:6px;">
          <input type="checkbox" id="opt-glasses" style="width:auto;" /> Glasses
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:13px;margin-bottom:6px;">
          <input type="checkbox" id="opt-tie" style="width:auto;" /> Tie
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:13px;margin-bottom:6px;">
          <input type="checkbox" id="opt-hat" style="width:auto;" /> Hat
        </label>
        <button id="save-avatar-btn" class="btn-dark" style="margin-top:8px;">Save Avatar</button>
      </div>
    </div>
  `;

  const state = { ...current };
  document.getElementById("opt-glasses").checked = state.has_glasses;
  document.getElementById("opt-tie").checked = state.has_tie;
  document.getElementById("opt-hat").checked = state.has_hat;

  function refreshPreview() {
    document.getElementById("avatar-preview").innerHTML = avatarImg(state, getIdentity().user.id, 84, getIdentity().profile?.display_name);
    container.querySelectorAll(".swatch-btn, .choice-btn").forEach((btn) => {
      btn.classList.toggle("selected", state[btn.dataset.field] === btn.dataset.value);
    });
  }
  container.querySelectorAll(".swatch-btn, .choice-btn").forEach((btn) => {
    btn.addEventListener("click", () => { state[btn.dataset.field] = btn.dataset.value; refreshPreview(); });
  });
  document.getElementById("opt-glasses").addEventListener("change", (e) => { state.has_glasses = e.target.checked; refreshPreview(); });
  document.getElementById("opt-tie").addEventListener("change", (e) => { state.has_tie = e.target.checked; refreshPreview(); });
  document.getElementById("opt-hat").addEventListener("change", (e) => { state.has_hat = e.target.checked; refreshPreview(); });
  refreshPreview();

  document.getElementById("save-avatar-btn").addEventListener("click", async () => {
    const identity = getIdentity();
    const { error } = await supabase
      .from("workspace_user_settings")
      .upsert({ user_id: identity.user.id, organisation_id: identity.organisationId, ...state }, { onConflict: "user_id" });
    if (error) { alert("Could not save avatar: " + error.message); return; }
    mySettings = { ...state };
    container.innerHTML = "";
    container.dataset.open = "false";
    const youEl = document.getElementById("you-avatar");
    if (youEl) {
      const svgEl = youEl.querySelector("svg");
      if (svgEl) svgEl.outerHTML = avatarImg(mySettings, identity.user.id, 44);
    }
  });
}

// ---------- office room ----------
let roomBranding = { firmName: "", logoUrl: null, backgroundUrl: null };

function renderOfficeRoom(settingsByUser, branding) {
  if (branding) roomBranding = branding;
  const wrap = document.getElementById("office-room-wrap");
  const identity = getIdentity();
  const selfId = identity.user.id;
  const others = orgMembersCache.filter((m) => m.user_id !== selfId);

  const deskSlots = generateDeskSlots(others.length);
  const deskFor = {};
  others.forEach((m, i) => { deskFor[m.user_id] = deskSlots[i]; });
  const emptyDeskSlots = deskSlots.slice(others.length);

  const hasCustomBg = !!roomBranding.backgroundUrl;
  const roomStyle = hasCustomBg
    ? `background-image:url('${roomBranding.backgroundUrl}');background-size:cover;background-position:center;`
    : "";

  const spotlightHtml = `
    <div class="spotlight-board">
      ${roomBranding.logoUrl ? `<img src="${roomBranding.logoUrl}" alt="Firm logo" class="spotlight-logo" />` : ""}
      <span class="spotlight-name">${roomBranding.firmName || "Your Firm"}</span>
    </div>`;

  wrap.innerHTML = `
    <div id="office-room" class="office-room" style="${roomStyle}">
      ${spotlightHtml}
      ${hasCustomBg ? "" : `
        <div class="furniture furniture-tree" style="left:16px;top:46px;" title="Tree"><div class="tree-canopy"></div><div class="tree-trunk"></div></div>
        <div class="furniture furniture-tree" style="left:786px;top:46px;" title="Tree"><div class="tree-canopy"></div><div class="tree-trunk"></div></div>
      `}

      ${hasCustomBg ? "" : emptyDeskSlots.map((desk) => `<div class="desk desk-empty" style="left:${desk.x}px;top:${desk.y}px;"><div class="desk-monitor"></div><div class="desk-chair"></div></div>`).join("")}

      ${others
        .map((m) => {
          const desk = deskFor[m.user_id];
          const pos = otherPositions[m.user_id] || desk;
          const settings = settingsByUser[m.user_id] || DEFAULT_SETTINGS;
          const online = onlineUserIds.has(m.user_id);
          return `
            ${hasCustomBg ? "" : `<div class="desk" style="left:${desk.x}px;top:${desk.y}px;"><div class="desk-monitor"></div><div class="desk-chair"></div></div>`}
            <div id="avatar-${m.user_id}" class="room-avatar" style="left:${pos.x}px;top:${pos.y}px;" data-x="${pos.x}" data-y="${pos.y}">
              ${avatarImg(settings, m.user_id, 44, m.profiles?.display_name || m.profiles?.email)}
              <span class="name-tag"><span class="presence-dot-inline ${online ? "online" : ""}"></span>${m.profiles?.display_name || m.profiles?.email}</span>
            </div>`;
        })
        .join("")}

      <div id="ai-assistant-avatar" class="room-avatar ai-room-avatar" style="left:${AI_POSITION.x}px;top:${AI_POSITION.y}px;">
        <div class="ai-room-icon">${AI_ROBOT_SVG}</div>
        <span class="name-tag">AI Assistant</span>
        <span id="ai-interact-hint" class="interact-hint hidden">Press E</span>
      </div>

      <div id="you-avatar" class="room-avatar you-room-avatar" style="left:${myPosition.x}px;top:${myPosition.y}px;" data-x="${myPosition.x}" data-y="${myPosition.y}">
        ${avatarImg(mySettings, identity.user.id, 44, identity.profile?.display_name)}
        <span class="name-tag you-tag">You</span>
      </div>

      <div id="move-marker" class="move-marker hidden"></div>
    </div>
    <p class="hint" style="margin-top:8px;">Click anywhere in the room to walk there. Walk near the AI Assistant and press <strong>E</strong> (or click it) to open quick tasks.</p>
  `;

  document.getElementById("office-room").addEventListener("click", handleRoomClick);
  document.getElementById("ai-assistant-avatar").addEventListener("click", (e) => { e.stopPropagation(); toggleAiPopup(); });

  updateOnlineCount();
}

function clampToRoom(x, y) {
  return { x: Math.max(24, Math.min(ROOM.width - 24, x)), y: Math.max(24, Math.min(ROOM.height - 24, y)) };
}

function moveAvatarEl(el, x, y) {
  const prevX = parseFloat(el.dataset.x || x);
  const prevY = parseFloat(el.dataset.y || y);
  const dist = Math.hypot(x - prevX, y - prevY);
  const duration = Math.max(0.15, dist / SPEED);
  el.style.transition = `left ${duration}s linear, top ${duration}s linear`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.dataset.x = x;
  el.dataset.y = y;
}

function handleRoomClick(e) {
  const room = document.getElementById("office-room");
  const rect = room.getBoundingClientRect();
  const { x, y } = clampToRoom(e.clientX - rect.left, e.clientY - rect.top);
  myPosition = { x, y };

  const myEl = document.getElementById("you-avatar");
  if (myEl) moveAvatarEl(myEl, x, y);

  const marker = document.getElementById("move-marker");
  if (marker) {
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
    marker.classList.remove("hidden");
    setTimeout(() => marker.classList.add("hidden"), 500);
  }

  broadcastPosition(x, y);
  checkAiProximity();
}

function checkAiProximity() {
  const dist = Math.hypot(myPosition.x - AI_POSITION.x, myPosition.y - AI_POSITION.y);
  const hint = document.getElementById("ai-interact-hint");
  if (hint) hint.classList.toggle("hidden", dist > 90);
}

function broadcastPosition(x, y) {
  if (!officeChannel) return;
  officeChannel.send({ type: "broadcast", event: "move", payload: { user_id: getIdentity().user.id, x, y } });
}

function updateOnlineCount() {
  const el = document.getElementById("online-count");
  if (el) el.textContent = `· ${onlineUserIds.size} online`;
}

function setupOfficeChannel() {
  const identity = getIdentity();
  const orgId = identity.organisationId;
  if (officeChannel) supabase.removeChannel(officeChannel);

  officeChannel = supabase.channel(`office-${orgId}`, { config: { presence: { key: identity.user.id }, broadcast: { self: false } } });

  officeChannel
    .on("presence", { event: "sync" }, () => {
      const state = officeChannel.presenceState();
      onlineUserIds = new Set(Object.keys(state));
      updateOnlineCount();
      orgMembersCache.forEach((m) => {
        const el = document.getElementById(`avatar-${m.user_id}`);
        const dot = el?.querySelector(".presence-dot-inline");
        if (dot) dot.classList.toggle("online", onlineUserIds.has(m.user_id));
      });
    })
    .on("presence", { event: "join" }, () => {
      broadcastPosition(myPosition.x, myPosition.y);
    })
    .on("broadcast", { event: "move" }, ({ payload }) => {
      if (payload.user_id === identity.user.id) return;
      otherPositions[payload.user_id] = { x: payload.x, y: payload.y };
      const el = document.getElementById(`avatar-${payload.user_id}`);
      if (el) moveAvatarEl(el, payload.x, payload.y);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await officeChannel.track({ user_id: identity.user.id });
        broadcastPosition(myPosition.x, myPosition.y);
      }
    });
}

// ---------- AI Assistant popup ----------
async function toggleAiPopup() {
  const popup = document.getElementById("ai-assistant-popup");
  if (!popup.classList.contains("hidden")) { popup.classList.add("hidden"); return; }

  const orgId = getIdentity()?.organisationId;
  const { data } = await supabase.from("ai_tools").select("id, name, url, description").eq("organisation_id", orgId).eq("active", true).order("sort_order");

  popup.innerHTML = `
    <div class="ai-popup-header">AI Assistant</div>
    ${(data || []).map((tool) => `<a href="${tool.url}" target="_blank" rel="noopener" class="ai-popup-item"><strong>${tool.name}</strong><span>${tool.description ?? ""}</span></a>`).join("") || `<p class="hint" style="padding:12px;">No AI tools configured yet.</p>`}
  `;
  popup.classList.remove("hidden");
}

// ---------- chat: tabs ----------
function switchTab(tab) {
  document.getElementById("tab-public").classList.toggle("active", tab === "public");
  document.getElementById("tab-private").classList.toggle("active", tab === "private");

  if (tab === "public") {
    document.getElementById("private-room-list").classList.add("hidden");
    document.getElementById("chat-back-row").classList.add("hidden");
    document.getElementById("chat-messages").classList.remove("hidden");
    document.getElementById("chat-form").classList.remove("hidden");
    openPublicChat();
  } else {
    document.getElementById("chat-messages").classList.add("hidden");
    document.getElementById("chat-form").classList.add("hidden");
    document.getElementById("chat-back-row").classList.add("hidden");
    document.getElementById("private-room-list").classList.remove("hidden");
    loadPrivateRoomList();
  }
}

async function loadPrivateRoomList() {
  const identity = getIdentity();
  const listEl = document.getElementById("private-room-list");
  listEl.innerHTML = `<p class="hint">Loading...</p>`;

  const { data: memberRows } = await supabase
    .from("chat_room_members")
    .select("room_id, chat_rooms(id, room_type)")
    .eq("user_id", identity.user.id);

  const privateRoomIds = (memberRows || []).filter((r) => r.chat_rooms?.room_type === "private").map((r) => r.room_id);

  let others = [];
  if (privateRoomIds.length) {
    const { data: allMembers } = await supabase.from("chat_room_members").select("room_id, user_id").in("room_id", privateRoomIds);
    const otherIdByRoom = {};
    (allMembers || []).forEach((m) => { if (m.user_id !== identity.user.id) otherIdByRoom[m.room_id] = m.user_id; });
    others = privateRoomIds.map((roomId) => {
      const otherId = otherIdByRoom[roomId];
      const member = orgMembersCache.find((m) => m.user_id === otherId);
      return { roomId, name: member?.profiles?.display_name || member?.profiles?.email || "Unknown" };
    });
  }
  privateRoomsCache = others;

  const selfId = identity.user.id;
  const candidates = orgMembersCache.filter((m) => m.user_id !== selfId);

  listEl.innerHTML = `
    <div class="new-dm-row">
      <select id="new-dm-select" class="filter-select" style="flex:1;">
        <option value="">Start a conversation with...</option>
        ${candidates.map((m) => `<option value="${m.user_id}">${m.profiles?.display_name || m.profiles?.email}</option>`).join("")}
      </select>
      <button id="new-dm-btn" class="btn-secondary">Start</button>
    </div>
    ${privateRoomsCache.map((r) => `<button class="dm-row" data-room="${r.roomId}">${r.name}</button>`).join("") || `<p class="hint">No conversations yet.</p>`}
  `;

  document.getElementById("new-dm-btn").addEventListener("click", async () => {
    const otherId = document.getElementById("new-dm-select").value;
    if (!otherId) return;
    const { data: roomId, error } = await supabase.rpc("start_or_get_private_chat", { other_user_id: otherId });
    if (error) { alert("Could not start chat: " + error.message); return; }
    await openPrivateConversation(roomId);
  });
  listEl.querySelectorAll("[data-room]").forEach((btn) => {
    btn.addEventListener("click", () => openPrivateConversation(btn.dataset.room));
  });
}

async function openPrivateConversation(roomId) {
  document.getElementById("private-room-list").classList.add("hidden");
  document.getElementById("chat-back-row").classList.remove("hidden");
  document.getElementById("chat-messages").classList.remove("hidden");
  document.getElementById("chat-form").classList.remove("hidden");
  await switchToRoom(roomId);
}

async function openPublicChat() {
  const orgId = getIdentity()?.organisationId;
  let { data: room } = await supabase.from("chat_rooms").select("id").eq("organisation_id", orgId).eq("room_type", "public").limit(1).maybeSingle();

  if (!room) {
    const { data: newRoom, error } = await supabase.from("chat_rooms").insert({ organisation_id: orgId, room_type: "public", name: "Office" }).select().single();
    if (error) { document.getElementById("chat-messages").innerHTML = `<div class="empty-state">Could not open chat.</div>`; return; }
    room = newRoom;
  }
  await switchToRoom(room.id);
}

async function switchToRoom(roomId) {
  const identity = getIdentity();
  activeChatRoomId = roomId;

  await supabase.from("chat_room_members").upsert({ room_id: roomId, user_id: identity.user.id }, { onConflict: "room_id,user_id", ignoreDuplicates: true });

  if (chatChannel) supabase.removeChannel(chatChannel);
  if (reactionsChannel) supabase.removeChannel(reactionsChannel);

  const { data: messages } = await supabase.from("chat_messages").select("id, content, sender_id, created_at").eq("room_id", roomId).order("created_at", { ascending: true }).limit(100);
  visibleMessages = messages || [];
  await renderMessages();

  chatChannel = supabase
    .channel(`room-${roomId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` }, (payload) => {
      visibleMessages.push(payload.new);
      renderMessages();
    })
    .subscribe();

  reactionsChannel = supabase
    .channel(`reactions-${roomId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (payload) => {
      const messageId = payload.new?.message_id || payload.old?.message_id;
      if (visibleMessages.some((m) => m.id === messageId)) refreshReactionsFor(messageId);
    })
    .subscribe();

  const form = document.getElementById("chat-form");
  const newForm = form.cloneNode(true); // drop old submit listeners tied to the previous room
  form.replaceWith(newForm);
  newForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("chat-input");
    const content = input.value.trim();
    if (!content) return;
    input.value = "";
    const { error } = await supabase.from("chat_messages").insert({ organisation_id: identity.organisationId, room_id: roomId, sender_id: identity.user.id, content });
    if (error) alert("Could not send message: " + error.message);
  });
}

function senderName(senderId) {
  if (senderId === getIdentity()?.user?.id) return "You";
  const member = orgMembersCache.find((m) => m.user_id === senderId);
  return member?.profiles?.display_name || member?.profiles?.email || "Someone";
}

async function renderMessages() {
  const el = document.getElementById("chat-messages");
  if (!visibleMessages.length) {
    el.innerHTML = `<p class="hint">No messages yet — say hello!</p>`;
    return;
  }

  const ids = visibleMessages.map((m) => m.id);
  const { data: reactions } = await supabase.from("message_reactions").select("message_id, user_id, emoji").in("message_id", ids);
  const reactionsByMessage = {};
  (reactions || []).forEach((r) => {
    reactionsByMessage[r.message_id] = reactionsByMessage[r.message_id] || [];
    reactionsByMessage[r.message_id].push(r);
  });

  el.innerHTML = visibleMessages.map((m) => messageHTML(m, reactionsByMessage[m.id] || [])).join("");
  el.querySelectorAll("[data-react]").forEach((btn) => {
    btn.addEventListener("click", () => toggleReaction(btn.dataset.react));
  });
  el.scrollTop = el.scrollHeight;
}

function messageHTML(m, reactions) {
  const time = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const selfId = getIdentity()?.user?.id;
  const count = reactions.length;
  const iReacted = reactions.some((r) => r.user_id === selfId);
  return `
    <div class="chat-message" data-message-id="${m.id}">
      <span class="chat-sender">${senderName(m.sender_id)}</span><span class="chat-time">${time}</span>
      <div class="chat-bubble">${m.content}</div>
      <button class="reaction-btn ${iReacted ? "reacted" : ""}" data-react="${m.id}">👍${count ? ` ${count}` : ""}</button>
    </div>`;
}

async function refreshReactionsFor(messageId) {
  const { data: reactions } = await supabase.from("message_reactions").select("message_id, user_id, emoji").eq("message_id", messageId);
  const el = document.querySelector(`[data-message-id="${messageId}"] .reaction-btn`);
  if (!el) return;
  const selfId = getIdentity()?.user?.id;
  const count = (reactions || []).length;
  const iReacted = (reactions || []).some((r) => r.user_id === selfId);
  el.textContent = `👍${count ? ` ${count}` : ""}`;
  el.classList.toggle("reacted", iReacted);
}

async function toggleReaction(messageId) {
  const identity = getIdentity();
  const { data: existing } = await supabase.from("message_reactions").select("id").eq("message_id", messageId).eq("user_id", identity.user.id).eq("emoji", "👍").maybeSingle();
  if (existing) {
    await supabase.from("message_reactions").delete().eq("id", existing.id);
  } else {
    await supabase.from("message_reactions").insert({ message_id: messageId, user_id: identity.user.id, emoji: "👍" });
  }
}
