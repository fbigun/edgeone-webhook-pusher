// Edge Function: Legacy KV Migration Health
// Path: /api/health-migration

const LEGACY_KV_BINDINGS = [
  'CONFIG_KV',
  'CHANNELS_KV',
  'APPS_KV',
  'OPENIDS_KV',
  'MESSAGES_KV',
];

function getBinding(name) {
  switch (name) {
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

async function probeLegacyKvData() {
  const namespaces = {};
  let hasData = false;

  for (const name of LEGACY_KV_BINDINGS) {
    const binding = getBinding(name);
    const result = {
      configured: Boolean(binding),
      hasData: false,
      error: undefined,
    };

    if (!binding || typeof binding.list !== 'function') {
      namespaces[name] = {
        ...result,
        error: binding ? 'Legacy KV binding missing list method' : 'Legacy KV binding is missing',
      };
      continue;
    }

    try {
      const listResult = await binding.list({ limit: 1 });
      const keys = listResult?.keys || [];
      const normalizedKeys = keys.map((k) => k?.name || k?.key || k);
      result.hasData = normalizedKeys.length > 0;
      if (result.hasData) {
        hasData = true;
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }

    namespaces[name] = result;
  }

  return {
    hasData,
    namespaces,
  };
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  const legacy = await probeLegacyKvData();

  return jsonResponse(200, {
    success: true,
    timestamp: new Date().toISOString(),
    legacy,
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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
