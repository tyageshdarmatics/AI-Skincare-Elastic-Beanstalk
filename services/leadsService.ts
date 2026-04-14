// Simple service to submit lead data to a backend API (API Gateway + Lambda)
// Configure VITE_LEADS_API_URL in your environment (e.g., https://xxxx.execute-api.<region>.amazonaws.com/prod/leads)

export type LeadPayload = {
  name: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  phone: string;
  email: string;
};

function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, '');
}

function joinUrl(base: string, path: string) {
  const cleanBase = trimTrailingSlash(base);
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

function getApiBase() {
  const base = (import.meta.env.VITE_API_URL as string | undefined)
    || (import.meta.env.VITE_LEADS_API_URL as string | undefined)
    || '';
  return base ? trimTrailingSlash(base) : '';
}

export async function submitLead(payload: LeadPayload) {
  const apiBase = getApiBase();
  const endpoint = apiBase ? joinUrl(apiBase, '/leads') : '/leads';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to submit lead (${res.status})`);
  }

  return res.json();
}

export async function updateUserSession(userId: string, sessionData: any) {
  const apiBase = getApiBase();
  const endpoint = apiBase
    ? joinUrl(apiBase, `/users/${encodeURIComponent(userId)}/history`)
    : `/users/${encodeURIComponent(userId)}/history`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionData),
    });

    if (!res.ok) {
      console.warn('Failed to update session history:', res.status, res.statusText);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.error('Error updating session history:', err);
    return null;
  }
}
