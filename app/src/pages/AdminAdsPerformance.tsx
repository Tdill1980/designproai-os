import AdsPerformancePanel from "@/components/admin/AdsPerformancePanel";

// WHITE UI page (docs/WHITE_UI_STANDARD.md): white surface, dark text,
// blue→magenta gradient as accent only. The global black header/nav frame
// this content area — the page renders no chrome of its own.
// The actual dashboard lives in AdsPerformancePanel, shared with the
// Content Director "Ads" tab.

export default function AdminAdsPerformance() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <AdsPerformancePanel />
      </div>
    </div>
  );
}
