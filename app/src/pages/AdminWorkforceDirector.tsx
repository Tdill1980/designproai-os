import PlatformDirectorHome from "@/components/admin/PlatformDirectorHome";

/**
 * Canonical company operating surface.
 *
 * The Director reads live task, content, campaign, and CreatorMarket commerce
 * records. Specialist editing, approvals, and publishing remain in Marketing
 * Hub and CreatorMarket Manager instead of being duplicated here.
 */
export default function AdminWorkforceDirector() {
  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <PlatformDirectorHome />
      </div>
    </main>
  );
}
