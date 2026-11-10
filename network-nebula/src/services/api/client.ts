import axios from "axios";

export const getApiBaseUrl = (): string => {
  if (typeof window !== "undefined") {
    // 1. Query parameter (?api=https://...)
    const urlParams = new URLSearchParams(window.location.search);
    const queryApi = urlParams.get("api");
    if (queryApi && queryApi.trim()) {
      const clean = queryApi.trim().replace(/\/+$/, "");
      localStorage.setItem("nebula_api_url", clean);
      return clean;
    }

    // 2. Saved in localStorage
    const savedApi = localStorage.getItem("nebula_api_url");
    if (savedApi && savedApi.trim()) {
      return savedApi.trim().replace(/\/+$/, "");
    }

    // 3. Environment variable
    const envApi = import.meta.env.VITE_API_URL;
    if (envApi && typeof envApi === "string" && envApi.trim()) {
      return envApi.trim().replace(/\/+$/, "");
    }

    // 4. Local dev server only (avoid breaking remote Nginx mapped on port 5173)
    if (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      return "http://localhost:8000";
    }

    return "";
  }
  return "http://localhost:8000";
};

export const setApiBaseUrl = (url: string) => {
  const clean = url.trim().replace(/\/+$/, "");
  if (!clean) {
    localStorage.removeItem("nebula_api_url");
    apiClient.defaults.baseURL = getApiBaseUrl();
  } else {
    localStorage.setItem("nebula_api_url", clean);
    apiClient.defaults.baseURL = clean;
  }
};

const API_BASE_URL = getApiBaseUrl();

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor for auth headers
apiClient.interceptors.request.use(
  (config) => {
    let apiKey = localStorage.getItem("api_key");
    let apiSecret = localStorage.getItem("api_secret");

    if (!apiKey) {
      try {
        const stored = localStorage.getItem("auth-storage");
        if (stored) {
          const parsed = JSON.parse(stored);
          apiKey = parsed.state?.apiKey || parsed.apiKey;
          apiSecret = parsed.state?.apiSecret || parsed.apiSecret;
        }
      } catch {
        // ignore parse errors
      }
    }

    if (apiKey) {
      config.headers["X-API-Key"] = apiKey;
    }
    if (apiSecret) {
      config.headers["X-API-Secret"] = apiSecret;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("api_key");
      localStorage.removeItem("api_secret");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);
