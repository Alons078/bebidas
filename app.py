"""Depósito Mix - prototipo de tienda de bebidas (retiro en local, sin entregador).

Variables de entorno:
  ADMIN_PASSWORD  contraseña del panel /admin (por defecto: admin123 -> cámbiala)
  SECRET_KEY      clave de sesión (si no existe se genera y se guarda en DATA_DIR)
  DATA_DIR        carpeta de datos (base SQLite + fotos). En Render: /var/data
  PORT            puerto (por defecto 5000)
"""
import json
import os
import re
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from datetime import datetime
from decimal import Decimal, InvalidOperation
from functools import wraps
from zoneinfo import ZoneInfo

from flask import (Flask, g, jsonify, redirect, render_template, request,
                   send_from_directory, session, url_for)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE_DIR, "data"))
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
DB_PATH = os.path.join(DATA_DIR, "deposito.db")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# El servidor (Render) corre en UTC: todo horario se calcula en hora de Brasil.
TZ = ZoneInfo("America/Sao_Paulo")

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
STATUSES = ["recebido", "preparando", "pronto", "retirado", "cancelado"]
ACTIVE_STATUSES = ("recebido", "preparando", "pronto")
NEXT_STATUS = {"recebido": "preparando", "preparando": "pronto", "pronto": "retirado"}
PAYMENTS = {"pix": "Pix", "dinheiro": "Dinheiro", "cartao": "Cartão na retirada"}
ALLOWED_EXT = {"png", "jpg", "jpeg", "webp", "gif"}


def load_secret():
    env = os.environ.get("SECRET_KEY")
    if env:
        return env
    path = os.path.join(DATA_DIR, "secret.key")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        return f.read().strip()


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024
app.config["PERMANENT_SESSION_LIFETIME"] = 60 * 60 * 24 * 14
app.secret_key = load_secret()

# ----------------------------------------------------------------- base de datos

SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  image TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  payment TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'recebido',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

# (nombre, categoría, descripción, precio en R$, stock) - precios de ejemplo
SEED = [
    ("Heineken Long Neck 330ml", "Cervejas", "Lager premium, garrafinha gelada.", 7.50, 120),
    ("Stella Artois 275ml", "Cervejas", "Long neck, leve e refrescante.", 6.90, 96),
    ("Corona Extra 330ml", "Cervejas", "Ótima com uma fatia de limão.", 8.50, 72),
    ("Budweiser Lata 350ml", "Cervejas", "Clássica, sempre gelada.", 5.50, 144),
    ("Brahma Duplo Malte Lata 350ml", "Cervejas", "Cerveja de puro malte.", 4.50, 200),
    ("Skol Lata 350ml", "Cervejas", "A que desce redondo.", 4.20, 240),
    ("Johnnie Walker Red Label 1L", "Whisky", "Blended escocês, ideal para drinks.", 119.90, 18),
    ("Jack Daniel's Old No.7 1L", "Whisky", "Tennessee whiskey suave e encorpado.", 159.90, 12),
    ("Chivas Regal 12 anos 1L", "Whisky", "Escocês envelhecido 12 anos.", 189.90, 8),
    ("Ballantine's Finest 1L", "Whisky", "Blended escocês de sabor equilibrado.", 99.90, 15),
    ("Smirnoff Vodka 998ml", "Vodka e Gin", "Vodka tripla destilação.", 39.90, 30),
    ("Absolut Vodka 1L", "Vodka e Gin", "Vodka sueca premium.", 89.90, 14),
    ("Tanqueray London Dry Gin 750ml", "Vodka e Gin", "Gin clássico, notas de zimbro.", 119.90, 10),
    ("Vinho Tinto Seco 750ml", "Vinhos", "Tinto seco para o dia a dia.", 49.90, 24),
    ("Espumante Brut 750ml", "Vinhos", "Para brindar.", 69.90, 12),
    ("Coca-Cola 2L", "Outros", "Para o seu mix.", 11.00, 60),
    ("Água Tônica 350ml", "Outros", "Perfeita com gin.", 4.00, 80),
    ("Gelo em cubos 5kg", "Outros", "Saco de gelo filtrado.", 12.00, 40),
]


def db_connect():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.isolation_level = None  # autocommit; transacciones explícitas donde importan
    return conn


