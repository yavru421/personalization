export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS Headers helper
    const origin = request.headers.get("Origin");
    const allowedOrigins = [
      "https://personalization.dondlingergc.com",
      "https://wazweather.dondlingergc.com",
      "http://localhost:5000",
      "https://localhost:5001"
    ];
    const corsOrigin = (origin && (allowedOrigins.includes(origin) || origin.endsWith(".dondlingergc.com")))
      ? origin
      : "https://wazweather.dondlingergc.com";

    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Credentials": "true",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Helper: JSON response
    const jsonResponse = (data, status = 200, customHeaders = {}) => {
      const headers = new Headers({
        "Content-Type": "application/json",
        ...corsHeaders,
      });
      for (const [key, value] of Object.entries(customHeaders)) {
        headers.set(key, value);
      }
      return new Response(JSON.stringify(data), {
        status,
        headers,
      });
    };

    // Helper: Base64 decoding/encoding
    const bufferToBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    const base64ToBuffer = (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0));

    // Helper: Cryptographic hashing using PBKDF2
    const hashPassword = async (password, saltBuffer = null) => {
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
          iterations: 100000,
          hash: "SHA-256",
        },
        baseKey,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        true,
        ["verify", "sign"]
      );
      const exported = await crypto.subtle.exportKey("raw", derivedKey);
      return {
        hash: bufferToBase64(exported),
        salt: bufferToBase64(saltBuffer),
      };
    };

    // Helper: JWT signing & verification using HS256
    const getJwtSecret = () => env.JWT_SECRET || 'antigravity-dev-jwt-secret-key-for-dondlingergc';
    
    const signJwt = async (payload) => {
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
    };

    const verifyJwt = async (token) => {
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
        const signatureBuf = base64ToBuffer(signature.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (signature.length % 4)) % 4));
        const valid = await crypto.subtle.verify(
          "HMAC",
          key,
          signatureBuf,
          new TextEncoder().encode(`${header}.${payload}`)
        );
        if (!valid) return null;
        const decodedPayload = JSON.parse(new TextDecoder().decode(base64ToBuffer(payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payload.length % 4)) % 4))));
        if (decodedPayload.exp && Date.now() / 1000 > decodedPayload.exp) {
          return null; // Expired
        }
        return decodedPayload;
      } catch (err) {
        return null;
      }
    };

    const sha256 = async (text) => {
      const msgBuffer = new TextEncoder().encode(text);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
      return bufferToBase64(hashBuffer);
    };

    // Helper to get cookie value
    const getCookie = (cookieHeader, name) => {
      if (!cookieHeader) return null;
      const cookies = cookieHeader.split(";");
      for (let cookie of cookies) {
        cookie = cookie.trim();
        if (cookie.startsWith(name + "=")) {
          return cookie.substring(name.length + 1);
        }
      }
      return null;
    };

    // Authenticate user via Cookie or Authorization Header
    const authenticate = async (req) => {
      const cookieHeader = req.headers.get("Cookie");
      const dgcSession = getCookie(cookieHeader, "dgc-session");
      if (dgcSession) {
        const claims = await verifyJwt(dgcSession);
        if (claims) return claims;
      }
      const authHeader = req.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
      const token = authHeader.substring(7);
      return await verifyJwt(token);
    };

    // Routing
    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      try {
        const { email, password } = await request.json();
        if (!email || !password) {
          return jsonResponse({ error: "Missing email or password" }, 400);
        }
        const { hash, salt } = await hashPassword(password);
        const userId = crypto.randomUUID();

        await env.DB.prepare(
          "INSERT INTO users (id, email, password_hash, salt, subscription_tier, subscription_status, credit_balance_cents) VALUES (?, ?, ?, ?, 'free', 'inactive', 1000)"
        ).bind(userId, email, hash, salt).run();

        // Generate signed JWT (exp: 1 hour)
        const now = Math.floor(Date.now() / 1000);
        const payload = {
          sub: userId,
          email: email,
          subscription_tier: "free",
          subscription_status: "inactive",
          credit_balance_cents: 1000,
          iat: now,
          exp: now + 3600,
        };
        const jwt = await signJwt(payload);

        return jsonResponse(
          { success: true, userId, token: jwt, creditBalanceCents: 1000 },
          200,
          { "Set-Cookie": `dgc-session=${jwt}; Domain=.dondlingergc.com; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000` }
        );
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

        // Generate signed JWT (exp: 1 hour)
        const now = Math.floor(Date.now() / 1000);
        const payload = {
          sub: user.id,
          email: user.email,
          subscription_tier: user.subscription_tier,
          subscription_status: user.subscription_status,
          credit_balance_cents: user.credit_balance_cents || 0,
          iat: now,
          exp: now + 3600,
        };
        const jwt = await signJwt(payload);

        // Generate Session & Refresh Token
        const sessionUuid = crypto.randomUUID();
        const refreshToken = crypto.randomUUID() + "." + crypto.randomUUID();
        const tokenHash = await sha256(refreshToken);
        const expiresAt = now + (30 * 24 * 3600); // 30 days expiration

        await env.DB.prepare(
          "INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
        ).bind(sessionUuid, user.id, tokenHash, expiresAt).run();

        return jsonResponse({
          success: true,
          token: jwt,
          refresh_token: refreshToken,
          creditBalanceCents: user.credit_balance_cents || 0,
          user: {
            id: user.id,
            email: user.email,
            subscription_tier: user.subscription_tier,
            subscription_status: user.subscription_status,
            credit_balance_cents: user.credit_balance_cents || 0,
          }
        }, 200, {
          "Set-Cookie": `dgc-session=${jwt}; Domain=.dondlingergc.com; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`
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
        ).bind(tokenHash, Math.floor(Date.now() / 1000)).first();

        if (!session) {
          return jsonResponse({ error: "Invalid or expired session" }, 401);
        }

        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(session.user_id).first();
        if (!user) {
          return jsonResponse({ error: "User not found" }, 404);
        }

        // Rotate Refresh Token
        const newRefreshToken = crypto.randomUUID() + "." + crypto.randomUUID();
        const newTokenHash = await sha256(newRefreshToken);
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + (30 * 24 * 3600);

        await env.DB.prepare(
          "UPDATE user_sessions SET token_hash = ?, expires_at = ? WHERE id = ?"
        ).bind(newTokenHash, expiresAt, session.id).run();

        // Generate new JWT
        const payload = {
          sub: user.id,
          email: user.email,
          subscription_tier: user.subscription_tier,
          subscription_status: user.subscription_status,
          credit_balance_cents: user.credit_balance_cents || 0,
          iat: now,
          exp: now + 3600,
        };
        const jwt = await signJwt(payload);

        return jsonResponse({
          success: true,
          token: jwt,
          refresh_token: newRefreshToken,
          creditBalanceCents: user.credit_balance_cents || 0,
          user: {
            id: user.id,
            email: user.email,
            subscription_tier: user.subscription_tier,
            subscription_status: user.subscription_status,
            credit_balance_cents: user.credit_balance_cents || 0,
          }
        }, 200, {
          "Set-Cookie": `dgc-session=${jwt}; Domain=.dondlingergc.com; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`
        });
      } catch (err) {
        return jsonResponse({ error: err.message || "Token refresh failed" }, 500);
      }
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      try {
        let refresh_token = null;
        try {
          const body = await request.json();
          refresh_token = body?.refresh_token;
        } catch (e) {
          // Body parsing could fail if empty request, that's fine
        }
        if (refresh_token) {
          const tokenHash = await sha256(refresh_token);
          await env.DB.prepare(
            "UPDATE user_sessions SET is_revoked = 1 WHERE token_hash = ?"
          ).bind(tokenHash).run();
        }
        return jsonResponse(
          { success: true },
          200,
          { "Set-Cookie": "dgc-session=; Domain=.dondlingergc.com; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT" }
        );
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
          if (settings === undefined) {
            return jsonResponse({ error: "Missing settings payload" }, 400);
          }
          const now = Math.floor(Date.now() / 1000);
          const settingsStr = JSON.stringify(settings);

          await env.DB.prepare(
            "INSERT INTO user_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at"
          ).bind(claims.sub, settingsStr, now).run();

          // Sync to Cloudflare KV Edge Cache
          if (env.IDENTITY_CACHE) {
            ctx.waitUntil(env.IDENTITY_CACHE.put(`settings:${claims.sub}`, settingsStr));
          }

          return jsonResponse({ success: true });
        } catch (err) {
          return jsonResponse({ error: err.message || "Failed to save settings" }, 500);
        }
      }
    }

    if (url.pathname === "/api/eval" && request.method === "POST") {
      const claims = await authenticate(request);
      if (!claims) {
        return jsonResponse({ error: "Unauthorized. Account required to access Edge Inference Router." }, 401);
      }

      // Check user credit balance in D1
      const EVAL_COST_CREDITS = 50;
      const user = await env.DB.prepare("SELECT credit_balance_cents FROM users WHERE id = ?").bind(claims.sub).first();
      const currentCredits = user ? (user.credit_balance_cents || 0) : 0;

      if (currentCredits < EVAL_COST_CREDITS) {
        return jsonResponse({ error: `Insufficient credits. Edge evaluation requires ${EVAL_COST_CREDITS} units. Current balance: ${currentCredits} units.` }, 402);
      }

      try {
        const { targetUrl } = await request.json();
        if (!targetUrl) {
          return jsonResponse({ error: "Missing targetUrl parameter" }, 400);
        }

        // Fetch target URL content
        let pageText = "";
        try {
          const pageRes = await fetch(targetUrl, {
            headers: { "User-Agent": "Dondlinger-Edge-Inference-Evaluator/1.0" }
          });
          const rawHtml = await pageRes.text();
          pageText = rawHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
                             .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
                             .replace(/<[^>]+>/g, " ")
                             .replace(/\s+/g, " ")
                             .trim()
                             .substring(0, 3000);
        } catch (e) {
          return jsonResponse({ error: `Failed to fetch URL ${targetUrl}: ${e.message}` }, 400);
        }

        // Run Workers AI Inference if AI binding exists, or fallback structured analysis
        let evalResult = "";
        if (env.AI) {
          try {
            const aiRes = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
              messages: [
                { role: "system", content: "You are a Principal Web Architect & Security Evaluator. Analyze the provided webpage text content. Provide a concise evaluation covering: 1) Executive Summary, 2) Technical Stack & Architecture, 3) Performance & UX Quality, and 4) Strategic Recommendations." },
                { role: "user", content: `URL: ${targetUrl}\n\nWebpage Content Snippet:\n${pageText}` }
              ]
            });
            evalResult = aiRes.response || JSON.stringify(aiRes);
          } catch (e) {
            evalResult = `### Edge Evaluation of ${targetUrl}\n\n**Raw Content Length**: ${pageText.length} characters\n**Status**: Successfully fetched page content via Cloudflare Edge Worker.\n\n**Extracted Content Snippet**:\n> ${pageText.substring(0, 500)}...\n\n*Note*: Workers AI binding error: ${e.message}`;
          }
        } else {
          evalResult = `### Edge Evaluation of ${targetUrl}\n\n**Target URL**: ${targetUrl}\n**Page Content Length**: ${pageText.length} bytes extracted via Edge Worker.\n\n**Automated Inspection Summary**:\n- **Domain**: ${new URL(targetUrl).hostname}\n- **Edge Response**: HTTP 200 OK\n- **Extracted Text Preview**:\n> ${pageText.substring(0, 500)}...\n\n*(Connect \`AI\` binding in wrangler.toml to enable full Llama 3.3 70B Workers AI synthesis)*`;
        }

        // Deduct credits & record transaction
        const newBalance = currentCredits - EVAL_COST_CREDITS;
        await env.DB.prepare("UPDATE users SET credit_balance_cents = ? WHERE id = ?").bind(newBalance, claims.sub).run();
        
        try {
          const ledgerId = crypto.randomUUID();
          await env.DB.prepare("INSERT INTO credit_ledger (id, user_id, amount_cents, description, created_at) VALUES (?, ?, ?, ?, ?)").bind(ledgerId, claims.sub, -EVAL_COST_CREDITS, `Edge URL Evaluation: ${targetUrl}`, Math.floor(Date.now() / 1000)).run();
        } catch(e) {}

        return jsonResponse({
          success: true,
          targetUrl,
          evaluation: evalResult,
          timestamp: new Date().toISOString(),
          evaluatedBy: claims.email,
          creditsDeducted: EVAL_COST_CREDITS,
          remainingCredits: newBalance
        });
      } catch (err) {
        return jsonResponse({ error: err.message || "Evaluation failed" }, 500);
      }
    }



    // Fallback: Static Assets with Edge HTMLRewriter Injection
    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get("content-type") || "";

    if (contentType.includes("text/html")) {
      const claims = await authenticate(request);
      let sessionData = claims ? { id: claims.sub, email: claims.email, tier: claims.subscription_tier || "free" } : null;
      let settingsData = {};

      if (claims && env.IDENTITY_CACHE) {
        const cachedSettings = await env.IDENTITY_CACHE.get(`settings:${claims.sub}`);
        if (cachedSettings) {
          try { settingsData = JSON.parse(cachedSettings); } catch(e) {}
        } else {
          try {
            const dbSettings = await env.DB.prepare("SELECT settings_json FROM user_settings WHERE user_id = ?").bind(claims.sub).first();
            if (dbSettings) {
              settingsData = JSON.parse(dbSettings.settings_json);
              ctx.waitUntil(env.IDENTITY_CACHE.put(`settings:${claims.sub}`, dbSettings.settings_json));
            }
          } catch(e) {}
        }
      }

      const injectionScript = `<script>
        window.__USER_SESSION__ = ${JSON.stringify(sessionData)};
        window.__USER_SETTINGS__ = ${JSON.stringify(settingsData)};
      </script>`;

      return new HTMLRewriter()
        .on("head", {
          element(el) {
            el.append(injectionScript, { html: true });
          }
        })
        .transform(assetResponse);
    }

    return assetResponse;
  },
};

