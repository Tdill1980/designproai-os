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
 * Authenticate the standalone DesignPro runtime without making a service-role
 * token impersonate an end-user JWT.
 *
 * The runtime already owns the standalone project's service credential. It
 * sends that credential in Authorization and names the authenticated request
 * owner in a separate header. The Edge handler accepts the owner header only
 * when the bearer is byte-for-byte the project's service credential, then
 * resolves the owner through Auth Admin before doing any work. A browser cannot
 * select another owner because it never receives the service credential.
 */
export async function resolveDesignProInternalCaller(
  req: Request,
): Promise<DesignProInternalCaller> {
  const ownerHeader = String(req.headers.get(OWNER_HEADER) || "").trim().toLowerCase();
  if (!ownerHeader) {
    return { internal: false, userId: null, userEmail: null };
  }

  const serviceRole = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  const bearer = String(req.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!serviceRole || bearer !== serviceRole || !UUID_PATTERN.test(ownerHeader)) {
    return {
      internal: false,
      userId: null,
      userEmail: null,
      rejection: jsonError(401, "designpro_internal_auth_invalid"),
    };
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRole,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data, error } = await admin.auth.admin.getUserById(ownerHeader);
  if (error || !data.user || data.user.id.toLowerCase() !== ownerHeader) {
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