def init_db():
    conn = db_connect()
    conn.executescript(SCHEMA)
    if conn.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
        for name, cat, desc, price, stock in SEED:
            conn.execute(
                "INSERT INTO products (name, category, description, price_cents, stock) "
                "VALUES (?,?,?,?,?)",
                (name, cat, desc, int(round(price * 100)), stock),
            )
    conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('store_open', '1')")
    conn.close()


def get_db():
    if "db" not in g:
        g.db = db_connect()
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


init_db()

# ------------------------------------------------------------------ utilidades

_hits = defaultdict(deque)


def _recent(key, window):
    q = _hits[key]
    now = time.time()
    while q and now - q[0] > window:
        q.popleft()
    return q


def too_many(key, limit, window):
    return len(_recent(key, window)) >= limit


def record(key, window=3600):
    _recent(key, window).append(time.time())


def client_ip():
    fwd = request.headers.get("X-Forwarded-For", "")
    return (fwd.split(",")[0].strip() or request.remote_addr or "?")


def store_is_open():
    row = get_db().execute("SELECT value FROM settings WHERE key='store_open'").fetchone()
    return bool(row) and row["value"] == "1"


def now_iso():
    return datetime.now(TZ).isoformat(timespec="seconds")


def parse_price(value):
    s = str(value).strip().replace("R$", "").replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        cents = int((Decimal(s) * 100).to_integral_value())
    except (InvalidOperation, ValueError):
        raise ValueError("Preço inválido.")
    if cents < 0 or cents > 10_000_000:
        raise ValueError("Preço fora do intervalo.")
    return cents


def product_dict(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "category": row["category"],
        "description": row["description"],
        "price_cents": row["price_cents"],
        "stock": row["stock"],
        "image": row["image"],
        "active": bool(row["active"]),
    }


def order_dict(row, admin=False):
    d = {
        "code": row["code"],
        "status": row["status"],
        "customer_name": row["customer_name"],
        "payment": row["payment"],
        "payment_label": PAYMENTS.get(row["payment"], row["payment"]),
        "notes": row["notes"],
        "items": json.loads(row["items_json"]),
        "total_cents": row["total_cents"],
        "created_at": row["created_at"],
    }
    if admin:
        d["id"] = row["id"]
        d["customer_phone"] = row["customer_phone"]
    return d


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("admin"):
            return jsonify(error="Não autorizado."), 401
        return fn(*args, **kwargs)
    return wrapper


@app.errorhandler(413)
def too_large(_e):
    return jsonify(error="Arquivo muito grande (máx. 5 MB)."), 413


# ------------------------------------------------------------- páginas públicas

@app.get("/")
def index():
    return render_template("index.html")


@app.get("/pedido/<code>")
def pedido(code):
    return render_template("pedido.html", code=code)


