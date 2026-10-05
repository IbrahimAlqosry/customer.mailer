// The API address comes from config.js (loaded by index.html) so it can be changed on the
// server without rebuilding:
//   IIS:      window.APP_CONFIG.apiUrl = '/CustomerMailerApi/api'  (the backend IIS application)
//   ng serve: falls back to 'api', which proxy.conf.json forwards to localhost:3000
declare global {
  interface Window {
    APP_CONFIG?: { apiUrl?: string };
  }
}

export const API_URL = (window.APP_CONFIG?.apiUrl || 'api').replace(/\/+$/, '');
