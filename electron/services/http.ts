export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface HttpOptions {
  method?: "GET" | "POST" | "PATCH";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/** fetch в Node/Electron: таймаут обязателен, иначе UI зависает на обложках. */
export async function httpText(url: string, opts: HttpOptions = {}): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      signal: ctrl.signal
    });
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(res.status, text.slice(0, 400) || res.statusText);
    }
    return text;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`timeout ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function httpJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const text = await httpText(url, opts);
  return JSON.parse(text) as T;
}

export async function httpBuffer(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 12000
): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new HttpError(res.status, res.statusText);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}
