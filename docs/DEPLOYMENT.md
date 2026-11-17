# Deployment (optional)

Order: database (already on Supabase) -> API on Render -> client on Vercel -> set CORS.

## API on Render

New -> Web Service -> the GitHub repository.

| Field | Value |
| --- | --- |
| Root Directory | `server` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance | Free |
| `DATABASE_URL` | the Supabase **Session pooler** string |
| `CLIENT_URL` | `http://localhost:5173` for now |

Open `<render-url>/` to see `{"status":"ok"}` and `<render-url>/reports` for JSON. The free tier sleeps when idle, so the first request can take up to a minute; the app retries on its own.

## Client on Vercel

Add New -> Project -> the same repository.

| Field | Value |
| --- | --- |
| Root Directory | `client` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| `VITE_API_URL` | the Render URL, **no trailing slash** |

## CORS

In Render, set `CLIENT_URL` to the exact Vercel URL (no trailing slash; several origins can be separated by commas, for example `https://your-app.vercel.app,http://localhost:5173`), save, and wait for the redeploy.

## Check

Open the Vercel URL on a phone, create a report, go offline, create another, reconnect. Then add the link to the README and to your submission.

| Symptom | Fix |
| --- | --- |
| Reports stay Pending on the live site | `VITE_API_URL` wrong or missing: fix it in Vercel and redeploy (it is read at build time) |
| CORS error in the browser console | `CLIENT_URL` must match the Vercel URL exactly |
| API returns 500 | Render logs; check `DATABASE_URL` is the Session pooler string |
| Blank page | Check the browser console for JavaScript errors or missing assets |
