import { getJson } from './http';

let loadsCache = {
  key: '',
  ts: 0,
  data: null,
  inflight: null,
};

export function clearCarrierLoadsCache() {
  loadsCache = {
    key: '',
    ts: 0,
    data: null,
    inflight: null,
  };
}

export async function getCarrierLoads(options = {}) {
  const pageSize = Number(options.pageSize ?? 200);
  const excludeDrafts = Boolean(options.excludeDrafts ?? false);
  const cacheMs = Number(options.cacheMs ?? 15000);

  const key = `page_size=${pageSize}&exclude_drafts=${excludeDrafts ? 'true' : 'false'}`;
  const now = Date.now();

  if (loadsCache.data && loadsCache.key === key && now - loadsCache.ts < cacheMs) {
    return loadsCache.data;
  }

  if (loadsCache.inflight && loadsCache.key === key) {
    return loadsCache.inflight;
  }

  loadsCache.key = key;
  loadsCache.inflight = getJson(`/loads?page_size=${encodeURIComponent(pageSize)}&exclude_drafts=${excludeDrafts ? 'true' : 'false'}`, {
    requestLabel: 'GET /loads',
  })
    .then((data) => {
      loadsCache.data = data;
      loadsCache.ts = Date.now();
      loadsCache.inflight = null;
      return data;
    })
    .catch((err) => {
      loadsCache.inflight = null;
      throw err;
    });

  return loadsCache.inflight;
}
