// HTTP layer for the server. Returns { status, body } for every HTTP answer and THROWS only
// when the server cannot be reached (offline, DNS, timeout), which the engine treats as
// "retry later, never Failed".

export function createApi({ baseUrl, fetchImpl = (...a) => fetch(...a), timeoutMs = 30000 }) {
  const base = baseUrl.replace(/\/+$/, '');

  async function call(method, path, identity, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Role': identity.role,
          // Encoded so names in any script (for example Amharic) are valid in a header.
          'X-Actor': encodeURIComponent(identity.actor),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      let parsed = null;
      try {
        parsed = await res.json();
      } catch (_) {
        parsed = null;
      }
      return { status: res.status, body: parsed };
    } finally {
      clearTimeout(timer);
    }
  }

  const query = (filters = {}) => {
    const p = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    return p.toString() ? `?${p}` : '';
  };

  return {
    createReport: (payload, who) => call('POST', '/reports', who, payload),
    editReport: (id, payload, who) => call('PATCH', `/reports/${id}`, who, payload),
    postEvents: (id, events, who) => call('POST', `/reports/${id}/events`, who, { events }),
    changeStatus: (id, payload, who) => call('POST', `/reports/${id}/status`, who, payload),
    listReports: (filters, who) => call('GET', `/reports${query(filters)}`, who),
    getReport: (id, who) => call('GET', `/reports/${id}`, who),
    listEvents: (id, who) => call('GET', `/reports/${id}/events`, who),
  };
}
