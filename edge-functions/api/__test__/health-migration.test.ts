import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../health-migration.js';

function createKVBinding() {
  return {
    list: vi.fn(async () => ({ keys: [], complete: true })),
  };
}

describe('/api/health-migration', () => {
  afterEach(() => {
    delete (globalThis as any).CONFIG_KV;
    delete (globalThis as any).CHANNELS_KV;
    delete (globalThis as any).APPS_KV;
    delete (globalThis as any).OPENIDS_KV;
    delete (globalThis as any).MESSAGES_KV;
    vi.restoreAllMocks();
  });

  it('reports no legacy data when bindings are missing', async () => {
    const response = await onRequest({
      request: new Request('https://pusher-dev.ixnie.cn/api/health-migration'),
    });

    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.legacy.hasData).toBe(false);
  });

  it('reports legacy data when any namespace has keys', async () => {
    (globalThis as any).CONFIG_KV = createKVBinding();
    (globalThis as any).CONFIG_KV.list.mockResolvedValue({ keys: [{ name: 'config' }], complete: true });

    const response = await onRequest({
      request: new Request('https://pusher-dev.ixnie.cn/api/health-migration'),
    });

    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.legacy.hasData).toBe(true);
    expect(json.legacy.namespaces.CONFIG_KV.hasData).toBe(true);
  });
});
