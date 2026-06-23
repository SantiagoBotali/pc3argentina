# Guía de despliegue en producción

## Servicios necesarios (todos gratuitos)

| Servicio | Para qué | URL |
|----------|----------|-----|
| **GitHub** | Código fuente | github.com/SantiagoBotali/pc3argentina ✅ |
| **Neon** | Base de datos PostgreSQL | neon.tech |
| **Cloudinary** | Almacenamiento de imágenes | cloudinary.com |
| **Railway** | Servidor Node.js | railway.app |

---

## Paso 1: Neon (base de datos)

1. Entrá a [neon.tech](https://neon.tech) y creá una cuenta gratuita
2. Creá un nuevo proyecto (dale el nombre que quieras, ej: `pc3argentina`)
3. En el dashboard, copiá el **Connection String** que empieza con `postgresql://...`
4. Guardalo — lo necesitás en el Paso 3

---

## Paso 2: Cloudinary (imágenes)

1. Entrá a [cloudinary.com](https://cloudinary.com) y creá una cuenta gratuita
2. En el Dashboard copiá estos 3 valores:
   - **Cloud name**
   - **API Key**
   - **API Secret**
3. Guardalos — los necesitás en el Paso 3

---

## Paso 3: Railway (servidor)

1. Entrá a [railway.app](https://railway.app) y creá una cuenta (puede ser con GitHub)
2. Hacé clic en **New Project** → **Deploy from GitHub repo**
3. Autorizá Railway para acceder a tus repos y seleccioná `pc3argentina`
4. Railway va a detectar el proyecto automáticamente

### Configurar variables de entorno en Railway

En tu proyecto Railway, andá a **Variables** y agregá:

```
DATABASE_URL        = (tu connection string de Neon)
CLOUDINARY_CLOUD_NAME = (tu cloud name de Cloudinary)
CLOUDINARY_API_KEY  = (tu API key de Cloudinary)
CLOUDINARY_API_SECRET = (tu API secret de Cloudinary)
SESSION_SECRET      = (inventá una cadena larga aleatoria, ej: pc3arg_2024_secreto_largo_xyz)
NODE_ENV            = production
```

5. Railway va a hacer el deploy automáticamente
6. Una vez deployado, copiá la URL del proyecto (ej: `https://pc3argentina.up.railway.app`)

---

## Paso 4: Cargar datos iniciales

Una vez que Railway esté corriendo, tenés que poblar la base de datos:

1. En Railway, andá a tu servicio → **Settings** → **Deploy** → **Start Command**
2. Temporalmente cambialo a `node seed.js`
3. Hacé un re-deploy manualmente
4. Después de que corra, volvé a cambiarlo a `node server.js`

**O más fácil**: en Railway, abrí la consola del servicio y corré:
```bash
node seed.js
```

---

## Paso 5: Acceder al panel admin

- URL: `https://tu-proyecto.up.railway.app/admin`
- Usuario: `pc3argentina`
- Contraseña: `pablocomini123`

⚠️ **Cambiar la contraseña inmediatamente** desde el panel admin → "Cambiar contraseña"

---

## Deploy automático

Cada vez que hagás `git push origin main`, Railway va a re-deployar la app automáticamente.
