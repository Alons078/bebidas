(() => {
  const code = document.body.dataset.code;
  const card = document.querySelector("#track-card");
  const fmt = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  const STEPS = [
    ["recebido", "Pedido recebido"],
    ["preparando", "Em preparo"],
    ["pronto", "Pronto para retirar"],
    ["retirado", "Retirado"],
  ];

  let last = "";

  function render(o) {
    const idx = STEPS.findIndex((s) => s[0] === o.status);
    let steps = "";
    if (o.status !== "cancelado") {
      steps = '<div class="steps">' + STEPS.map(([key, label], i) => {
        const cls = i < idx ? "done" : i === idx ? "current" : "";
        const dot = i < idx ? "✓" : "";
        return `<div class="step ${cls}"><span class="dot">${dot}</span>${label}</div>`;
      }).join("") + "</div>";
    }
    let callout = "";
    if (o.status === "pronto") callout = '<div class="callout ready"><b>Seu pedido está pronto!</b> Pode retirar no balcão.</div>';
    else if (o.status === "cancelado") callout = '<div class="callout cancel"><b>Pedido cancelado.</b> Se foi um engano, faça um novo pedido ou fale com a loja.</div>';
    else if (o.status === "retirado") callout = '<div class="callout ready">Pedido retirado. Obrigado pela preferência!</div>';
    else callout = '<div class="callout">Retire no balcão quando o status mudar para <b>pronto</b>. Esta página atualiza sozinha.</div>';

    const items = o.items.map((it) =>
      `<li><span>${it.qty}× ${esc(it.name)}</span><span>${fmt(it.price_cents * it.qty)}</span></li>`).join("");

    card.innerHTML = `
      <div><span class="muted small">Pedido</span><h2 style="font-size:1.4rem">#${esc(o.code)}</h2>
      <span class="muted small">${esc(o.customer_name)} · ${esc(o.payment_label)}</span></div>
      ${callout}
      ${steps}
      <ul class="items-list">${items}</ul>
      <div class="total-row"><span>Total</span><b>${fmt(o.total_cents)}</b></div>
      ${o.notes ? `<p class="muted small">Obs.: ${esc(o.notes)}</p>` : ""}`;
  }

  async function load() {
    try {
      const res = await fetch("/api/order/" + encodeURIComponent(code));
      if (res.status === 404) {
        card.innerHTML = '<p>Pedido não encontrado.</p>';
        return false;
      }
      const o = await res.json();
      const sig = JSON.stringify(o);
      if (sig !== last) { last = sig; render(o); }
      return o.status !== "retirado" && o.status !== "cancelado";
    } catch { return true; }
  }

  (async function loop() {
    const keep = await load();
    if (keep) setTimeout(loop, 5000);
  })();
})();
