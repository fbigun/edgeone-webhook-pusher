// Edge Function: Legacy KV Migration
// Path: /api/kv/migrate
// KV Binding: PUSHER_KV (configured in EdgeOne Pages)
// Legacy bindings: CONFIG_KV, CHANNELS_KV, APPS_KV, OPENIDS_KV, MESSAGES_KV

function getConfiguredBuildKey(env) {
  const key = env?.BUILD_KEY;
  return typeof key === 'string' ? key.trim() : '';
}

function isValidKey(key, env) {
  const envBuildKey = getConfiguredBuildKey(env);
  if (envBuildKey === '') return false;
  if (typeof key !== 'string' || key.length === 0) return false;
  return key === envBuildKey;
}

function normalizeListKeys(keys) {
  if (!Array.isArray(keys)) return [];
  return keys.map((k) => (k && (k.name || k.key)) || k).filter(Boolean);
}

function getBinding(name) {
  switch (name) {
    case 'PUSHER_KV':
      return typeof PUSHER_KV !== 'undefined' ? PUSHER_KV : globalThis.PUSHER_KV;
    case 'CONFIG_KV':
      return typeof CONFIG_KV !== 'undefined' ? CONFIG_KV : globalThis.CONFIG_KV;
    case 'CHANNELS_KV':
      return typeof CHANNELS_KV !== 'undefined' ? CHANNELS_KV : globalThis.CHANNELS_KV;
    case 'APPS_KV':
      return typeof APPS_KV !== 'undefined' ? APPS_KV : globalThis.APPS_KV;
    case 'OPENIDS_KV':
      return typeof OPENIDS_KV !== 'undefined' ? OPENIDS_KV : globalThis.OPENIDS_KV;
    case 'MESSAGES_KV':
      return typeof MESSAGES_KV !== 'undefined' ? MESSAGES_KV : globalThis.MESSAGES_KV;
    default:
      return undefined;
  }
}

async function listAllKeys(binding) {
  const allKeys = [];
  let cursor;
  let complete = false;

  while (!complete) {
    const listOptions = { limit: 256 };
    if (cursor && cursor.length > 0) {
      listOptions.cursor = cursor;
    }

    const result = await binding.list(listOptions);
    const keys = normalizeListKeys(result?.keys);
    allKeys.push(...keys);
    complete = result?.list_complete ?? result?.complete ?? true;
    cursor = result?.cursor && result.cursor.length > 0 ? result.cursor : undefined;
  }

  return allKeys;
}

async function clearKeys(binding, keys) {
  let cleared = 0;
  for (const key of keys) {
    await binding.delete(key);
    cleared += 1;
  }
  return cleared;
}

async function migrateNamespace(binding, targetBinding, prefix) {
  const keys = await listAllKeys(binding);
  let migrated = 0;

  for (const key of keys) {
    const value = await binding.get(key, 'json');
    if (typeof value === 'undefined') {
      continue;
    }
    await targetBinding.put(`${prefix}${key}`, JSON.stringify(value));
    migrated += 1;
  }

  const cleared = await clearKeys(binding, keys);

  return { migrated, total: keys.length, cleared };
}

async function migrateMessages(binding, targetBinding) {
  const result = {
    migrated: 0,
    total: 0,
    rebuiltIndexes: false,
    cleared: 0,
  };

  const list = await binding.get('msg_list', 'json');
  let messageIds = Array.isArray(list) ? list : [];

  if (messageIds.length === 0) {
    const fallbackList = await binding.list({ prefix: 'msg:', limit: 50 });
    messageIds = normalizeListKeys(fallbackList?.keys).map((key) => key.replace(/^msg:/, ''));
  }

  messageIds = messageIds.slice(0, 50);
  result.total = messageIds.length;

  const msgList = [];
  const appIndex = {};
  const channelIndex = {};
  const openIdIndex = {};

  for (const id of messageIds) {
    const key = `msg:${id}`;
    const message = await binding.get(key, 'json');
    if (!message) {
      continue;
    }

    await targetBinding.put(`messages:${key}`, JSON.stringify(message));
    msgList.push(id);
    result.migrated += 1;

    if (message.appId) {
      if (!appIndex[message.appId]) appIndex[message.appId] = [];
      appIndex[message.appId].push(id);
    }
    if (message.channelId) {
      if (!channelIndex[message.channelId]) channelIndex[message.channelId] = [];
      channelIndex[message.channelId].push(id);
    }
    if (message.openId) {
      if (!openIdIndex[message.openId]) openIdIndex[message.openId] = [];
      openIdIndex[message.openId].push(id);
    }
  }

  await targetBinding.put('messages:msg_list', JSON.stringify(msgList));

  const indexWrites = [];
  for (const [appId, ids] of Object.entries(appIndex)) {
    indexWrites.push(targetBinding.put(`messages:msg_app:${appId}`, JSON.stringify(ids)));
  }
  for (const [channelId, ids] of Object.entries(channelIndex)) {
    indexWrites.push(targetBinding.put(`messages:msg_channel:${channelId}`, JSON.stringify(ids)));
  }
  for (const [openId, ids] of Object.entries(openIdIndex)) {
    indexWrites.push(targetBinding.put(`messages:msg_openid:${openId}`, JSON.stringify(ids)));
  }

  if (indexWrites.length > 0) {
    await Promise.all(indexWrites);
  }

  result.rebuiltIndexes = true;
  const keysToClear = await listAllKeys(binding);
  result.cleared = await clearKeys(binding, keysToClear);
  return result;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Only POST is allowed' });
  }

  const internalKey = request.headers.get('X-Internal-Key');
  if (!isValidKey(internalKey, env)) {
    return jsonResponse(403, { success: false, error: 'Unauthorized' });
  }

  const pusherKv = getBinding('PUSHER_KV');
  if (!pusherKv) {
    return jsonResponse(500, { success: false, error: 'PUSHER_KV binding is missing' });
  }

  const stats = {
    config: { migrated: 0, total: 0, cleared: 0, skipped: true },
    channels: { migrated: 0, total: 0, cleared: 0, skipped: true },
    apps: { migrated: 0, total: 0, cleared: 0, skipped: true },
    openids: { migrated: 0, total: 0, cleared: 0, skipped: true },
    messages: { migrated: 0, total: 0, rebuiltIndexes: false, cleared: 0, skipped: true },
  };

  try {
    const configKv = getBinding('CONFIG_KV');
    if (configKv) {
      stats.config = { ...(await migrateNamespace(configKv, pusherKv, 'config:')), skipped: false };
    }
    const channelsKv = getBinding('CHANNELS_KV');
    if (channelsKv) {
      stats.channels = { ...(await migrateNamespace(channelsKv, pusherKv, 'channels:')), skipped: false };
    }
    const appsKv = getBinding('APPS_KV');
    if (appsKv) {
      stats.apps = { ...(await migrateNamespace(appsKv, pusherKv, 'apps:')), skipped: false };
    }
    const openidsKv = getBinding('OPENIDS_KV');
    if (openidsKv) {
      stats.openids = { ...(await migrateNamespace(openidsKv, pusherKv, 'openids:')), skipped: false };
    }
    const messagesKv = getBinding('MESSAGES_KV');
    if (messagesKv) {
      stats.messages = { ...(await migrateMessages(messagesKv, pusherKv)), skipped: false };
    }

    return jsonResponse(200, {
      success: true,
      migrated: stats,
    });
  } catch (error) {
    console.error('KV migrate error:', error);
    return jsonResponse(500, { success: false, error: String(error) });
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Internal-Key',
  };
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      ...corsHeaders(),
    },
  });
}
