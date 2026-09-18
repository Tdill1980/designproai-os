import { useState } from 'react';
import { Mail, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { emailDesignProof, proofQuantity, type SavedDesignProof, type DesignProofMetadata } from '@/lib/design-proof-export';
import { toast } from '@/hooks/use-toast';

/** Uses the saved, on-screen PDF, including its yardage and brand. */
export function DesignProofEmailDialog({ proof, metadata, initialEmail, onClose }: {
  proof: SavedDesignProof; metadata: DesignProofMetadata; initialEmail?: string; onClose: () => void;
}) {
  const [to, setTo] = useState(initialEmail || '');
  const [subject, setSubject] = useState(`${metadata.title} — ${metadata.vehicle} — Design Approval Proof`);
  const [message, setMessage] = useState(`Hi${metadata.customerName ? ` ${metadata.customerName}` : ''},\n\nPlease review your ${metadata.design} design proof.\n\n${metadata.vehicle}\n${proofQuantity(metadata)}\nFinish: ${metadata.finish}.\n\nYour proof PDF is attached and can also be downloaded using the link below. Reply with your approval or any requested changes.`);
  const [sending, setSending] = useState(false);
  return <Dialog open onOpenChange={(open) => { if (!open && !sending) onClose(); }}>
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>Email {metadata.title} proof</DialogTitle>
        <DialogDescription>The same branded PDF you reviewed is attached, with a download link.</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault(); setSending(true);
        try {
          await emailDesignProof(proof, to.trim(), subject.trim(), message.trim());
          toast({ title: 'Proof emailed', description: `Sent to ${to.trim()} with the PDF attached.` }); onClose();
        } catch (error) {
          toast({ title: 'Email not sent', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
        } finally { setSending(false); }
      }}>
        <div><Label htmlFor="proof-recipient">Customer email</Label><Input id="proof-recipient" type="email" required value={to} onChange={e => setTo(e.target.value)} disabled={sending} /></div>
        <div><Label htmlFor="proof-subject">Subject</Label><Input id="proof-subject" required maxLength={200} value={subject} onChange={e => setSubject(e.target.value)} disabled={sending} /></div>
        <div><Label htmlFor="proof-message">Message</Label><Textarea id="proof-message" required maxLength={4000} rows={8} value={message} onChange={e => setMessage(e.target.value)} disabled={sending} /></div>
        <a href={proof.pdfUrl} target="_blank" rel="noreferrer" className="block text-sm text-blue-600 underline">Download the attached proof PDF</a>
        <Button type="submit" disabled={sending} className="w-full gap-2">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}{sending ? 'Sending…' : 'Send proof'}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
