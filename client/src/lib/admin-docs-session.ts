// Reuse the admin dashboard's verified session when entering a document route.
// The server still validates x-admin-token; browser storage cannot grant access.
export async function getAdminDocsSession(): Promise<{
  token: string; expiresAt: string; investorToken?: string;
} | null> {
  try {
    const adminToken = sessionStorage.getItem('admin_token');
    if (!adminToken) return null;
    const res = await fetch('/api/admin/docs/session', {
      method: 'POST', headers: { 'x-admin-token': adminToken },
    });
    if (!res.ok) {
      if (res.status === 401) sessionStorage.removeItem('admin_token');
      return null;
    }
    return await res.json();
  } catch { return null; }
}
