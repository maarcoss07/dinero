# Mis Finanzas (PWA + Firebase)

## 1. Firebase (gratis, plan Spark)
1. https://console.firebase.google.com → **Añadir proyecto**.
2. **Compilación > Authentication > Comenzar > Correo/contraseña** (activar). Pestaña **Users > Añadir usuario**: crea tu correo y contraseña.
   En **Configuración > Acciones del usuario** desactiva "Habilitar creación de usuarios" para que nadie más pueda registrarse.
3. **Compilación > Firestore Database > Crear base de datos** (modo producción). Pestaña **Reglas**: pega el contenido de `firestore.rules` y **Publicar**.
4. **Configuración del proyecto > Tus apps > </> Web**: registra la app y copia el objeto `firebaseConfig` en `firebase-config.js`. Cambia también `OWNER_NAME` y `BIZUM_PHONE`.
5. **Authentication > Configuración > Dominios autorizados**: añade tu dominio de Vercel/GitHub Pages cuando lo tengas.

## 2. Despliegue sin descargar nada (GitHub Pages)
1. Crea un repositorio en github.com y sube todos los archivos de esta carpeta (**Add file > Upload files**), con `index.html` en la raíz.
2. **Settings > Pages > Branch: main / root > Save**. Tu web quedará en `https://USUARIO.github.io/REPO/`.
   (Vercel/Netlify: importa el repo, sin build command, directorio raíz.)

## 3. Instalarla en el móvil
- Android (Chrome): menú ⋮ > **Instalar aplicación**.
- iPhone (Safari): Compartir > **Añadir a pantalla de inicio**.

## Notas
- Al dividir un gasto, tu balance cuenta solo **tu parte**; el total queda anotado como "de X €".
- Enlace de amigo: `?shared=ID&p=N` (N = su posición). Sin `p`, el amigo elige quién es.
- Si cambias archivos, sube la versión de `CACHE` en `service-worker.js` para forzar actualización.
