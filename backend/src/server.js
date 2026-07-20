import http from 'node:http';
import https from 'node:https';
import app from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.PORT, () => {
  console.log(`TeachMate API listening on http://localhost:${env.PORT}`);

  // Render Free Tier Warmup Keep-Alive Ping
  const renderExternalUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderExternalUrl) {
    const PING_INTERVAL_MS = 14 * 60 * 1000; // Ping every 14 mins (Render sleeps at 15 mins)
    const healthUrl = `${renderExternalUrl.replace(/\/$/, '')}/api/health`;

    console.log(`[Warmup Service] Keep-alive initialized. Pinging ${healthUrl} every 14 minutes.`);

    setInterval(() => {
      const httpClient = healthUrl.startsWith('https') ? https : http;
      httpClient.get(healthUrl, (res) => {
        console.log(`[Warmup Ping] Status: ${res.statusCode} at ${new Date().toLocaleTimeString()}`);
      }).on('error', (err) => {
        console.error(`[Warmup Ping Error]:`, err.message);
      });
    }, PING_INTERVAL_MS);
  }
});
