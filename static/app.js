(() => {
  const $ = (s) => document.querySelector(s);
  const fmt = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  const CAT_ORDER = ["cervejas", "whisky", "vodka e gin", "vinhos", "outros"];
  const emojiFor = (cat) => {
    const c = cat.toLowerCase();
    if (c.includes("cerveja")) return "🍺";
    if (c.includes("whisk")) return "🥃";
    if (c.includes("vodka") || c.includes("gin")) return "🍸";
    if (c.includes("vinho") || c.includes("espumante")) return "🍷";
    return "🧊";
  };

  let products = [];
  let cart = {};
  try { cart = JSON.parse(store.get("dm_cart", "{}")) || {}; } catch { cart = {}; }
  let activeCat = "Todos";
  let query = "";
  let storeOpen = true;

  const saveCart = () => store.set("dm_cart", JSON.stringify(cart));
  const byId = (id) => products.find((p) => p.id === id);
  const cartCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
  const cartTotal = () => Object.entries(cart).reduce((sum, [id, q]) => {
    const p = byId(Number(id));
    return sum + (p ? p.price_cents * q : 0);
  }, 0);

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  }

  /* ---------- maioridade ---------- */
  function initAgeGate() {
    const gate = $("#age-gate");
    if (store.get("dm_age_ok") === "1") return;
    gate.hidden = false;
    $("#age-yes").onclick = () => { store.set("dm_age_ok", "1"); gate.hidden = true; };
    $("#age-no").onclick = () => {
      document.body.innerHTML =
        '<div style="min-height:100vh;display:grid;place-items:center;text-align:center;padding:24px;color:#f3ece1;font-family:sans-serif">' +
        "<div><h2>Acesso restrito</h2><p>Este site é destinado apenas a maiores de 18 anos.</p></div></div>";
    };
  }

  /* ---------- catálogo ---------- */
  function categories() {
    const set = [...new Set(products.map((p) => p.category))];
    set.sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a.toLowerCase());
      const ib = CAT_ORDER.indexOf(b.toLowerCase());
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    return ["Todos", ...set];
  }

  function renderTabs() {
    const cats = categories();
    if (!cats.includes(activeCat)) activeCat = "Todos";
    $("#tabs").innerHTML = cats
      .map((c) => `<button data-cat="${esc(c)}" class="${c === activeCat ? "active" : ""}">${esc(c)}</button>`)
      .join("");
  }

  function renderGrid() {
    const q = query.trim().toLowerCase();
    const list = products.filter((p) =>
      (activeCat === "Todos" || p.category === activeCat) &&
      (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)));
    if (!list.length) {
      $("#grid").innerHTML = '<p class="empty">Nenhum produto encontrado.</p>';
      return;
    }
    $("#grid").innerHTML = list.map((p) => {
      const qty = cart[p.id] || 0;
      const sold = p.stock <= 0;
      const style = p.image ? ` style="background-image:url('${esc(p.image)}')"` : "";
      const actions = sold
        ? '<button class="btn small block" disabled>Esgotado</button>'
        : qty
          ? `<div class="qty"><button data-act="dec" data-id="${p.id}" aria-label="Menos">−</button><b>${qty}</b><button data-act="inc" data-id="${p.id}" aria-label="Mais">+</button></div>`
          : `<button class="btn primary small block" data-act="add" data-id="${p.id}">Adicionar</button>`;
      return `<article class="card ${sold ? "soldout" : ""}">
        <div class="thumb"${style}>${p.image ? "" : emojiFor(p.category)}</div>
        <div class="card-body">
          <h4>${esc(p.name)}</h4>
          ${p.description ? `<p>${esc(p.description)}</p>` : ""}
          <div class="price">${fmt(p.price_cents)}</div>
          <div class="card-actions">${actions}</div>
        </div>
      </article>`;
    }).join("");
  }

  function changeQty(id, delta) {
    const p = byId(id);
    if (!p) return;
    const next = Math.max(0, Math.min(p.stock, (cart[id] || 0) + delta));
    if (delta > 0 && next === (cart[id] || 0)) toast("Estoque máximo atingido");
    if (next === 0) delete cart[id]; else cart[id] = next;
    saveCart();
    renderGrid();
    renderCart();
  }

  /* ---------- carrinho ---------- */
  function renderCart() {
    const count = cartCount();
    const total = cartTotal();
    $("#cart-btn").hidden = count === 0 || $("#drawer").classList.contains("open");
    $("#cart-count").textContent = count;
    $("#cart-total").textContent = fmt(total);
    $("#drawer-total").textContent = fmt(total);
    $("#co-total").textContent = fmt(total);
    const lines = Object.entries(cart).map(([id, q]) => {
      const p = byId(Number(id));
      if (!p) return "";
      return `<div class="line">
        <div><div class="name">${esc(p.name)}</div><div class="sub">${fmt(p.price_cents)} cada</div></div>
        <b>${fmt(p.price_cents * q)}</b>
        <div class="qty"><button data-act="dec" data-id="${p.id}">−</button><b>${q}</b><button data-act="inc" data-id="${p.id}">+</button></div>
      </div>`;
    }).join("");
    $("#cart-lines").innerHTML = lines || '<p class="muted" style="text-align:center;padding:30px 0">Seu carrinho está vazio.</p>';
    $("#go-checkout").disabled = count === 0;
  }

  function openDrawer(open) {
    $("#drawer").classList.toggle("open", open);
    $("#drawer").setAttribute("aria-hidden", String(!open));
    $("#drawer-bg").hidden = !open;
    renderCart();
  }

  function openCheckout(open) {
    $("#checkout").hidden = !open;
    if (open) {
      $("#co-name").value = store.get("dm_name", "");
      $("#co-phone").value = store.get("dm_phone", "");
      $("#co-error").hidden = true;
      $("#co-name").focus();
    }
  }

  async function submitOrder(ev) {
    ev.preventDefault();
    const err = $("#co-error");
    err.hidden = true;
    const body = {
      name: $("#co-name").value,
      phone: $("#co-phone").value,
      payment: $("#co-pay").value,
      notes: $("#co-notes").value,
      items: Object.entries(cart).map(([id, qty]) => ({ id: Number(id), qty })),
    };
    const btn = $("#co-submit");
    btn.disabled = true;
    try {
      const res = await fetch("/api/order", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Não foi possível enviar o pedido.");
      store.set("dm_name", body.name.trim());
      store.set("dm_phone", body.phone.trim());
      cart = {};
      saveCart();
      window.location.href = "/pedido/" + encodeURIComponent(data.code);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      btn.disabled = false;
      loadProducts(); // el stock pudo cambiar
    }
  }

  /* ---------- dados ---------- */
  async function loadStore() {
    try {
      const { open } = await (await fetch("/api/store")).json();
      storeOpen = open;
    } catch { /* mantém o último estado */ }
    const b = $("#store-badge");
    b.textContent = storeOpen ? "● Aberto" : "● Fechado";
    b.className = "badge " + (storeOpen ? "open" : "closed");
    const go = $("#go-checkout");
    go.textContent = storeOpen ? "Continuar" : "Loja fechada";
    go.disabled = !storeOpen || cartCount() === 0;
  }

  async function loadProducts() {
    try {
      const data = await (await fetch("/api/products")).json();
      products = data.products;
    } catch { return; }
    // limpar carrinho de itens que sumiram ou passaram do estoque
    for (const id of Object.keys(cart)) {
      const p = byId(Number(id));
      if (!p || p.stock <= 0) delete cart[id];
      else if (cart[id] > p.stock) cart[id] = p.stock;
    }
    saveCart();
    renderTabs();
    renderGrid();
    renderCart();
  }

  /* ---------- eventos ---------- */
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-act]");
    if (el) {
      const id = Number(el.dataset.id);
      changeQty(id, el.dataset.act === "dec" ? -1 : 1);
      return;
    }
    const tab = ev.target.closest("#tabs button");
    if (tab) { activeCat = tab.dataset.cat; renderTabs(); renderGrid(); }
  });
  $("#search").addEventListener("input", (e) => { query = e.target.value; renderGrid(); });
  $("#cart-btn").onclick = () => openDrawer(true);
  $("#drawer-close").onclick = () => openDrawer(false);
  $("#drawer-bg").onclick = () => openDrawer(false);
  $("#go-checkout").onclick = () => { openDrawer(false); openCheckout(true); };
  $("#co-cancel").onclick = () => { openCheckout(false); openDrawer(true); };
  $("#checkout-form").addEventListener("submit", submitOrder);

  initAgeGate();
  loadStore();
  loadProducts();
  setInterval(() => {
    if ($("#checkout").hidden) { loadProducts(); loadStore(); }
  }, 30000);
})();