@app.get("/uploads/<path:filename>")
def uploads(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.get("/healthz")
def healthz():
    return "ok"


# ------------------------------------------------------------------ API pública

@app.get("/api/store")
def api_store():
    return jsonify(open=store_is_open())


@app.get("/api/products")
def api_products():
    rows = get_db().execute(
        "SELECT * FROM products WHERE active=1 ORDER BY category, name"
    ).fetchall()
    return jsonify(products=[product_dict(r) for r in rows])


class OrderError(Exception):
    pass


@app.post("/api/order")
def api_create_order():
    ip = client_ip()
    if too_many("order:" + ip, 15, 60):
        return jsonify(error="Muitas tentativas. Aguarde um minuto."), 429
    record("order:" + ip, 60)

    if not store_is_open():
        return jsonify(error="A loja está fechada no momento."), 403

    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()[:80]
    phone = re.sub(r"\D", "", str(data.get("phone", "")))
    payment = data.get("payment")
    notes = str(data.get("notes", "")).strip()[:300]
    raw_items = data.get("items")

    if len(name) < 2:
        return jsonify(error="Informe seu nome."), 400
    if not 10 <= len(phone) <= 13:
        return jsonify(error="Informe um telefone válido com DDD."), 400
    if payment not in PAYMENTS:
        return jsonify(error="Escolha a forma de pagamento."), 400
    if not isinstance(raw_items, list) or not raw_items:
        return jsonify(error="Seu carrinho está vazio."), 400

    wanted = {}
    try:
        for it in raw_items:
            pid, qty = int(it["id"]), int(it["qty"])
            if qty < 1 or qty > 99:
                raise ValueError
            wanted[pid] = wanted.get(pid, 0) + qty
    except (KeyError, TypeError, ValueError):
        return jsonify(error="Itens inválidos."), 400
    if len(wanted) > 60:
        return jsonify(error="Itens demais no pedido."), 400

    db = get_db()
    try:
        db.execute("BEGIN IMMEDIATE")
        items, total = [], 0
        for pid, qty in wanted.items():
            row = db.execute("SELECT * FROM products WHERE id=? AND active=1", (pid,)).fetchone()
            if row is None:
                raise OrderError("Um dos produtos não está mais disponível.")
            if row["stock"] < qty:
                raise OrderError(f"Estoque insuficiente de {row['name']} (restam {row['stock']}).")
            db.execute("UPDATE products SET stock = stock - ? WHERE id=?", (qty, pid))
            line = row["price_cents"] * qty
            total += line
            items.append({"id": pid, "name": row["name"], "qty": qty,
                          "price_cents": row["price_cents"]})
        code = secrets.token_urlsafe(6)
        db.execute(
            "INSERT INTO orders (code, customer_name, customer_phone, payment, notes, "
            "items_json, total_cents, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (code, name, phone, payment, notes, json.dumps(items, ensure_ascii=False),
             total, "recebido", now_iso()),
        )
        db.execute("COMMIT")
    except OrderError as e:
        db.execute("ROLLBACK")
        return jsonify(error=str(e)), 400
    except Exception:
        db.execute("ROLLBACK")
        raise
    return jsonify(code=code, total_cents=total), 201


@app.get("/api/order/<code>")
def api_get_order(code):
    row = get_db().execute("SELECT * FROM orders WHERE code=?", (code,)).fetchone()
    if row is None:
        return jsonify(error="Pedido não encontrado."), 404
    return jsonify(order_dict(row))


# ---------------------------------------------------------------- panel admin

@app.get("/admin")
def admin():
    return render_template("admin.html", logged=bool(session.get("admin")),
                           error=request.args.get("error", ""))


@app.post("/admin/login")
def admin_login():
    key = "login:" + client_ip()
    if too_many(key, 5, 300):
        return redirect(url_for("admin", error="Muitas tentativas. Aguarde alguns minutos."))
    pw = request.form.get("password", "")
    if secrets.compare_digest(pw.encode(), ADMIN_PASSWORD.encode()):
        session["admin"] = True
        session.permanent = True
        return redirect(url_for("admin"))
    record(key, 300)
    return redirect(url_for("admin", error="Senha incorreta."))


@app.post("/admin/logout")
def admin_logout():
    session.clear()
    return redirect(url_for("admin"))


def product_from_json(data):
    name = str(data.get("name", "")).strip()
    category = str(data.get("category", "")).strip()
    if not name or len(name) > 100:
        raise ValueError("Informe o nome do produto (até 100 caracteres).")
    if not category or len(category) > 40:
        raise ValueError("Informe a categoria (até 40 caracteres).")
    price = parse_price(data.get("price", ""))
    try:
        stock = int(data.get("stock", 0))
    except (TypeError, ValueError):
        raise ValueError("Estoque inválido.")
    if stock < 0 or stock > 100000:
        raise ValueError("Estoque fora do intervalo.")
    image = str(data.get("image", "")).strip()[:300]
    if image and not (image.startswith("/uploads/") or image.startswith("https://")):
        raise ValueError("Imagem inválida.")
    return (name, category, str(data.get("description", "")).strip()[:300],
            price, stock, image, 1 if data.get("active", True) else 0)


@app.get("/api/admin/products")
@admin_required
def admin_products():
    # los nuevos aparecen arriba
    rows = get_db().execute("SELECT * FROM products ORDER BY id DESC").fetchall()
    return jsonify(products=[product_dict(r) for r in rows])


