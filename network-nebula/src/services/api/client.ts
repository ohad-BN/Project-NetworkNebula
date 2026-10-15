import axios from "axios";

const API_BASE_URL = "http://localhost:8000";

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
