# Deployment Guide - Hemodialysis Occupancy Board

This guide provides instructions for deploying this full-stack application (React/Vite client, Node/Express server, and Supabase PostgreSQL database) to production using **Render** or **Railway**.

---

## Prerequisites

Before starting, make sure you have:
1. A **GitHub** account where your repository [dialysis-occupancy-board](https://github.com/almanalaysay93-gif/dialysis-occupancy-board) is hosted.
2. A **Supabase** account with an active PostgreSQL database.
3. A **Render** or **Railway** account for application hosting.

---

## 1. Database Setup (Supabase)

If you are using your existing Supabase database, the tables and schema are already created and migrated. If you are setting up a **new** Supabase database, follow these steps:

1. Create a new project in Supabase.
2. Obtain your **Transaction Connection String** from the database settings (Settings > Database > Connection string > URI).
3. The connection string looks like this:
   `postgresql://postgres.[PROJECT_ID]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres`
4. Run migrations locally from this project directory by running:
   ```bash
   # Set the environment variable and push the schema
   DATABASE_URL="your-supabase-connection-string" pnpm db:push
   ```
5. Seed the database with the initial floor plans (160 machines) and default staff credentials:
   ```bash
   DATABASE_URL="your-supabase-connection-string" pnpm db:seed
   ```

---

## 2. Option A: Deploying to Render (Recommended)

Render offers free web service hosting and supports automatic deployments directly linked to your GitHub repository.

### One-Click Blueprint Deployment (easiest)
1. Log in to [Render](https://dashboard.render.com/).
2. Click **New +** in the top navigation bar and select **Blueprint**.
3. Connect your GitHub account and select the `dialysis-occupancy-board` repository.
4. Render will automatically read the `render.yaml` blueprint file in the repository.
5. In the configuration page, provide the following environment variables:
   *   **`SUPABASE_DATABASE_URL_B64`**: Paste your Supabase connection string encoded in Base64 (recommended to avoid URL parsing issues).
       *   *To encode on Windows PowerShell:* `[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("your_connection_string"))`
       *   *To encode on Mac/Linux:* `echo -n "your_connection_string" | base64`
   *   **`DATABASE_URL`**: Alternatively, paste your connection string in plain text.
   *   **`JWT_SECRET`**: Leave blank, Render will generate a random secure key for you.
6. Click **Approve** to deploy. Render will automatically build the client and start the server.

### Manual Web Service Setup
If you prefer to configure the Web Service manually:
1. In the Render Dashboard, click **New +** and select **Web Service**.
2. Connect your GitHub repository.
3. Configure the following service settings:
   *   **Name**: `dialysis-occupancy-board`
   *   **Runtime**: `Node`
   *   **Build Command**: `pnpm install && pnpm run build`
   *   **Start Command**: `pnpm start`
4. Scroll down, click **Advanced**, and add the following **Environment Variables**:
   *   `NODE_ENV`: `production`
   *   `PORT`: `3000`
   *   `JWT_SECRET`: (Generate a long random string)
   *   `SUPABASE_DATABASE_URL_B64` (Base64 encoded string) or `DATABASE_URL` (plain text string)
5. Click **Create Web Service**.

---

## 3. Option B: Deploying to Railway

Railway is a developer-friendly platform that will automatically detect the `Dockerfile` in the repository and build it as a container.

1. Log in to [Railway](https://railway.app/).
2. Click **New Project** > **Deploy from GitHub repo**.
3. Select the `dialysis-occupancy-board` repository.
4. Click **Variables** in your service panel and add:
   *   `NODE_ENV`: `production`
   *   `JWT_SECRET`: (Generate a long random string)
   *   `SUPABASE_DATABASE_URL_B64`: (Base64 encoded Supabase URL) OR `DATABASE_URL`: (Plain-text connection string)
   *   `PORT`: `3000`
5. Railway will automatically build the container and deploy the app.

---

## Environment Variables Reference

| Variable Name | Required? | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | Yes | Set to `production` in your hosting dashboard. |
| `PORT` | No | The port the server binds to (default: `3000`). |
| `JWT_SECRET` | Yes | A secret key used to sign and verify staff cookies. Keep this private. |
| `SUPABASE_DATABASE_URL_B64` | Recommended | Base64-encoded Postgres connection URL. Bypasses proxy URL mangling. |
| `DATABASE_URL` | Fallback | Plain-text Postgres connection string (e.g., `postgresql://...`). |
