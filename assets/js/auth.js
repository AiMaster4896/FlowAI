// assets/js/auth.js
import { supabase } from "./supabase-client.js";

/**
 * In-memory cache of the current session's resolved identity.
 * { user, profile, organisationId, role, mustChangePassword }
 */
let currentIdentity = null;

export function getIdentity() {
  return currentIdentity;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw mapAuthError(error);
  }
  await resolveIdentity();
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
  currentIdentity = null;
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + "/#/reset-password",
  });
  if (error) throw mapAuthError(error);
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw mapAuthError(error);

  // Clear the forced-change flag once the password is updated.
  if (currentIdentity?.profile?.id) {
    await supabase
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", currentIdentity.profile.id);
    currentIdentity.mustChangePassword = false;
  }
}

/**
 * Reads the signed-in user's profile + active organisation membership + role.
 * This is what drives which sidebar items and routes are visible — never
 * trust anything the browser claims about role, only what's actually in
 * organisation_members.
 */
export async function resolveIdentity() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    currentIdentity = null;
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError) throw profileError;

  const { data: membership, error: memberError } = await supabase
    .from("organisation_members")
    .select("organisation_id, role, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (memberError) throw memberError;

  const isPlatformAdmin = !!profile.is_platform_admin;
  const impersonation = isPlatformAdmin ? getImpersonation() : null;
  const resolvedOrgId = impersonation?.organisationId ?? membership?.organisation_id ?? null;

  let staffClientListAccess = true;
  if (resolvedOrgId) {
    const { data: orgSettings } = await supabase
      .from("organisation_settings")
      .select("staff_client_list_access")
      .eq("organisation_id", resolvedOrgId)
      .maybeSingle();
    staffClientListAccess = orgSettings?.staff_client_list_access ?? true;
  }

  currentIdentity = {
    user,
    profile,
    organisationId: resolvedOrgId,
    role: impersonation ? "firm_admin" : (membership?.role ?? null),
    mustChangePassword: !!profile.must_change_password,
    isPlatformAdmin,
    impersonating: impersonation,
    staffClientListAccess,
  };

  return currentIdentity;
}

// Impersonation state lives in sessionStorage — cleared automatically when
// the tab closes, so it can never silently persist into a later session.
const IMPERSONATION_KEY = "auditflow_impersonation";

export function getImpersonation() {
  try {
    const raw = sessionStorage.getItem(IMPERSONATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function startImpersonation(organisationId, organisationName) {
  await supabase.from("platform_impersonation_log").insert({
    platform_user_id: getIdentity()?.user?.id,
    organisation_id: organisationId,
  });
  sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify({ organisationId, organisationName }));
}

export async function endImpersonation() {
  const current = getImpersonation();
  if (current) {
    await supabase
      .from("platform_impersonation_log")
      .update({ ended_at: new Date().toISOString() })
      .eq("organisation_id", current.organisationId)
      .eq("platform_user_id", getIdentity()?.user?.id)
      .is("ended_at", null);
  }
  sessionStorage.removeItem(IMPERSONATION_KEY);
}


function mapAuthError(error) {
  const msg = (error.message || "").toLowerCase();
  if (msg.includes("invalid login credentials")) {
    return new Error("Invalid email or password");
  }
  if (msg.includes("email not confirmed")) {
    return new Error("Please verify your email");
  }
  return new Error("Sign in failed. Please try again.");
}

// Keep identity in sync with auth state changes (token refresh, sign out elsewhere, etc.)
supabase.auth.onAuthStateChange(async (event) => {
  if (event === "SIGNED_OUT") {
    currentIdentity = null;
  } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
    if (!currentIdentity) {
      try {
        await resolveIdentity();
      } catch (e) {
        console.error("Failed to resolve identity after auth change", e);
      }
    }
  }
});
