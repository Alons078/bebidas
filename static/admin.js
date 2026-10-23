(() => {
  const $ = (s) => document.querySelector(s);
  const fmt = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  const LABEL = { recebido: "Recebido", preparando: "Em preparo", pronto: "Pronto p/ retirar", retirado: "Retirado", cancelado: "Cancelado" };
  const NEXT = { recebido: ["preparando", "Iniciar preparo"], preparando: ["pronto", "Marcar pronto"], pronto: ["retirado", "Confirmar retirada"] };

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {},
      ...opts,
      body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { location.reload(); throw new Error("Sessão expirada"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Erro inesperado");
    return data;
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  }

  /* ---------- som de novo pedido ---------- */
  let audioCtx = null;
  let soundOn = false;
  $("#sound-btn").onclick = () => {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume();
      soundOn = !soundOn;
      $("#sound-btn").textContent = soundOn ? "🔔 Som ligado" : "🔔 Ativar som";
      if (soundOn) beep();
    } catch { toast("Seu navegador não permite som."); }
  };
  function beep() {
    if (!soundOn || !audioCtx) return;
    [[880, 0], [1320, 0.16], [880, 0.32], [1320, 0.48]].forEach(([freq, delay]) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "square"; o.frequency.value = freq;
      const t = audioCtx.currentTime + delay;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + 0.14);
    });
  }

  /* ---------- abas ---------- */
  let tab = "orders";
  function showTab(name) {
    tab = name;
    document.querySelectorAll("#admin-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    ["orders", "history", "products", "store"].forEach((t) => { $("#tab-" + t).hidden = t !== name; });
    if (name === "orders") loadOrders();
    if (name === "history") loadHistory();
    if (name === "products") loadProducts();
    if (name === "store") loadStore();
  }
  $("#admin-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) showTab(b.dataset.tab);
  });

  /* ---------- pedidos ---------- */
  const openIds = new Set();
  let seen = null;
  let lastSig = "";

  const fmtTime = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  function orderCard(o, withActions) {
    const items = o.items.map((it) =>
      `<li><span>${it.qty}× ${esc(it.name)}</span><span>${fmt(it.price_cents * it.qty)}</span></li>`).join("");
    const next = NEXT[o.status];
    const actions = withActions ? `<div class="order-actions">
        ${next ? `<button class="btn primary" data-status="${next[0]}" data-code="${esc(o.code)}">${next[1]}</button>` : ""}
        <button class="btn danger" data-status="cancelado" data-code="${esc(o.code)}">Cancelar</button>
      </div>` : "";
    const phone = esc(o.customer_phone);
    return `<article class="order s-${o.status}">
      <div class="order-head">
        <div><h4>#${esc(o.code)} · ${esc(o.customer_name)}</h4>
          <span class="muted small">${fmtTime(o.created_at)} · ${esc(o.payment_label)} · <a href="tel:${phone}">${phone}</a></span></div>
        <span class="status-tag">${LABEL[o.status] || o.status}</span>
      </div>
      <details data-code="${esc(o.code)}" ${openIds.has(o.code) ? "open" : ""}>
        <summary>${o.items.reduce((a, i) => a + i.qty, 0)} itens · ${fmt(o.total_cents)}</summary>
        <ul class="items-list">${items}</ul>
        ${o.notes ? `<p class="muted small">Obs.: ${esc(o.notes)}</p>` : ""}
      </details>
      ${actions}
    </article>`;
  }

  async function loadOrders() {
    let data;
    try { data = await api("/api/admin/orders?scope=active"); } catch { return; }
    const sig = JSON.stringify(data.orders);
    const ids = new Set(data.orders.map((o) => o.code));
    if (seen !== null && [...ids].some((c) => !seen.has(c))) beep();
    seen = ids;
    const badge = $("#orders-badge");
    badge.textContent = data.orders.length;
    badge.hidden = data.orders.length === 0;
    if (sig === lastSig) return;
    lastSig = sig;
    $("#orders-list").innerHTML = data.orders.length
      ? data.orders.map((o) => orderCard(o, true)).join("")
      : '<p class="muted" style="text-align:center;padding:40px 0">Nenhum pedido em andamento.</p>';
  }

  async function loadHistory() {
    let data;
    try { data = await api("/api/admin/orders?scope=history"); } catch { return; }
    $("#today-summary").innerHTML =
      `<span class="muted small">Retiradas hoje</span><b style="font-size:1.4rem">${data.today.count} pedidos · ${fmt(data.today.total_cents)}</b>`;
    $("#history-list").innerHTML = data.orders.length
      ? data.orders.map((o) => orderCard(o, false)).join("")
      : '<p class="muted" style="text-align:center;padding:30px 0">Sem histórico ainda.</p>';
  }

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-status]");
    if (!btn) return;
    if (btn.dataset.status === "cancelado" && !confirm("Cancelar este pedido? O estoque será devolvido.")) return;
    btn.disabled = true;
    try {
      await api(`/api/admin/orders/${encodeURIComponent(btn.dataset.code)}/status`, { method: "POST", body: { status: btn.dataset.status } });
      lastSig = "";
      loadOrders();
    } catch (err) { toast(err.message); btn.disabled = false; }
  });

  // guarda quais pedidos estão expandidos (o toggle não "borbulha")
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (d.tagName === "DETAILS" && d.dataset.code) {
      if (d.open) openIds.add(d.dataset.code); else openIds.delete(d.dataset.code);
    }
  }, true);

  /* ---------- produtos ---------- */
  let products = [];
  const form = $("#product-form");

  const emojiFor = (c) => {
    c = c.toLowerCase();
    return c.includes("cerveja") ? "🍺" : c.includes("whisk") ? "🥃" : (c.includes("vodka") || c.includes("gin")) ? "🍸" : c.includes("vinho") ? "🍷" : "🧊";
  };

  async function loadProducts() {
    try { products = (await api("/api/admin/products")).products; } catch { return; }
    $("#cat-list").innerHTML = [...new Set(products.map((p) => p.category))].map((c) => `<option value="${esc(c)}">`).join("");
    $("#products-list").innerHTML = products.map((p) => {
      const style = p.image ? ` style="background-image:url('${esc(p.image)}')"` : "";
      return `<div class="prow ${p.active ? "" : "off"}">
        <div class="pthumb"${style}>${p.image ? "" : emojiFor(p.category)}</div>
        <div class="pinfo"><b>${esc(p.name)}</b><span>${esc(p.category)} · ${fmt(p.price_cents)} · estoque ${p.stock}${p.active ? "" : " · oculto"}</span></div>
        <div class="pact">
          <button class="btn small" data-edit="${p.id}">Editar</button>
          <button class="btn small danger" data-del="${p.id}">Excluir</button>
        </div>
      </div>`;
    }).join("") || '<p class="muted">Nenhum produto.</p>';
  }

  function resetForm() {
    form.reset();
    $("#p-id").value = ""; $("#p-image").value = "";
    $("#p-preview").hidden = true;
    $("#p-reset").hidden = true;
    $("#form-title").textContent = "Novo produto";
    $("#p-active").checked = true;
    $("#p-error").hidden = true;
  }
  $("#p-reset").onclick = resetForm;

  $("#p-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const pv = $("#p-preview");
    pv.src = URL.createObjectURL(f);
    pv.hidden = false;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#p-error");
    err.hidden = true;
    const btn = $("#p-save");
    btn.disabled = true;
    try {
      let image = $("#p-image").value;
      const file = $("#p-file").files[0];
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        image = (await api("/api/admin/upload", { method: "POST", body: fd })).url;
      }
      const body = {
        name: $("#p-name").value, category: $("#p-cat").value, price: $("#p-price").value,
        stock: $("#p-stock").value, description: $("#p-desc").value, image, active: $("#p-active").checked,
      };
      const id = $("#p-id").value;
      await api(id ? `/api/admin/products/${id}` : "/api/admin/products", { method: id ? "PUT" : "POST", body });
      toast(id ? "Produto atualizado" : "Produto adicionado");
      resetForm();
      await loadProducts();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
    } finally { btn.disabled = false; }
  });

  $("#products-list").addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-edit]");
    const del = e.target.closest("[data-del]");
    if (ed) {
      const p = products.find((x) => x.id === Number(ed.dataset.edit));
      if (!p) return;
      $("#p-id").value = p.id; $("#p-image").value = p.image;
      $("#p-name").value = p.name; $("#p-cat").value = p.category;
      $("#p-price").value = (p.price_cents / 100).toFixed(2).replace(".", ",");
      $("#p-stock").value = p.stock; $("#p-desc").value = p.description;
      $("#p-active").checked = p.active; $("#p-file").value = "";
      const pv = $("#p-preview");
      pv.hidden = !p.image; if (p.image) pv.src = p.image;
      $("#form-title").textContent = "Editar produto";
      $("#p-reset").hidden = false;
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (del) {
      const p = products.find((x) => x.id === Number(del.dataset.del));
      if (p && confirm(`Excluir "${p.name}"?`)) {
        try { await api(`/api/admin/products/${p.id}`, { method: "DELETE" }); toast("Produto excluído"); loadProducts(); }
        catch (ex) { toast(ex.message); }
      }
    }
  });

  /* ---------- loja ---------- */
  let storeOpen = true;
  function paintStore() {
    $("#store-state").textContent = storeOpen ? "A loja está ABERTA: clientes podem fazer pedidos." : "A loja está FECHADA: pedidos bloqueados.";
    $("#store-toggle").textContent = storeOpen ? "Fechar loja" : "Abrir loja";
  }
  async function loadStore() {
    try { storeOpen = (await api("/api/admin/store")).open; paintStore(); } catch { /* */ }
  }
  $("#store-toggle").onclick = async () => {
    try { storeOpen = (await api("/api/admin/store", { method: "POST", body: { open: !storeOpen } })).open; paintStore(); }
    catch (ex) { toast(ex.message); }
  };

  /* ---------- início ---------- */
  loadOrders();
  setInterval(() => { if (tab === "orders" && !document.hidden) loadOrders(); }, 5000);
})();