@app.post("/api/admin/products")
@admin_required
def admin_product_create():
    try:
        vals = product_from_json(request.get_json(silent=True) or {})
    except ValueError as e:
        return jsonify(error=str(e)), 400
    cur = get_db().execute(
        "INSERT INTO products (name, category, description, price_cents, stock, image, active) "
        "VALUES (?,?,?,?,?,?,?)", vals)
    return jsonify(id=cur.lastrowid), 201


@app.put("/api/admin/products/<int:pid>")
@admin_required
def admin_product_update(pid):
    try:
        vals = product_from_json(request.get_json(silent=True) or {})
    except ValueError as e:
        return jsonify(error=str(e)), 400
    cur = get_db().execute(
        "UPDATE products SET name=?, category=?, description=?, price_cents=?, stock=?, "
        "image=?, active=? WHERE id=?", vals + (pid,))
    if cur.rowcount == 0:
        return jsonify(error="Produto não encontrado."), 404
    return jsonify(ok=True)


@app.delete("/api/admin/products/<int:pid>")
@admin_required
def admin_product_delete(pid):
    get_db().execute("DELETE FROM products WHERE id=?", (pid,))
    return jsonify(ok=True)


@app.post("/api/admin/upload")
@admin_required
def admin_upload():
    f = request.files.get("file")
    if f is None or not f.filename:
        return jsonify(error="Nenhum arquivo enviado."), 400
    ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
    if ext not in ALLOWED_EXT:
        return jsonify(error="Formato não permitido (use png, jpg, webp ou gif)."), 400
    fname = secrets.token_hex(8) + "." + ext
    f.save(os.path.join(UPLOAD_DIR, fname))
    return jsonify(url="/uploads/" + fname)


@app.get("/api/admin/orders")
@admin_required
def admin_orders():
    db = get_db()
    scope = request.args.get("scope", "active")
    if scope == "active":
        marks = ",".join("?" * len(ACTIVE_STATUSES))
        rows = db.execute(
            f"SELECT * FROM orders WHERE status IN ({marks}) ORDER BY id ASC", ACTIVE_STATUSES
        ).fetchall()
        return jsonify(orders=[order_dict(r, admin=True) for r in rows])
    rows = db.execute(
        "SELECT * FROM orders WHERE status IN ('retirado','cancelado') "
        "ORDER BY id DESC LIMIT 100").fetchall()
    today = datetime.now(TZ).strftime("%Y-%m-%d")
    s = db.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS total FROM orders "
        "WHERE status='retirado' AND substr(created_at,1,10)=?", (today,)).fetchone()
    return jsonify(orders=[order_dict(r, admin=True) for r in rows],
                   today={"count": s["n"], "total_cents": s["total"]})


@app.post("/api/admin/orders/<code>/status")
@admin_required
def admin_order_status(code):
    new = (request.get_json(silent=True) or {}).get("status")
    if new not in STATUSES:
        return jsonify(error="Status inválido."), 400
    db = get_db()
    try:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM orders WHERE code=?", (code,)).fetchone()
        if row is None:
            db.execute("ROLLBACK")
            return jsonify(error="Pedido não encontrado."), 404
        cur = row["status"]
        allowed = NEXT_STATUS.get(cur) == new or (new == "cancelado" and cur in ACTIVE_STATUSES)
        if not allowed:
            db.execute("ROLLBACK")
            return jsonify(error=f"Não é possível passar de '{cur}' para '{new}'."), 400
        if new == "cancelado":  # devolver el stock
            for it in json.loads(row["items_json"]):
                db.execute("UPDATE products SET stock = stock + ? WHERE id=?", (it["qty"], it["id"]))
        db.execute("UPDATE orders SET status=? WHERE code=?", (new, code))
        db.execute("COMMIT")
    except Exception:
        db.execute("ROLLBACK")
        raise
    return jsonify(ok=True)


@app.route("/api/admin/store", methods=["GET", "POST"])
@admin_required
def admin_store():
    db = get_db()
    if request.method == "POST":
        is_open = "1" if (request.get_json(silent=True) or {}).get("open") else "0"
        db.execute("UPDATE settings SET value=? WHERE key='store_open'", (is_open,))
    return jsonify(open=store_is_open())


if __name__ == "__main__":
    if ADMIN_PASSWORD == "admin123":
        print("AVISO: usando la contraseña de admin por defecto (admin123). "
              "Define ADMIN_PASSWORD antes de publicar.")
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
