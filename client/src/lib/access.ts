

interface AccessRequestPayload {
  name: string;
  email: string;
  country?: string;
  role?: string;
  company?: string;
  useCase?: string;
  heardFrom?: string;
  socialHandle?: string;
}

export async function submitAccessRequest(payload: AccessRequestPayload): Promise<{ status: string; id?: number }> {
  const res = await fetch('/api/access/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to submit request');
  }
  return res.json();
}
