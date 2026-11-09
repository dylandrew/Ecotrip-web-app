const API_ROOT = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/+$/, '');
const API_ORIGIN = API_ROOT.replace(/\/api\/v1$/, '');

let accessToken = null;
let refreshPromise = null;
const googleExchangePromises = new Map();

export class ApiError extends Error {
  constructor(message, status = 0, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function setAccessToken(token) {
  accessToken = typeof token === 'string' && token ? token : null;
}

export function getAccessToken() {
  return accessToken;
}

export function assetUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_ORIGIN}/${String(path).replace(/^\/+/, '')}`;
}

async function decodeResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(
      `Expected JSON from ${response.url}, but received ${contentType || 'no content type'} (HTTP ${response.status}). Check the API URL and backend route.`,
      response.status,
      'INVALID_RESPONSE',
    );
  }
  const envelope = await response.json();
  if (!response.ok || envelope?.error) {
    throw new ApiError(
      envelope?.error?.message || 'The request could not be completed.',
      response.status,
      envelope?.error?.code || 'REQUEST_FAILED',
    );
  }
  return envelope?.data;
}

export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_ROOT}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(decodeResponse)
      .then((data) => {
        setAccessToken(data?.access_token);
        if (!accessToken) throw new ApiError('Your sign-in session has expired.', 401, 'SESSION_EXPIRED');
        return data;
      })
      .catch((error) => {
        setAccessToken(null);
        window.dispatchEvent(new CustomEvent('ecotrip:auth-expired'));
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function refreshAccessToken() {
  try {
    return Boolean((await refreshSession())?.access_token);
  } catch {
    return false;
  }
}

async function request(path, options = {}) {
  const { auth = true, retry = true, headers: extraHeaders, body, ...init } = options;
  const headers = new Headers(extraHeaders || {});
  headers.set('Accept', 'application/json');
  if (auth && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  let requestBody = body;
  if (body !== undefined && body !== null && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
    requestBody = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_ROOT}${path.startsWith('/') ? path : `/${path}`}`, {
      ...init,
      body: requestBody,
      headers,
      credentials: 'include',
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ApiError(
        `Unable to connect to the EcoTrip API at ${API_ROOT}. Start the backend and check VITE_API_URL.`,
        0,
        'API_UNAVAILABLE',
      );
    }
    throw error;
  }

  if (response.status === 401 && auth && retry && accessToken) {
    if (await refreshAccessToken()) return request(path, { ...options, retry: false });
  }
  return decodeResponse(response);
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

export function exchangeGoogleCode(code) {
  if (!googleExchangePromises.has(code)) {
    const exchange = api.post('/auth/google/exchange', { code }, { auth: false, retry: false })
      .finally(() => googleExchangePromises.delete(code));
    googleExchangePromises.set(code, exchange);
  }
  return googleExchangePromises.get(code);
}