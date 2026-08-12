/**
 * WpwTeamCards — Founder + Design + Marketing team cards.
 *
 * Reads media URLs from useWpwFounderAssets (which now picks up both
 * wpw-founder:* and wpw-team:* rows from homepage_showcase). Renders
 * one card per team member with the RestyleProAI brand wordmark on
 * every card and the DesignProAI logo on designer cards (since the
 * tool they design in is DesignProAI).
 *
 * Drop-in: import and render <WpwTeamCards />. No props.
 */

import { Play, ImageIcon } from "lucide-react";
import { useWpwFounderAssets } from "@/hooks/useWpwFounderAssets";
import { isVideoUrl, getEmbedUrl } from "@/lib/wpw-founder-slots";
import designProLogo from "@/assets/designpro-ai-logo.png";

interface TeamCardSpec {
  name: string;
  role: string;
  team: "Founder" | "Design" | "Marketing";
  videoSlot?: string;
  photoSlot?: string;
  fallbackPhotoSlot?: string;
  showDesignProLogo: boolean;
}

const TEAM: TeamCardSpec[] = [
  {
    name: "Trish",
    role: "Founder",
    team: "Founder",
    videoSlot: "video",
    fallbackPhotoSlot: "video-poster",
    showDesignProLogo: true,
  },
  {
    name: "Troy",
    role: "Designer",
    team: "Design",
    videoSlot: "troy-video",
    showDesignProLogo: true,
  },
  {
    name: "Lance",
    role: "Designer",
    team: "Design",
    videoSlot: "lance-video",
    showDesignProLogo: true,
  },
  {
    name: "RJ",
    role: "Designer",
    team: "Design",
    videoSlot: "rj-video",
    showDesignProLogo: true,
  },
  {
    name: "Xavier",
    role: "Designer",
    team: "Design",
    photoSlot: "xavier-at-pc",
    showDesignProLogo: true,
  },
  {
    name: "Amanda",
    role: "Marketing",
    team: "Marketing",
    photoSlot: "amanda-at-pc",
    fallbackPhotoSlot: "amanda-design",
    showDesignProLogo: false,
  },
];

function BrandWordmark() {
  return (
    <span className="inline-flex items-baseline text-[13px] sm:text-sm font-bold tracking-tight whitespace-nowrap">
      <span className="text-gray-900">Restyle</span>
      <span className="bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">Pro</span>
      <span className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">AI</span>
      <span className="text-gray-400 text-[8px] sm:text-[9px] align-super ml-0.5">™</span>
    </span>
  );
}

function CardMedia({ url, name }: { url: string; name: string }) {
  if (!url) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3 bg-gradient-to-br from-gray-100 to-gray-200">
        <div className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center mb-2">
          <ImageIcon className="w-4 h-4 text-gray-400" />
        </div>
        <div className="text-[11px] font-semibold text-gray-500">{name}</div>
        <div className="text-[10px] text-gray-400 mt-0.5">Media coming soon</div>
      </div>
    );
  }

  const embed = getEmbedUrl(url);
  if (embed) {
    return (
      <iframe
        src={embed}
        title={`${name} reel`}
        className="absolute inset-0 w-full h-full"
        allow="autoplay; encrypted-media; picture-in-picture; web-share"
        allowFullScreen
      />
    );
  }

  if (isVideoUrl(url)) {
    return (
      <video
        src={url}
        className="absolute inset-0 w-full h-full object-cover"
        muted
        playsInline
        loop
        autoPlay
        preload="metadata"
      />
    );
  }

  return (
    <img
      src={url}
      alt={name}
      className="absolute inset-0 w-full h-full object-cover"
      loading="lazy"
    />
  );
}

export function WpwTeamCards() {
  const { data: assets = {} } = useWpwFounderAssets();

  return (
    <section className="mt-10 mb-14">
      <div className="text-center mb-6">
        <div className="text-[11px] font-semibold tracking-[2px] uppercase text-fuchsia-600 mb-1">
          Meet the team
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
          The humans behind your wraps.
        </h2>
        <p className="text-sm text-gray-600 mt-2 max-w-xl mx-auto">
          Every wrap goes through real designers using <BrandWordmark />. Here's
          who's on your team.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {TEAM.map((card) => {
          const url =
            (card.videoSlot && assets[card.videoSlot]) ||
            (card.photoSlot && assets[card.photoSlot]) ||
            (card.fallbackPhotoSlot && assets[card.fallbackPhotoSlot]) ||
            "";

          return (
            <article
              key={card.name}
              className="group relative rounded-2xl overflow-hidden bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
            >
              {/* Media (9:16 phone-shaped) */}
              <div className="relative w-full aspect-[9/16] bg-gray-100">
                <CardMedia url={url} name={card.name} />

                {/* Top-left team chip */}
                <div className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/90 backdrop-blur px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-700 shadow-sm">
                  {card.team}
                </div>

                {/* Top-right play badge for videos */}
                {url && (isVideoUrl(url) || getEmbedUrl(url)) && (
                  <div className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 text-white px-2 py-1 text-[9px] font-bold uppercase tracking-wider">
                    <Play className="w-2.5 h-2.5 fill-current" />
                    Reel
                  </div>
                )}
              </div>

              {/* Card footer with name, role, and brand logos */}
              <div className="p-3 sm:p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <div className="font-bold text-gray-900 text-sm sm:text-base leading-tight">
                      {card.name}
                    </div>
                    <div className="text-[11px] text-gray-500 leading-tight mt-0.5">
                      {card.role}
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between gap-2">
                  <BrandWordmark />
                  {card.showDesignProLogo && (
                    <img
                      src={designProLogo}
                      alt="DesignProAI"
                      className="h-4 sm:h-5 w-auto object-contain opacity-90"
                      loading="lazy"
                    />
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default WpwTeamCards;
