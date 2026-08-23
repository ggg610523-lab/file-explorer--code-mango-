const WORKER_CODE = `
  self.onmessage = async (e) => {
    const { id, blob, size } = e.data;
    try {
      const bitmap = await createImageBitmap(blob, { resizeWidth: size, resizeQuality: 'low' });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) { bitmap.close(); throw new Error('no 2d context'); }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
      self.postMessage({ id, ok: true, blob: out });
    } catch (err) {
      self.postMessage({ id, ok: false });
    }
  };
`;

const LRU_MAX = 500;
const THUMB_SIZE = 256;
const HIGH_MAX = 48;
const PREFETCH_MAX = 24;

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const pending = new Map<number, { resolve: (url: string) => void; reject: (err: Error) => void }>();

type Job = {
  path: string;
  size: number;
  resolve: (url: string) => void;
  reject: (err: Error) => void;
};

const highQueue: Job[] = [];
const prefetchQueue = new Map<string, number>();
let busy = false;
let worker: Worker | null = null;
let nextId = 1;

function ensureWorker(): Worker {
  if (worker) return worker;
  const url = URL.createObjectURL(new Blob([WORKER_CODE], { type: 'application/javascript' }));
  worker = new Worker(url);
  worker.onmessage = (e) => {
    const { id, ok, blob } = e.data as { id: number; ok: boolean; blob?: Blob };
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok && blob) {
      p.resolve(URL.createObjectURL(blob));
    } else {
      p.reject(new Error('thumbnail decode failed'));
    }
  };
  worker.onerror = () => {
    const all = Array.from(pending.values());
    pending.clear();
    all.forEach(p => p.reject(new Error('thumbnail worker error')));
  };
  return worker;
}

function remember(path: string, url: string): void {
  cache.set(path, url);
  if (cache.size > LRU_MAX) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      const oldUrl = cache.get(oldestKey);
      cache.delete(oldestKey);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
    }
  }
}

async function runJob(job: Job): Promise<string> {
  const res = await fetch(`thumbnails://${job.path}`);
  if (!res.ok) throw new Error('thumbnails fetch failed');
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage({ id, blob, size: job.size });
  });
}

function pruneHigh(): void {
  while (highQueue.length > HIGH_MAX) {
    const stale = highQueue.shift()!;
    stale.resolve(`thumbnails://${stale.path}`);
  }
}

function takePrefetch(): Job | null {
  while (prefetchQueue.size > 0) {
    const keys = Array.from(prefetchQueue.keys());
    const path = keys[keys.length - 1];
    const size = prefetchQueue.get(path)!;
    prefetchQueue.delete(path);
    if (cache.has(path) || inflight.has(path)) continue;
    return { path, size, resolve: () => undefined, reject: () => undefined };
  }
  return null;
}

function pump(): void {
  if (busy) return;
  pruneHigh();
  const job = highQueue.shift() || takePrefetch();
  if (!job) return;
  busy = true;
  runJob(job).then(
    url => { remember(job.path, url); job.resolve(url); },
    err => job.reject(err)
  ).finally(() => { busy = false; pump(); });
}

export function getCachedThumbnail(path: string): string | null {
  return cache.get(path) ?? null;
}

export function loadThumbnail(path: string, size: number = THUMB_SIZE): Promise<string> {
  const cached = cache.get(path);
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(path);
  if (existing) return existing;

  const p = new Promise<string>((resolve, reject) => {
    highQueue.push({ path, size, resolve, reject });
    pump();
  });
  p.then(() => inflight.delete(path), () => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

export function prefetchThumbnail(path: string, size: number = THUMB_SIZE): void {
  if (cache.has(path) || inflight.has(path)) return;
  if (highQueue.some(j => j.path === path)) return;
  if (prefetchQueue.has(path)) {
    prefetchQueue.delete(path);
    prefetchQueue.set(path, size);
    return;
  }
  if (prefetchQueue.size >= PREFETCH_MAX) {
    const oldest = prefetchQueue.keys().next().value;
    if (oldest !== undefined) prefetchQueue.delete(oldest);
  }
  prefetchQueue.set(path, size);
  pump();
}
