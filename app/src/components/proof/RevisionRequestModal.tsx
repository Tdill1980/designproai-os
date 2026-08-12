import { useState } from 'react';
import { MessageSquare, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface RevisionRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (notes: string) => Promise<void>;
  isSubmitting: boolean;
}

export function RevisionRequestModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}: RevisionRequestModalProps) {
  const [notes, setNotes] = useState('');

  const handleSubmit = async () => {
    if (!notes.trim()) return;
    await onSubmit(notes.trim());
    setNotes('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-amber-500" />
            Request Design Changes
          </DialogTitle>
          <DialogDescription>
            Please describe what changes you'd like made to this design. Be as specific as possible.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="revision-notes">Your Feedback</Label>
            <Textarea
              id="revision-notes"
              placeholder="e.g., I'd like the color to be slightly darker, and please remove the design from the roof..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              className="resize-none"
            />
          </div>

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !notes.trim()}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Submit Feedback
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
