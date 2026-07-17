var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-T8uFLb/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// worker.js
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Credentials": "true"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    const jsonResponse = /* @__PURE__ */ __name((data, status = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }, "jsonResponse");
    const bufferToBase64 = /* @__PURE__ */ __name((buf) => btoa(String.fromCharCode(...new Uint8Array(buf))), "bufferToBase64");
    const base64ToBuffer = /* @__PURE__ */ __name((str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)), "base64ToBuffer");
    const hashPassword = /* @__PURE__ */ __name(async (password, saltBuffer = null) => {
      if (!saltBuffer) {
        saltBuffer = crypto.getRandomValues(new Uint8Array(16));
      }
      const baseKey = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveBits", "deriveKey"]
      );
      const derivedKey = await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: saltBuffer,
          iterations: 1e5,
          hash: "SHA-256"
        },
        baseKey,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        true,
        ["verify", "sign"]
      );
      const exported = await crypto.subtle.exportKey("raw", derivedKey);
      return {
        hash: bufferToBase64(exported),
        salt: bufferToBase64(saltBuffer)
      };
    }, "hashPassword");
    const getJwtSecret = /* @__PURE__ */ __name(() => env.JWT_SECRET || "antigravity-dev-jwt-secret-key-for-dondlingergc", "getJwtSecret");
    const signJwt = /* @__PURE__ */ __name(async (payload) => {
      const secret = getJwtSecret();
      const header = { alg: "HS256", typ: "JWT" };
      const encodedHeader = bufferToBase64(new TextEncoder().encode(JSON.stringify(header))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
      const encodedPayload = bufferToBase64(new TextEncoder().encode(JSON.stringify(payload))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signatureBuf = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
      );
      const signature = bufferToBase64(signatureBuf).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
      return `${encodedHeader}.${encodedPayload}.${signature}`;
    }, "signJwt");
    const verifyJwt = /* @__PURE__ */ __name(async (token) => {
      try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const [header, payload, signature] = parts;
        const secret = getJwtSecret();
        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["verify"]
        );
        const signatureBuf = base64ToBuffer(signature.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - signature.length % 4) % 4));
        const valid = await crypto.subtle.verify(
          "HMAC",
          key,
          signatureBuf,
          new TextEncoder().encode(`${header}.${payload}`)
        );
        if (!valid) return null;
        const decodedPayload = JSON.parse(new TextDecoder().decode(base64ToBuffer(payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - payload.length % 4) % 4))));
        if (decodedPayload.exp && Date.now() / 1e3 > decodedPayload.exp) {
          return null;
        }
        return decodedPayload;
      } catch (err) {
        return null;
      }
    }, "verifyJwt");
    const sha256 = /* @__PURE__ */ __name(async (text) => {
      const msgBuffer = new TextEncoder().encode(text);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
      return bufferToBase64(hashBuffer);
    }, "sha256");
    const authenticate = /* @__PURE__ */ __name(async (req) => {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
      const token = authHeader.substring(7);
      return await verifyJwt(token);
    }, "authenticate");
    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      try {
        const { email, password } = await request.json();
        if (!email || !password) {
          return jsonResponse({ error: "Missing email or password" }, 400);
        }
        const { hash, salt } = await hashPassword(password);
        const userId = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO users (id, email, password_hash, salt, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, 'free', 'inactive')"
        ).bind(userId, email, hash, salt).run();
        return jsonResponse({ success: true, userId });
      } catch (err) {
        return jsonResponse({ error: err.message || "Registration failed" }, 500);
      }
    }
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      try {
        const { email, password } = await request.json();
        if (!email || !password) {
          return jsonResponse({ error: "Missing email or password" }, 400);
        }
        const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
        if (!user) {
          return jsonResponse({ error: "Invalid email or password" }, 401);
        }
        const saltBuffer = base64ToBuffer(user.salt);
        const { hash } = await hashPassword(password, saltBuffer);
        if (hash !== user.password_hash) {
          return jsonResponse({ error: "Invalid email or password" }, 401);
        }
        const now = Math.floor(Date.now() / 1e3);
        const payload = {
          sub: user.id,
          email: user.email,
          subscription_tier: user.subscription_tier,
          subscription_status: user.subscription_status,
          iat: now,
          exp: now + 3600
        };
        const jwt = await signJwt(payload);
        const sessionUuid = crypto.randomUUID();
        const refreshToken = crypto.randomUUID() + "." + crypto.randomUUID();
        const tokenHash = await sha256(refreshToken);
        const expiresAt = now + 30 * 24 * 3600;
        await env.DB.prepare(
          "INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
        ).bind(sessionUuid, user.id, tokenHash, expiresAt).run();
        return jsonResponse({
          token: jwt,
          refresh_token: refreshToken,
          user: {
            id: user.id,
            email: user.email,
            subscription_tier: user.subscription_tier,
            subscription_status: user.subscription_status
          }
        });
      } catch (err) {
        return jsonResponse({ error: err.message || "Login failed" }, 500);
      }
    }
    if (url.pathname === "/api/auth/refresh" && request.method === "POST") {
      try {
        const { refresh_token } = await request.json();
        if (!refresh_token) {
          return jsonResponse({ error: "Missing refresh token" }, 400);
        }
        const tokenHash = await sha256(refresh_token);
        const session = await env.DB.prepare(
          "SELECT * FROM user_sessions WHERE token_hash = ? AND is_revoked = 0 AND expires_at > ?"
        ).bind(tokenHash, Math.floor(Date.now() / 1e3)).first();
        if (!session) {
          return jsonResponse({ error: "Invalid or expired session" }, 401);
        }
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(session.user_id).first();
        if (!user) {
          return jsonResponse({ error: "User not found" }, 404);
        }
        const newRefreshToken = crypto.randomUUID() + "." + crypto.randomUUID();
        const newTokenHash = await sha256(newRefreshToken);
        const now = Math.floor(Date.now() / 1e3);
        const expiresAt = now + 30 * 24 * 3600;
        await env.DB.prepare(
          "UPDATE user_sessions SET token_hash = ?, expires_at = ? WHERE id = ?"
        ).bind(newTokenHash, expiresAt, session.id).run();
        const payload = {
          sub: user.id,
          email: user.email,
          subscription_tier: user.subscription_tier,
          subscription_status: user.subscription_status,
          iat: now,
          exp: now + 3600
        };
        const jwt = await signJwt(payload);
        return jsonResponse({
          token: jwt,
          refresh_token: newRefreshToken,
          user: {
            id: user.id,
            email: user.email,
            subscription_tier: user.subscription_tier,
            subscription_status: user.subscription_status
          }
        });
      } catch (err) {
        return jsonResponse({ error: err.message || "Token refresh failed" }, 500);
      }
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      try {
        const { refresh_token } = await request.json();
        if (refresh_token) {
          const tokenHash = await sha256(refresh_token);
          await env.DB.prepare(
            "UPDATE user_sessions SET is_revoked = 1 WHERE token_hash = ?"
          ).bind(tokenHash).run();
        }
        return jsonResponse({ success: true });
      } catch (err) {
        return jsonResponse({ error: err.message || "Logout failed" }, 500);
      }
    }
    if (url.pathname === "/api/settings") {
      const claims = await authenticate(request);
      if (!claims) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      if (request.method === "GET") {
        try {
          const settings = await env.DB.prepare(
            "SELECT settings_json FROM user_settings WHERE user_id = ?"
          ).bind(claims.sub).first();
          if (!settings) {
            return jsonResponse({ settings: {} });
          }
          return jsonResponse({ settings: JSON.parse(settings.settings_json) });
        } catch (err) {
          return jsonResponse({ error: err.message || "Failed to retrieve settings" }, 500);
        }
      }
      if (request.method === "POST") {
        try {
          const { settings } = await request.json();
          if (settings === void 0) {
            return jsonResponse({ error: "Missing settings payload" }, 400);
          }
          const now = Math.floor(Date.now() / 1e3);
          const settingsStr = JSON.stringify(settings);
          await env.DB.prepare(
            "INSERT INTO user_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at"
          ).bind(claims.sub, settingsStr, now).run();
          return jsonResponse({ success: true });
        } catch (err) {
          return jsonResponse({ error: err.message || "Failed to save settings" }, 500);
        }
      }
    }
    return env.ASSETS.fetch(request);
  }
};

// ../../Users/John/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../Users/John/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-T8uFLb/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../Users/John/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-T8uFLb/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
