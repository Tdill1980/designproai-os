import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OWNER_HEADER = "x-designpro-owner-id";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DesignProInternalCaller = {
  internal: boolean;
  userId: string | null;
  userEmail: string | null;
  rejection?: Response;
};

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Authenticate the standalone DesignPro runtime without making a server API
 * key impersonate an end-user JWT.
 *
 * The runtime sends its DesignProAI project key in the standard `apikey`
 * header and names the authenticated request owner separately. The handler
 * proves the key has Auth Admin privilege inside this exact project by resolving
 * that owner before doing any work. A publishable/browser key cannot pass that
 * check, and the server key never crosses the browser boundary.
 *
 * This supports both legacy service_role JWT keys and current sb_secret keys.
 * It deliberately does not compare against SUPABASE_SERVICE_ROLE_KEY: key
 * rotation and the new key system can make two valid server credentials differ
 * byte-for-byte even though both are scoped to the same project.
 */
export async function resolveDesignProInternalCaller(
  req: Request,
): Promise<DesignProInternalCaller> {
  const ownerHeader = String(req.headers.get(OWNER_HEADER) || "").trim().toLowerCase();
  if (!ownerHeader) {
    return { internal: false, userId: null, userEmail: null };
  }

  const serverKey = String(req.headers.get("apikey") || "").trim();
  if (serverKey.length < 32 || !UUID_PATTERN.test(ownerHeader)) {
    return {
      internal: false,
      userId: null,
      userEmail: null,
      rejection: jsonError(401, "designpro_internal_auth_invalid"),
    };
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serverKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data, error } = await admin.auth.admin.getUserById(ownerHeader);
  if (error) {
    return {
      internal: false,
      userId: null,
      userEmail: null,
      rejection: jsonError(401, "designpro_internal_auth_invalid"),
    };
  }
  if (!data.user || data.user.id.toLowerCase() !== ownerHeader) {
    return {
      internal: false,
      userId: null,
      userEmail: null,
      rejection: jsonError(401, "designpro_internal_owner_invalid"),
    };
  }

  return {
    internal: true,
    userId: data.user.id,
    userEmail: data.user.email ?? null,
  };
}

export { OWNER_HEADER as DESIGNPRO_OWNER_HEADER };
