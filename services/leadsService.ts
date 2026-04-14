// Simple service to submit lead data to a backend API (API Gateway + Lambda)
// Configure VITE_LEADS_API_URL in your environment (e.g., https://xxxx.execute-api.<region>.amazonaws.com/prod/leads)

export type LeadPayload = {
  name: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  phone: string;
  email: string;
};

export async function submitLead(payload: LeadPayload) {
  // Prefer explicit env var, but fall back to same-origin backend route for App Runner monolith deploys.
  const endpoint = (import.meta.env.VITE_LEADS_API_URL as string | undefined) || '/leads';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to submit lead (${res.status})`);
  }

  return res.json();
}

/**
 * Updates the user's history with current session data.
 */
export async function updateUserSession(userId: string, sessionData: any) {
  // Prefer explicit API base, but fall back to same-origin route.
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) || '';

  const endpoint = `${apiBase}/users/${userId}/history`;
  
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sessionData),
    });

    if (!res.ok) {
      console.warn('Failed to update session history:', res.statusText);
    }
    return await res.json();
  } catch (err) {
    console.error('Error updating session history:', err);
  }
}
