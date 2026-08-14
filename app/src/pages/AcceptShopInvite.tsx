/**
 * AcceptShopInvite — /invite/:token
 *
 * Landing page for a shop invite link. Flow:
 *   1. If not signed in, render a choice card: "Sign in" or "Create account".
 *      Both paths preserve `location.state.from = /invite/:token` so
 *      Login / Signup know where to return after auth completes.
 *   2. If signed in, call `accept-shop-invite` edge function with the token.
 *      - Success: refresh OrganizationContext, switch to the joined shop,
 *        navigate to /dashboard.
 *      - Failure: show error with a friendly remediation (wrong email,
 *        already accepted, expired, seat limit).
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, Users, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { toast } from 'sonner';

type Phase = 'checking' | 'needs_auth' | 'accepting' | 'success' | 'error';

const AcceptShopInvite = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { refresh, switchShop } = useOrganization();

  const [phase, setPhase] = useState<Phase>('checking');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [joinedShopName, setJoinedShopName] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPhase('error');
      setErrorMessage('Missing invite token');
      return;
    }

    let cancelled = false;

    const run = async () => {
      // 1. Check auth state
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        if (!cancelled) setPhase('needs_auth');
        return;
      }

      // 2. Call accept-shop-invite edge function
      if (!cancelled) setPhase('accepting');

      try {
        const { data, error } = await supabase.functions.invoke(
          'accept-shop-invite',
          {
            body: { token },
          },
        );

        if (cancelled) return;

        if (error) {
          // supabase.functions.invoke() wraps non-2xx as FunctionsHttpError;
          // the body was parsed into data already.
          const serverMsg = (data as { error?: string } | null)?.error;
          throw new Error(serverMsg || error.message || 'Failed to accept invite');
        }

        if (!data?.success) {
          throw new Error(data?.error || 'Failed to accept invite');
        }

        const joinedShopId = data.shop_id as string;
        const shopName = (data.shop_name as string) || 'your new shop';

        setJoinedShopName(shopName);
        setPhase('success');

        // Reload memberships so OrganizationContext knows about the new shop,
        // then switch currentShop so the dashboard opens with the inviting
        // shop active.
        await refresh();
        switchShop(joinedShopId);

        toast.success(`Joined ${shopName}`);

        // Give the user a moment to see the success card before redirect.
        setTimeout(() => {
          if (!cancelled) navigate('/dashboard', { replace: true });
        }, 1500);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[AcceptShopInvite] failed:', err);
        setErrorMessage(msg);
        setPhase('error');
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [token, navigate, refresh, switchShop]);

  const fromPath = `/invite/${token ?? ''}`;

  // -----------------------------------------------------------------------
  // Render states
  // -----------------------------------------------------------------------
  if (phase === 'checking' || phase === 'accepting') {
    return (
      <Shell title="Accepting invite">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {phase === 'checking'
                ? 'Checking your invite...'
                : 'Adding you to the shop...'}
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (phase === 'needs_auth') {
    return (
      <Shell title="You've been invited">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Join a shop on DesignProAI
            </CardTitle>
            <CardDescription>
              Sign in with the email you were invited at, or create a free
              account to accept this invite.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button asChild>
              <Link to="/login" state={{ from: fromPath }}>
                Sign in
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/signup" state={{ from: fromPath }}>
                Create an account
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2">
              The invite is tied to one email address. If you sign in with a
              different account, we won't be able to attach it to this shop.
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (phase === 'success') {
    return (
      <Shell title="Invite accepted">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
            <p className="text-lg font-semibold">
              Welcome to {joinedShopName ?? 'the team'}
            </p>
            <p className="text-sm text-muted-foreground">
              Taking you to your dashboard...
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // error phase
  return (
    <Shell title="Invite error">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            We couldn't accept this invite
          </CardTitle>
          <CardDescription>
            {errorMessage ?? 'Something went wrong.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button variant="outline" asChild>
            <Link to="/dashboard">Go to dashboard</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/login">Sign in with a different account</Link>
          </Button>
        </CardContent>
      </Card>
    </Shell>
  );
};

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-16">
      <Helmet>
        <title>{title} — DesignProAI</title>
      </Helmet>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

export default AcceptShopInvite;
