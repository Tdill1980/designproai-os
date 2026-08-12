/**
 * /affiliate/sharing-kit — dedicated landing for the rep's share assets.
 *
 * Renders the WpwRepToolkitCard front and center so reps reach their
 * link / code / QR / 4:5 social post without scrolling past stats.
 * The same card also shows on /affiliate/dashboard; this page exists
 * as a focused destination for the new "Sharing Kit" nav tab and any
 * external link we send reps ("here's your share kit:
 * restyleproai.com/affiliate/sharing-kit").
 */

import { Loader2 } from "lucide-react";
import { AffiliateLayout } from "@/components/affiliate/AffiliateLayout";
import { WpwRepToolkitCard } from "@/components/affiliate/WpwRepToolkitCard";
import { useAffiliateProfile } from "@/hooks/useAffiliateData";
import { getWpwRepByPartnerCode } from "@/lib/wpw-reps";
import { Link } from "react-router-dom";

export default function AffiliateSharingKit() {
  const { data: profile, isLoading } = useAffiliateProfile();

  if (isLoading) {
    return (
      <AffiliateLayout
        title="Sharing Kit"
        subtitle="Your branded link, code, QR, and 4:5 social post — ready to share."
      >
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </AffiliateLayout>
    );
  }

  const rep = profile ? getWpwRepByPartnerCode(profile.referral_code) : null;

  if (!profile) {
    return (
      <AffiliateLayout title="Sharing Kit">
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-700">
          You need an active affiliate profile to see your sharing kit.{" "}
          <Link
            to="/affiliate/join"
            className="text-[#0284C7] font-semibold hover:underline"
          >
            Apply here
          </Link>
          .
        </div>
      </AffiliateLayout>
    );
  }

  if (!rep) {
    // Generic affiliate (no WPW rep profile) — show their link + code
    // without the rep-specific QR / 4:5 post (those need rep accent +
    // headshot from WPW_REPS).
    return (
      <AffiliateLayout
        title="Sharing Kit"
        subtitle="Your link and coupon code — ready to share."
      >
        <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
              Your link
            </div>
            <code className="block bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm text-gray-800 break-all">
              {profile.referral_link}
            </code>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
              Your coupon code
            </div>
            <code className="block bg-sky-50 border border-sky-200 rounded px-3 py-2 text-sm font-mono font-bold tracking-wider text-sky-700">
              {profile.referral_code}
            </code>
          </div>
        </div>
      </AffiliateLayout>
    );
  }

  return (
    <AffiliateLayout
      title="Sharing Kit"
      subtitle="Your branded link, code, QR, and 4:5 social post — ready to share."
    >
      <WpwRepToolkitCard rep={rep} />
    </AffiliateLayout>
  );
}
