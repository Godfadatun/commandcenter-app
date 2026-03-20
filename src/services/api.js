const BASE = import.meta.env.VITE_PROXY_URL || (typeof window !== "undefined" && window.location.hostname === "localhost" ? "http://localhost:3456" : "");

const getToken = () => localStorage.getItem("cc_token");

const request = async (path, opts = {}) => {
  const headers = { "Content-Type": "application/json", ...opts.headers };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const r = await fetch(BASE + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await r.json();
    if (r.status === 401 && data.error?.includes("expired")) {
      localStorage.removeItem("cc_token");
      window.location.href = "/login";
    }
    return data;
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  delete: (path) => request(path, { method: "DELETE" }),
};

// Auth
export const authAPI = {
  register: (data) => api.post("/api/auth/register", data),
  login: (data) => api.post("/api/auth/login", data),
  verify: (data) => api.post("/api/auth/verify", data),
};

// Notion
export const notionAPI = {
  saveConfig: (data) => api.post("/api/notion/config", data),
  getConfig: () => api.get("/api/notion/config"),
  testDbs: () => api.post("/api/notion/test-dbs", {}),
  sync: () => api.post("/api/notion/sync", {}),
  createTask: (data) => api.post("/api/notion/tasks", data),
  updateTask: (pageId, data) => api.patch(`/api/notion/tasks/${pageId}`, data),
  createExpense: (data) => api.post("/api/notion/expenses", data),
  updateExpense: (pageId, data) => api.patch(`/api/notion/expenses/${pageId}`, data),
};

// Calendar
export const calendarAPI = {
  saveConfig: (data) => api.post("/api/calendar/config", data),
  getEvents: () => api.get("/api/calendar/events"),
};

// Schedules
export const scheduleAPI = {
  create: (data) => api.post("/api/schedules", data),
  list: () => api.get("/api/schedules"),
  update: (code, data) => api.patch(`/api/schedules/${code}`, data),
  delete: (code) => api.delete(`/api/schedules/${code}`),
  trigger: (cronTime) => api.post("/api/schedules/trigger", { cronTime }),
};

// Health
export const healthAPI = {
  check: () => api.get("/api/health"),
};
