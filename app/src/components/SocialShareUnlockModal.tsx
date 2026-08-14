/**
 * SocialShareUnlockModal — claim 1 free render in exchange for posting
 * DesignProAI on a social platform. v1 is honor-system + UTM tracking
 * (no OAuth verification of the actual post — that's a v2 polish item
 * if abuse becomes a problem).
 *
 * Flow:
 *   1. User picks a platform (Instagram / TikTok / X / Facebook).
 *   2. We open the platform's share intent in a new tab AND copy a
 *      UTM-tagged share URL to the clipboard so they can paste it.
 *   3. They confirm "I posted!" — we call useFreemiumLimits's
 *      unlockSocialShare(platform, email?) which credits +1 render.
 *
 * Email is optional. If provided, the share is attributed to that
 * email in email_subscribers so we can audit who actually shared if
 * we ever care about real verification.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Copy, ExternalLink, Gift, Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  useFreemiumLimits,
  type SocialSharePlatform,
} from "@/hooks/useFreemiumLimits";

const SHARE_TEXT =
  "I just designed a custom vehicle wrap with DesignProAI in 60 seconds. Wild. Try it free →";
const BASE_URL = "https://designproai.com/?utm_source=social_share";

interface PlatformMeta {
  id: SocialSharePlatform;
  label: string;
  shareUrl: (text: string, url: string) => string;
  // Brand palette per platform — kept simple (no extra deps).
  buttonClass: string;
}

const PLATFORMS: PlatformMeta[] = [
  {
    id: "instagram",
    label: "Instagram",
    // Instagram has no web share intent — we copy the link + open ig.com.
    shareUrl: () => "https://www.instagram.com/",
    buttonClass:
      "bg-gradient-to-r from-fuchsia-500 via-pink-500 to-orange-400 text-white border-0",
  },
  {
    id: "tiktok",
    label: "TikTok",
    // TikTok also no web share — we copy the link + open tiktok.com.
    shareUrl: () => "https://www.tiktok.com/",
    buttonClass: "bg-black text-white border border-white/20",
  },
  {
    id: "x",
    label: "X (Twitter)",
    shareUrl: (text, url) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    buttonClass: "bg-zinc-900 text-white border border-zinc-700",
  },
  {
    id: "facebook",
    label: "Facebook",
    shareUrl: (_text, url) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    buttonClass: "bg-[#1877F2] text-white border-0",
  },
];

interface SocialShareUnlockModalProps {
  open: boolean;
  onClose: () => void;
}

export const SocialShareUnlockModal = ({
  open,
  onClose,
}: SocialShareUnlockModalProps) => {
  const { unlockSocialShare, socialShareUnlocked } = useFreemiumLimits();
  const [picked, setPicked] = useState<SocialSharePlatform | null>(null);
  const [shared, setShared] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleShareClick = async (platform: PlatformMeta) => {
    setPicked(platform.id);
    const url = `${BASE_URL}_${platform.id}`;

    // Always copy the link so the user can paste it on platforms without
    // a web share intent (Instagram + TikTok).
    try {
      await navigator.clipboard.writeText(`${SHARE_TEXT} ${url}`);
      toast({
        title: "Link copied",
        description: `Paste it into your ${platform.label} post.`,
      });
    } catch {
      // Clipboard blocked — proceed silently
    }

    // Open the platform.
    const intent = platform.shareUrl(SHARE_TEXT, url);
    window.open(intent, "_blank", "noopener,noreferrer");
    setShared(true);
  };

  const handleConfirm = async () => {
    if (!picked) return;
    setSubmitting(true);
    try {
      const result = await unlockSocialShare(picked, email || undefined);
      if (result.success) {
        toast({
          title: "🎉 1 free render unlocked",
          description: result.alreadyClaimed
            ? "You'd already claimed this — you're good to go."
            : "Thanks for sharing. Render away.",
        });
        onClose();
      } else {
        toast({
          title: "Couldn't unlock",
          description: result.error || "Try again.",
          variant: "destructive",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setPicked(null);
    setShared(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center mb-2">
            <div className="relative">
              <Gift className="h-12 w-12 text-cyan-400" />
              <Sparkles className="h-5 w-5 text-yellow-400 absolute -top-1 -right-1" />
            </div>
          </div>
          <DialogTitle className="text-center text-2xl">
            Share us · Get 1 free render
          </DialogTitle>
          <DialogDescription className="text-center pt-2">
            One-time gift. Pick your platform, post us, claim your render.
          </DialogDescription>
        </DialogHeader>

        {socialShareUnlocked ? (
          <div className="py-8 text-center space-y-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
            <p className="text-sm text-muted-foreground">
              You've already claimed your free share render. Thanks!
            </p>
            <Button onClick={onClose} variant="outline">
              Close
            </Button>
          </div>
        ) : !shared ? (
          <div className="space-y-3 py-3">
            <p className="text-xs text-center text-muted-foreground">
              Tap a platform — we'll copy the post text + open the app.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PLATFORMS.map((p) => (
                <Button
                  key={p.id}
                  onClick={() => handleShareClick(p)}
                  className={`${p.buttonClass} font-bold`}
                  size="lg"
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] text-muted-foreground">
              <div className="flex items-start gap-2">
                <Copy className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Link copies to your clipboard. Paste into your Story, Reel, or post.
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-3">
            <Badge className="self-start bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              <ExternalLink className="w-3 h-3 mr-1" />
              {picked} opened
            </Badge>
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm">
              <p className="font-semibold text-white mb-1">Once you've posted:</p>
              <p className="text-xs text-muted-foreground">
                Tap "I posted" below and your render unlocks instantly. Optional: drop your email so we can send your render queue receipt.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="share-email" className="text-xs">
                Email (optional)
              </Label>
              <Input
                id="share-email"
                type="email"
                placeholder="you@yourshop.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={reset}
                className="flex-1"
                disabled={submitting}
              >
                Pick again
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={submitting}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white border-0 hover:opacity-90"
              >
                {submitting ? "Unlocking…" : "I posted · unlock"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
