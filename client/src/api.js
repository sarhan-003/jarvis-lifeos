// Thin client for the Express API. The browser's local date is sent with every
// request so "today" and "tomorrow" mean the user's calendar day.
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify({ today: localToday(), ...(body ?? {}) }),
    });
  } catch {
    throw new Error('Cannot reach the Jarvis server. Is it running on port 8787?');
  }
  const data = await res.json().catch(() => ({}));
  // Tool failures come back as an action record; surface them to the caller.
  if (!res.ok && !data.action) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const q = (params) => `?${new URLSearchParams({ today: localToday(), ...params })}`;

export const api = {
  health: () => request('GET', '/api/health'),
  mcp: () => request('GET', '/api/mcp'),
  chat: (message, history) => request('POST', '/api/chat', { message, history }),
  tasks: () => request('GET', '/api/tasks'),
  createTask: (fields) => request('POST', '/api/tasks', fields),
  updateTask: (id, fields) => request('PATCH', `/api/tasks/${id}`, fields),
  completeTask: (id) => request('POST', `/api/tasks/${id}/complete`),
  deleteTask: (id) => request('DELETE', `/api/tasks/${id}`),
  plans: () => request('GET', '/api/plans'),
  summary: (date) => request('GET', `/api/summary${q(date ? { date } : {})}`),
  actions: () => request('GET', '/api/actions?limit=40'),
  confirm: (id) => request('POST', `/api/actions/${id}/confirm`),
  cancel: (id) => request('POST', `/api/actions/${id}/cancel`),
};
