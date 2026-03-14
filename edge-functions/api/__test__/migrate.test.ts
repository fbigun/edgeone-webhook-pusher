import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../kv/migrate.js';

type KvStore = Map<string, unknown>;

function createLegacyBinding(initial: Record<string, unknown>) {
  const store: KvStore = new Map(Object.entries(initial));

  return {
    store,
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async (options: { prefix?: string; limit?: number; cursor?: string }) => {
      const prefix = options?.prefix || '';
      const limit = options?.limit || 256;
      const keys = Array.from(store.keys())
        .filter((key) => key.startsWith(prefix))
        .slice(0, limit)
        .map((name) => ({ name }));
      return { keys, complete: true };
    }),
  };
}

function createPusherBinding() {
  const store: KvStore = new Map();
  return {
    store,
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], complete: true })),
  };
}

describe('/api/kv/migrate', () => {
  afterEach(() => {
    delete (globalThis as any).PUSHER_KV;
    delete (globalThis as any).CONFIG_KV;
    delete (globalThis as any).CHANNELS_KV;
    delete (globalThis as any).APPS_KV;
    delete (globalThis as any).OPENIDS_KV;
    delete (globalThis as any).MESSAGES_KV;
    vi.restoreAllMocks();
  });

  it('migrates legacy data and limits message history to 50', async () => {
    const pusher = createPusherBinding();
    (globalThis as any).PUSHER_KV = pusher;

    const configKv = createLegacyBinding({
      config: { adminToken: 'AT_test' },
    });
    const channelsKv = createLegacyBinding({
      'ch:1': { id: 'ch_1', name: 'channel' },
    });
    const appsKv = createLegacyBinding({
      'app:1': { id: 'app_1', name: 'app' },
    });
    const openidsKv = createLegacyBinding({
      'oid:1': { id: 'oid_1', openId: 'user_1' },
    });
    (globalThis as any).CONFIG_KV = configKv;
    (globalThis as any).CHANNELS_KV = channelsKv;
    (globalThis as any).APPS_KV = appsKv;
    (globalThis as any).OPENIDS_KV = openidsKv;

    const messageIds = Array.from({ length: 60 }, (_, i) => `m${i + 1}`);
    const messages: Record<string, unknown> = {
      msg_list: messageIds,
    };
    for (const id of messageIds) {
      messages[`msg:${id}`] = {
        id,
        appId: 'app_1',
        channelId: 'ch_1',
        openId: 'oid_1',
        createdAt: new Date().toISOString(),
      };
    }
    const messagesKv = createLegacyBinding(messages);
    (globalThis as any).MESSAGES_KV = messagesKv;

    const response = await onRequest({
      request: new Request('https://pusher-dev.ixnie.cn/api/kv/migrate', {
        method: 'POST',
        headers: {
          'X-Internal-Key': 'Health-Test-Key!2026',
        },
      }),
      env: {
        BUILD_KEY: 'Health-Test-Key!2026',
      },
    });

    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.migrated.config.migrated).toBe(1);
    expect(json.migrated.messages.migrated).toBe(50);
    expect(json.migrated.messages.rebuiltIndexes).toBe(true);

    const storedKeys = Array.from(pusher.store.keys());
    expect(storedKeys).toContain('config:config');
    expect(storedKeys).toContain('channels:ch:1');
    expect(storedKeys).toContain('apps:app:1');
    expect(storedKeys).toContain('openids:oid:1');
    expect(storedKeys).toContain('messages:msg_list');
    expect(storedKeys).toContain('messages:msg_app:app_1');
    expect(storedKeys).toContain('messages:msg_channel:ch_1');
    expect(storedKeys).toContain('messages:msg_openid:oid_1');

    const migratedMessages = storedKeys.filter((key) => key.startsWith('messages:msg:m'));
    expect(migratedMessages.length).toBe(50);

    const msgList = JSON.parse(pusher.store.get('messages:msg_list') as string) as string[];
    expect(msgList.length).toBe(50);

    expect(configKv.store.size).toBe(0);
    expect(channelsKv.store.size).toBe(0);
    expect(appsKv.store.size).toBe(0);
    expect(openidsKv.store.size).toBe(0);
    expect(messagesKv.store.size).toBe(0);
  });
});
