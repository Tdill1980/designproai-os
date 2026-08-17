/**
 * grant-admin-access
 *
 * Grants admin role to a user by email. If the user doesn't exist,
 * creates the account first. Sends a password-setup link via Resend
 * (verified restyleproai.com domain) so the user can log in.
 * Uses service_role to bypass RLS.
 *
 * Previously sent a magic link via supabase.auth.signInWithOtp, which
 * relied on Supabase's rate-limited built-in SMTP and frequently
 * failed to deliver. Now uses auth.admin.generateLink + Resend, the
 * same reliable pipeline as send-password-reset.
 */

import { createExternalClient } from "../_shared/external-db.ts"
import { Resend } from "https://esm.sh/resend@2.0.0"

const resend = new Resend(Deno.env.get("RESEND_API_KEY"))

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function buildWelcomeEmailHtml(actionLink: string, email: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#000000;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#0d0d0d;border:1px solid #1a1a1a;border-radius:12px;overflow:hidden;">

        <tr><td style="padding:32px;background:linear-gradient(135deg,#2563eb,#a855f7);text-align:center;">
          <h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:700;letter-spacing:0.5px;">Welcome to RestylePro</h1>
          <p style="margin:6px 0 0;font-size:12px;color:#e0e7ff;">You've been granted admin access</p>
        </td></tr>

        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px;font-size:20px;color:#ffffff;font-weight:600;">Set your password to get started</h2>
          <p style="margin:0 0 20px;font-size:14px;color:#cccccc;line-height:1.6;">
            An admin account has been created for <strong style="color:#ffffff;">${email}</strong>.
            Click the button below to set your password and log in. This link expires in 1 hour.
          </p>

          <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr><td style="background:#00C7FF;border-radius:8px;">
              <a href="${actionLink}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#000000;text-decoration:none;">
                Set Password &amp; Log In
              </a>
            </td></tr>
          </table>

          <p style="margin:24px 0 0;font-size:12px;color:#888;line-height:1.6;">
            Or copy and paste this link into your browser:
          </p>
          <p style="margin:6px 0 0;font-size:11px;color:#00C7FF;word-break:break-all;line-height:1.5;">
            ${actionLink}
          </p>
        </td></tr>

        <tr><td style="padding:24px 32px;border-top:1px solid #1a1a1a;text-align:center;">
          <p style="margin:0;font-size:10px;color:#444;">
            Sent by <span style="color:#00C7FF;font-weight:600;">RestylePro</span> &middot; restyleproai.com
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { email } = await req.json()

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createExternalClient()
    const normalizedEmail = email.toLowerCase()

    // Step 1: Look up the user
    const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers()

    let userId: string | null = null

    if (!listError && usersData?.users) {
      const existingUser = usersData.users.find(
        (u: { email?: string }) => u.email?.toLowerCase() === normalizedEmail
      )
      if (existingUser) {
        userId = existingUser.id
        console.log(`Found existing user: ${userId}`)
      }
    }

    // Step 2: If user doesn't exist, create them
    if (!userId) {
      console.log(`User not found, creating account for ${email}`)
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
      })

      if (createError) {
        console.error('Error creating user:', createError)
        return new Response(
          JSON.stringify({ error: `Failed to create user: ${createError.message}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      userId = newUser.user.id
      console.log(`Created new user: ${userId}`)
    }

    // Step 3: Grant admin role (upsert)
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .upsert(
        { user_id: userId, role: 'admin' },
        { onConflict: 'user_id,role' }
      )

    if (roleError) {
      console.error('Error granting admin role:', roleError)
      return new Response(
        JSON.stringify({ error: `Failed to grant admin role: ${roleError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Admin role granted to ${email} (${userId})`)

    // Step 4: Generate a password-setup (recovery) link and email it
    // via Resend. This replaces the old signInWithOtp call, which
    // relied on Supabase's rate-limited built-in SMTP.
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: normalizedEmail,
      options: { redirectTo: 'https://restyleproai.com/reset-password' },
    })

    if (linkError || !linkData?.properties?.action_link) {
      console.error('generateLink error:', linkError)
      return new Response(
        JSON.stringify({
          success: true,
          warning: `Admin role granted but couldn't generate login link: ${linkError?.message || 'no action_link'}. User can request a reset at /reset-password-request.`,
          userId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const actionLink = linkData.properties.action_link

    const emailResponse = await resend.emails.send({
      from: 'RestylePro <noreply@restyleproai.com>',
      to: [normalizedEmail],
      subject: 'Welcome to RestylePro — set your password',
      html: buildWelcomeEmailHtml(actionLink, normalizedEmail),
      text: `Welcome to RestylePro

An admin account has been created for ${normalizedEmail}.
Open this link to set your password and log in (expires in 1 hour):

${actionLink}

— RestylePro
restyleproai.com`,
    })

    if (emailResponse.error) {
      console.error('Resend error:', emailResponse.error)
      return new Response(
        JSON.stringify({
          success: true,
          warning: `Admin role granted but email failed: ${emailResponse.error.message}. User can reset password at /reset-password-request.`,
          userId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Admin access granted to ${email}. Password-setup email sent via Resend — they should check their inbox.`,
        userId,
        messageId: emailResponse.data?.id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to grant admin access' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
