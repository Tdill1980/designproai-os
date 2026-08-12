import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Promise-based confirm dialog.
//
// Why this exists: the native `window.confirm()` is blocked (silently returns
// `false`) inside sandboxed iframes and many mobile in-app webviews. That made
// every "Delete" / "Regenerate" action in RevisionStudioIQ a no-op for users
// running the app in those contexts. This replacement renders a real in-app
// dialog and resolves a Promise, so it works everywhere.
//
// Usage:
//   if (await confirmDialog({ title: "Delete?", confirmText: "Delete" })) { ... }
// Mount <ConfirmDialogHost /> once near the page root.
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** Use the destructive (red) styling for the confirm button. */
  destructive?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

type Listener = (request: ConfirmRequest | null) => void;

let listener: Listener | null = null;

/**
 * Open the in-app confirm dialog. Resolves `true` if the user confirms,
 * `false` if they cancel or dismiss. Falls back to native confirm if the host
 * is not mounted (defensive — should not happen in normal use).
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (!listener) {
    // Host not mounted — fall back to native confirm so we never lose the action.
    return Promise.resolve(
      typeof window !== "undefined"
        ? window.confirm(options.description ? `${options.title}\n\n${options.description}` : options.title)
        : false,
    );
  }
  return new Promise<boolean>((resolve) => {
    listener?.({ ...options, resolve });
  });
}

/**
 * Mount this once near the root of a page/app to enable `confirmDialog()`.
 */
export function ConfirmDialogHost() {
  const [request, setRequest] = React.useState<ConfirmRequest | null>(null);

  React.useEffect(() => {
    listener = setRequest;
    return () => {
      listener = null;
    };
  }, []);

  const close = React.useCallback(
    (value: boolean) => {
      request?.resolve(value);
      setRequest(null);
    },
    [request],
  );

  return (
    <AlertDialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          {request?.description && (
            <AlertDialogDescription>{request.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>
            {request?.cancelText ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => close(true)}
            className={cn(
              request?.destructive && "bg-red-600 text-white hover:bg-red-700",
            )}
          >
            {request?.confirmText ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
