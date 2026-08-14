import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { WifiOff } from 'lucide-react';

/**
 * Floating banner that shows when user is offline
 * Displays reassuring message about draft saving
 */
export function OfflineBanner() {
  const offline = useOfflineStatus();

  if (!offline) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-amber-500 text-amber-950 px-4 py-2 rounded-lg shadow-lg animate-in slide-in-from-bottom-2 duration-300">
      <WifiOff className="h-4 w-4" />
      <span className="text-sm font-medium">
        Offline - drafts auto-saved
      </span>
    </div>
  );
}
