// Edge Function: Health Check
// Path: /api/health

const REQUIRED_KV_BINDINGS = ['PUSHER_KV'];

function normalizeEnvValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getConfiguredBuildKey(env) {
  return normalizeEnvValue(env?.BUILD_KEY);
}

function getConfiguredKvBaseUrl(env) {
  return normalizeEnvValue(env?.KV_BASE_URL);
}

function getBinding(name) {
  switch (name) {
    case 'PUSHER_KV':
      return typeof PUSHER_KV !== 'undefined' ? PUSHER_KV : globalThis.PUSHER_KV;
    default:
      return undefined;
  }
}

async function probeKVBinding(name) {
  const binding = getBinding(name);
  const result = {
    ok: false,
    configured: Boolean(binding),
    readable: false,
    methods: {
      get: typeof binding?.get === 'function',
      put: typeof binding?.put === 'function',
      delete: typeof binding?.delete === 'function',
      list: typeof binding?.list === 'function',
    },
  };

  if (!binding) {
    return {
      ...result,
      error: `${name} binding is missing`,
    };
  }

  const hasAllMethods = Object.values(result.methods).every(Boolean);
  if (!hasAllMethods) {
    return {
      ...result,
      error: `${name} binding does not expose the full KV API`,
    };
  }

  try {
    await binding.get('__healthcheck__');
    return {
      ...result,
      readable: true,
      ok: true,
    };
  } catch (error) {
    return {
      ...result,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeSystemConfig(binding) {
  if (!binding || typeof binding.get !== 'function') {
    return {
      initialized: false,
      error: 'PUSHER_KV binding is missing',
    };
  }

  try {
    const config = await binding.get('config:config', 'json');
    return {
      initialized: Boolean(config),
    };
  } catch (error) {
    return {
      initialized: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildEnvChecks(env) {
  const buildKey = getConfiguredBuildKey(env);
  const kvBaseUrl = getConfiguredKvBaseUrl(env);

  return {
    BUILD_KEY: {
      required: true,
      present: buildKey !== '',
      ok: buildKey !== '',
      length: buildKey.length,
    },
    KV_BASE_URL: {
      required: true,
      present: kvBaseUrl !== '',
      ok: kvBaseUrl !== '',
      value: kvBaseUrl || null,
    },
  };
}

function buildSummary(envChecks, kvChecks, systemConfig) {
  const errors = [];
  const warnings = [];

  if (!envChecks.BUILD_KEY.ok) {
    errors.push('Missing required env: BUILD_KEY');
  }
  if (!envChecks.KV_BASE_URL.ok) {
    errors.push('Missing required env: KV_BASE_URL');
  }

  const failedBindings = Object.entries(kvChecks)
    .filter(([, result]) => !result.ok)
    .map(([name]) => name);

  if (failedBindings.length > 0) {
    errors.push(`KV bindings failed: ${failedBindings.join(', ')}`);
  }

  if (!systemConfig.initialized) {
    warnings.push('系统配置未初始化');
  }

  const healthy = errors.length === 0;
  const ready = healthy && systemConfig.initialized;

  return {
    healthy,
    ready,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
  };
}

/**
 * Handle health check
 * @param {Object} context - EdgeOne EventContext
 * @param {Request} context.request - Client request object
 * @param {Object} context.env - Pages environment variables
 * @returns {Promise<Response>}
 */
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  const envChecks = buildEnvChecks(env);

  const bindingEntries = await Promise.all(
    REQUIRED_KV_BINDINGS.map(async (name) => [name, await probeKVBinding(name)])
  );
  const kvChecks = Object.fromEntries(bindingEntries);
  const systemConfig = await probeSystemConfig(getBinding('PUSHER_KV'));
  const summary = buildSummary(envChecks, kvChecks, systemConfig);

  return jsonResponse(200, {
    success: true,
    healthy: summary.healthy,
    ready: summary.ready,
    timestamp: new Date().toISOString(),
    summary,
    env: envChecks,
    kv: {
      bindings: kvChecks,
      systemConfig,
    },
  });
}

/**
 * Generate CORS headers
 * @returns {Object}
 */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/**
 * Create JSON response with CORS headers
 * @param {number} status - HTTP status code
 * @param {Object} data - Response data
 * @returns {Response}
 */
function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      ...corsHeaders(),
    },
  });
}
