export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details: unknown,
  ) {
    super(message);
  }
}
function csrf() {
  return decodeURIComponent(
    document.cookie
      .split('; ')
      .find((x) => x.startsWith('interior_csrf='))
      ?.split('=')[1] || '',
  );
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method)) headers.set('X-CSRF-Token', csrf());
  const res = await fetch('/api' + path, { ...init, headers, credentials: 'include' });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body.error;
    throw new ApiError(
      err?.code || 'REQUEST_FAILED',
      err?.message || (res.status === 422 ? '请检查输入内容。' : '请求失败，请稍后重试。'),
      res.status,
      err?.details || body.detail,
    );
  }
  return body as T;
}
export const post = <T>(path: string, body: unknown, headers?: HeadersInit) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body), headers });
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
