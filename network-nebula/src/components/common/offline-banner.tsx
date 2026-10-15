import { WifiOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOffline } from '@/hooks/use-offline';

export function OfflineBanner() {
  const { isOffline } = useOffline();

  if (!isOffline) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-destructive text-destructive-foreground px-4 py-2">
      <div className="mx-auto max-w-7xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <WifiOff className="h-4 w-4" />
          <span className="text-sm font-medium">You are offline</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
          className="bg-background text-foreground hover:bg-background/90"
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          Retry
        </Button>
      </div>
    </div>
  );
}
