# Depósito Mix (prototipo)

Tienda web de bebidas (cervezas, whisky, vodka y gin, vinos…) con carrito, pedidos
**con retiro en el local** (sin entregador) y panel de administración. Hecha con Flask + SQLite.

## Ejecutar en local

```bash
pip install -r requirements.txt
ADMIN_PASSWORD=mi-clave python app.py
```

- Tienda: http://localhost:5000
- Panel admin: http://localhost:5000/admin  (contraseña por defecto `admin123`, cámbiala con `ADMIN_PASSWORD`)

## Qué incluye

**Cliente**
- Verificación de mayoría de edad (18+) al entrar
- Catálogo por categorías con buscador y stock en vivo
- Carrito, y pedido pidiendo nombre, teléfono y forma de pago en el local (Pix, efectivo, tarjeta)
- Página de seguimiento del pedido que se actualiza sola: recibido → en preparación → listo para retirar → retirado

**Admin (`/admin`)**
- Pedidos en curso (el más viejo arriba), con detalle desplegable, botón de próxima etapa, cancelar (devuelve el stock) y sonido al llegar un pedido nuevo
- Historial y total retirado hoy
- Productos: agregar, editar, ocultar, borrar, con foto (los nuevos aparecen arriba)
- Abrir/cerrar la tienda

## Variables de entorno

| Variable | Para qué |
|---|---|
| `ADMIN_PASSWORD` | Contraseña del panel |
| `SECRET_KEY` | Clave de sesión (si falta se genera y se guarda en `DATA_DIR`) |
| `DATA_DIR` | Dónde se guardan la base y las fotos. En Render: el disco persistente (`/var/data`) |
| `PORT` | Puerto |

## Publicar en Render

- Build: `pip install -r requirements.txt`
- Start: `gunicorn app:app --workers 1 --threads 4 --bind 0.0.0.0:$PORT`
- Agrega un disco persistente montado en `/var/data` y define `DATA_DIR=/var/data`
  (así la base y las fotos no se borran en cada deploy).
- Define `ADMIN_PASSWORD` en las variables de entorno.

## Notas del prototipo

- Los productos y precios iniciales son de ejemplo; se editan desde el panel.
- Los precios se guardan en centavos y el servidor recalcula el total (no confía en el navegador).
- Los horarios usan la zona `America/Sao_Paulo`.
