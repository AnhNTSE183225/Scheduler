const TOKEN_KEY = 'pulseplan_auth_token';
export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) || '').replace(/\/+$/, '');

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

const HTTP_ERROR_MESSAGES: Record<number, string> = {
  400: 'Please check your input and try again.',
  401: 'Your session has expired. Please sign in again.',
  403: "You don't have permission to perform this action.",
  404: 'The requested item or endpoint could not be found.',
  408: 'The request timed out. Please try again.',
  409: 'This conflicts with existing data. Please refresh and try again.',
  413: 'The submitted data is too large.',
  429: 'Too many requests right now. Please wait a moment and try again.',
  500: 'Something went wrong on the server. Please try again.',
  502: 'The server is temporarily unreachable. Please try again in a moment.',
  503: 'The service is temporarily unavailable. Please try again in a moment.',
  504: 'The server took too long to respond. Please try again.',
};

export function humanHttpError(status: number): string {
  if (HTTP_ERROR_MESSAGES[status]) {
    return HTTP_ERROR_MESSAGES[status];
  }
  if (status >= 500) {
    return 'Something went wrong on the server. Please try again.';
  }
  return 'Something went wrong with that request. Please try again.';
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw new Error('Unable to reach the server. Please check your connection and try again.');
  }

  if (!res.ok) {
    let msg = humanHttpError(res.status);
    try {
      const errJson = await res.json();
      const serverMsg = errJson?.detail || errJson?.message || errJson?.error;
      if (typeof serverMsg === 'string' && serverMsg.trim()) {
        msg = serverMsg.trim();
      }
    } catch {}
    if (res.status === 401) {
      setStoredToken(null);
    }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}
