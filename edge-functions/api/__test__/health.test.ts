import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../health.js';

function createKVBinding() {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ keys: [], complete: true })),
  };
}

function installBindings() {
  (globalThis as any).PUSHER_KV = createKVBinding();
}

function cleanupBindings() {
  delete (globalThis as any).PUSHER_KV;
  delete (globalThis as any).CONFIG_KV;
  delete (globalThis as any).CHANNELS_KV;
  delete (globalThis as any).APPS_KV;
  delete (globalThis as any).OPENIDS_KV;
  delete (globalThis as any).MESSAGES_KV;
}

describe('/api/health', () => {
  afterEach(() => {
    cleanupBindings();
    vi.restoreAllMocks();
  });

  it('reports ready when env and KV bindings are healthy', async () => {
    installBindings();
    (globalThis as any).PUSHER_KV.get.mockResolvedValue({ adminToken: 'AT_test' });

    const response = await onRequest({
      request: new Request('https://pusher-dev.ixnie.cn/api/health'),
      env: {
        BUILD_KEY: 'Health-Test-Key!2026',
        KV_BASE_URL: 'https://pusher-dev.ixnie.cn',
      },
    });

    const json = await response.json();

    expect(json.success).toBe(true);
    expect(json.healthy).toBe(true);
    expect(json.ready).toBe(true);
    expect(json.summary.errorCount).toBe(0);
    expect(json.summary.warningCount).toBe(0);
    expect(json.kv.bindings.PUSHER_KV.ok).toBe(true);
    expect(json.kv.systemConfig.initialized).toBe(true);
  });

  it('reports missing required envs clearly', async () => {
    installBindings();

    const response = await onRequest({
      request: new Request('https://pusher-dev.ixnie.cn/api/health'),
      env: {},
    });

    const json = await response.json();

    expect(json.healthy).toBe(false);
    expect(json.ready).toBe(false);
    expect(json.summary.errors).toContain('Missing required env: BUILD_KEY');
    expect(json.summary.errors).toContain('Missing required env: KV_BASE_URL');
    expect(json.summary.warningCount).toBeGreaterThanOrEqual(1);
  });

  // legacy KV detection moved to /api/health-migration
});
