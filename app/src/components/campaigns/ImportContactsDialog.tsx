import { useRef, useState } from 'react';
import { Upload, FileText, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ImportContactsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: (count: number) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Import contacts into the email_subscribers table.
 * Accepts either pasted text (one email per line) OR a CSV upload
 * where the first column containing an email wins. Duplicates are
 * silently upserted.
 */
export function ImportContactsDialog({ open, onOpenChange, onImported }: ImportContactsDialogProps) {
  const [pasted, setPasted] = useState('');
  const [source, setSource] = useState('imported');
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseEmails = (raw: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of raw.split(/[\n,;]/)) {
      const trimmed = line.trim().replace(/^["']|["']$/g, '');
      if (!trimmed) continue;
      // Grab the first email-looking token on the line (handles "Name,email@x.com")
      const parts = trimmed.split(/[\s,;]+/);
      for (const p of parts) {
        const email = p.toLowerCase();
        if (EMAIL_RE.test(email) && !seen.has(email)) {
          seen.add(email);
          out.push(email);
          break;
        }
      }
    }
    return out;
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File must be under 5MB');
      e.target.value = '';
      return;
    }
    setFileName(file.name);
    const text = await file.text();
    setPasted((prev) => (prev ? `${prev}\n${text}` : text));
    e.target.value = '';
  };

  const handleImport = async () => {
    const emails = parseEmails(pasted);
    if (emails.length === 0) {
      toast.error('No valid emails found');
      return;
    }

    setImporting(true);
    try {
      const rows = emails.map((email) => ({
        email,
        source: source || 'imported',
      }));

      const { error, count } = await supabase
        .from('email_subscribers')
        .upsert(rows, { onConflict: 'email', ignoreDuplicates: false, count: 'exact' });

      if (error) throw error;

      toast.success(`Imported ${count ?? emails.length} contact${emails.length === 1 ? '' : 's'}`);
      onImported?.(count ?? emails.length);
      setPasted('');
      setFileName(null);
      onOpenChange(false);
    } catch (err: any) {
      console.error('Import failed:', err);
      toast.error(err.message || 'Failed to import contacts');
    } finally {
      setImporting(false);
    }
  };

  const parsedCount = parseEmails(pasted).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-cyan-400" />
            Import Contacts
          </DialogTitle>
          <DialogDescription>
            Add contacts to your email database. Paste emails below (one per line), or upload a CSV. Imported contacts can be targeted in campaigns via the "Contact Database" audience.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* CSV upload */}
          <div>
            <Label>Upload CSV</Label>
            <div className="flex gap-2 mt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                Choose File
              </Button>
              {fileName && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  <span className="truncate max-w-[200px]">{fileName}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      setFileName(null);
                      setPasted('');
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={handleFile}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              First email found on each line is imported. Headers and extra columns are ignored.
            </p>
          </div>

          {/* Paste area */}
          <div>
            <Label>Or paste emails</Label>
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={'jane@example.com\njohn@example.com\nshop@wrapspot.com'}
              rows={8}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {parsedCount > 0
                ? `${parsedCount} valid email${parsedCount === 1 ? '' : 's'} detected`
                : 'One email per line. Commas, semicolons, and tabs are also accepted.'}
            </p>
          </div>

          {/* Source tag */}
          <div>
            <Label>Source tag</Label>
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="imported"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Stored on each contact so you can segment campaigns by source (e.g. <code>shop_customer_list</code>).
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={importing || parsedCount === 0}
            className="bg-cyan-600 hover:bg-cyan-700 gap-2"
          >
            <Upload className="h-4 w-4" />
            {importing ? 'Importing...' : `Import ${parsedCount || ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
