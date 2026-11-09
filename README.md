# EcoTrip Frontend

For local development, start the PHP API from the backend directory in one terminal:

```powershell
cd ..\backend
php -S 127.0.0.1:8080 -t public local-router.php
```

In another terminal, start the frontend from `frontend`:

```powershell
npm run dev
```

In development, Vite proxies `/api/v1` and `/uploads` to the backend at `http://127.0.0.1:8080`. The browser can use either `localhost:5173` or `127.0.0.1:5173` without a separate CORS configuration. Vite is configured to fail if port 5173 is occupied instead of silently starting on a different port; stop the other server before retrying. If your backend runs elsewhere, update the proxy target in `vite.config.js` or set `VITE_API_URL` to the backend URL, with or without the `/api/v1` suffix.

Render Static Site settings:

- Root directory: `frontend`
- Build command: `npm ci && npm run build`
- Publish directory: `dist`

Set `VITE_API_URL` in the deployment environment to the deployed backend URL. The frontend adds `/api/v1` when it is omitted. For example, `https://ecotrip-web-backend.onrender.com` and `https://ecotrip-web-backend.onrender.com/api/v1` are both accepted. The Vite development proxy is not used in production.