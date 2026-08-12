/**
 * ShareDesignButton — "Share This Design" popover with copy link, email, social, download
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Share2, Link2, Mail, Facebook, Instagram, Download, Check } from "lucide-react";
import { toast } from "sonner";
import { buildShareUrl } from "@/lib/utm";
import { cn } from "@/lib/utils";

interface ShareDesignButtonProps {
  /** Share type for the /share/:type/:id route */
  shareType: "render" | "panel" | "pattern" | "fadewrap" | "vault";
  /** ID of the item to share */
  shareId: string;
  /** Design/color name for share text */
  designName: string;
  /** Vehicle name for share text */
  vehicleName?: string;
  /** Direct image URL for download */
  imageUrl?: string;
  /** Button variant */
  variant?: "ghost" | "outline" | "default" | "secondary";
  /** Button size */
  size?: "sm" | "icon" | "default" | "lg";
  /** Extra classes */
  className?: string;
  /** Show label text or icon only */
  iconOnly?: boolean;
  /** Custom label text (default: "Share") */
  label?: string;
}

export function ShareDesignButton({
  shareType,
  shareId,
  designName,
  vehicleName,
  imageUrl,
  variant = "ghost",
  size = "sm",
  className,
  iconOnly = false,
  label = "Share",
}: ShareDesignButtonProps) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  // Strip view suffixes from IDs (e.g., "uuid-hood_detail" → "uuid")
  const cleanId = shareId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || shareId;

  const sharePath = `/share/${shareType}/${cleanId}`;
  const shareUrl = buildShareUrl("web", sharePath);
  const shareText = vehicleName
    ? `Check out this ${designName} wrap on a ${vehicleName}!`
    : `Check out this ${designName} vehicle wrap design!`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const handleEmail = () => {
    const subject = encodeURIComponent(`${designName} - Vehicle Wrap Design`);
    const body = encodeURIComponent(`${shareText}\n\nView it here: ${shareUrl}\n\nCreated with RestyleProAI™`);
    window.open(`mailto:?subject=${subject}&body=${body}`);
    setOpen(false);
  };

  const handleFacebook = () => {
    const fbUrl = buildShareUrl("facebook", sharePath);
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(fbUrl)}&quote=${encodeURIComponent(shareText)}`,
      "_blank",
      "width=600,height=400"
    );
    setOpen(false);
  };

  const handleInstagram = () => {
    if (navigator.share && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      navigator.share({ title: designName, text: shareText, url: shareUrl }).catch(() => {});
    } else {
      toast.info("Download the image and post it to Instagram from your phone!");
      if (imageUrl) handleDownload();
    }
    setOpen(false);
  };

  const handleNativeShare = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({ title: designName, text: shareText, url: shareUrl });
    } catch {
      // user cancelled
    }
    setOpen(false);
  };

  const handleDownload = async () => {
    if (!imageUrl) return;
    try {
      const resp = await fetch(imageUrl, { mode: "cors" });
      if (!resp.ok) { window.open(imageUrl, "_blank"); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(designName || "design").replace(/\s+/g, "-")}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Download started");
    } catch {
      window.open(imageUrl, "_blank");
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={cn("gap-1.5", className)}
          title="Share This Design"
        >
          <Share2 className="h-4 w-4" />
          {!iconOnly && <span>{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end" side="top">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground px-2 py-1">Share This Design</p>
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Link2 className="h-4 w-4" />}
            {copied ? "Copied!" : "Copy Link"}
          </button>
          <button
            onClick={handleEmail}
            className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left"
          >
            <Mail className="h-4 w-4" />
            Email
          </button>
          <button
            onClick={handleFacebook}
            className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left"
          >
            <Facebook className="h-4 w-4 text-blue-500" />
            Facebook
          </button>
          <button
            onClick={handleInstagram}
            className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left"
          >
            <Instagram className="h-4 w-4 text-pink-500" />
            Instagram
          </button>
          {typeof navigator !== "undefined" && navigator.share && (
            <button
              onClick={handleNativeShare}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left"
            >
              <Share2 className="h-4 w-4 text-cyan-400" />
              More...
            </button>
          )}
          {imageUrl && (
            <>
              <div className="border-t border-border my-1" />
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left"
              >
                <Download className="h-4 w-4" />
                Download Image
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
