import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Share2, Instagram, Facebook, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildShareUrl } from "@/lib/utm";
import { trackShare } from "@/lib/analytics";

interface SocialShareButtonsProps {
  images: string[];
  vehicleName: string;
  designName: string;
  className?: string;
}

export const SocialShareButtons = ({ 
  images, 
  vehicleName, 
  designName,
  className 
}: SocialShareButtonsProps) => {
  const { toast } = useToast();
  const [isSharing, setIsSharing] = useState(false);

  const handleWebShare = async () => {
    if (!navigator.share) {
      toast({
        title: "Share not supported",
        description: "Your browser doesn't support native sharing. Use the download button instead.",
        variant: "destructive"
      });
      return;
    }

    try {
      setIsSharing(true);
      
      // Fetch the first image as a blob
      const response = await fetch(images[0]);
      const blob = await response.blob();
      const file = new File([blob], `${vehicleName}-${designName}-360.jpg`, { type: 'image/jpeg' });

      const shareUrl = buildShareUrl("web", window.location.pathname);
      await navigator.share({
        title: `${vehicleName} - ${designName}`,
        text: `Check out this 360° view of ${vehicleName} in ${designName}! Created with RestyleProAI™ Vehicle Wrap Design Suite`,
        url: shareUrl,
        files: [file]
      });
      trackShare("web", "360_spin");

      toast({
        title: "Shared successfully!",
        description: "Your 360° spin has been shared"
      });
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        toast({
          title: "Share failed",
          description: error.message,
          variant: "destructive"
        });
      }
    } finally {
      setIsSharing(false);
    }
  };

  const handleInstagramShare = () => {
    trackShare("instagram", "360_spin");
    // Instagram doesn't support direct web sharing, so we'll use Web Share API on mobile
    // or show instructions on desktop
    if (navigator.share && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      handleWebShare();
    } else {
      toast({
        title: "Instagram Sharing",
        description: "Download the 360° spin and post it to Instagram from your phone!",
        duration: 5000
      });
      handleDownloadAll();
    }
  };

  const handleFacebookShare = () => {
    const shareUrl = encodeURIComponent(buildShareUrl("facebook", window.location.pathname));
    const shareText = encodeURIComponent(`Check out this 360° view of ${vehicleName} in ${designName}!`);

    // Open Facebook share dialog
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}&quote=${shareText}`,
      '_blank',
      'width=600,height=400'
    );
    trackShare("facebook", "360_spin");

    toast({
      title: "Facebook share opened",
      description: "Upload your downloaded 360° images to the post!"
    });
  };

  const handleTikTokShare = () => {
    trackShare("tiktok", "360_spin");
    // TikTok doesn't support direct web sharing
    // We'll provide instructions to download and upload
    toast({
      title: "TikTok Sharing",
      description: "Download the 360° spin and upload it to TikTok from your phone! Use hashtag #RestylePro",
      duration: 6000
    });
    handleDownloadAll();
  };

  const handleDownloadAll = async () => {
    try {
      setIsSharing(true);
      
      // Download all 360° images as a zip or individually
      for (let i = 0; i < images.length; i++) {
        const response = await fetch(images[i]);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${vehicleName}-${designName}-360-angle-${i * 30}.jpg`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        // Small delay between downloads to avoid browser blocking
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      toast({
        title: "Download started!",
        description: `Downloading all ${images.length} angles for your 360° spin`
      });
    } catch (error) {
      toast({
        title: "Download failed",
        description: "Please try again",
        variant: "destructive"
      });
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {/* Web Share API (Mobile) */}
      {navigator.share && (
        <Button
          onClick={handleWebShare}
          disabled={isSharing}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <Share2 className="w-4 h-4" />
          Share
        </Button>
      )}

      {/* Instagram */}
      <Button
        onClick={handleInstagramShare}
        disabled={isSharing}
        variant="outline"
        size="sm"
        className="gap-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0"
      >
        <Instagram className="w-4 h-4" />
        Instagram
      </Button>

      {/* Facebook */}
      <Button
        onClick={handleFacebookShare}
        disabled={isSharing}
        variant="outline"
        size="sm"
        className="gap-2 bg-blue-600 hover:bg-blue-700 text-white border-0"
      >
        <Facebook className="w-4 h-4" />
        Facebook
      </Button>

      {/* TikTok */}
      <Button
        onClick={handleTikTokShare}
        disabled={isSharing}
        variant="outline"
        size="sm"
        className="gap-2 bg-black hover:bg-gray-900 text-white border-0"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
        </svg>
        TikTok
      </Button>

      {/* Download All */}
      <Button
        onClick={handleDownloadAll}
        disabled={isSharing}
        variant="outline"
        size="sm"
        className="gap-2"
      >
        <Download className="w-4 h-4" />
        Download All ({images.length})
      </Button>
    </div>
  );
};
