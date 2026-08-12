import { Tag, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MERGE_TAGS } from './types';
import { toast } from 'sonner';

interface MergeTagsPanelProps {
  onInsertTag: (tag: string) => void;
  selectedTags?: string[];
}

export function MergeTagsPanel({ onInsertTag, selectedTags = [] }: MergeTagsPanelProps) {
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  const handleCopyTag = (tag: string) => {
    const tagText = `{{${tag}}}`;
    navigator.clipboard.writeText(tagText);
    setCopiedTag(tag);
    toast.success(`Copied ${tagText} to clipboard`);
    setTimeout(() => setCopiedTag(null), 2000);
  };

  const handleInsertTag = (tag: string) => {
    onInsertTag(`{{${tag}}}`);
    toast.success(`Inserted {{${tag}}}`);
  };

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground">Merge Tags</h3>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Click to insert, or copy to clipboard
        </p>
      </div>
      
      <ScrollArea className="h-[300px]">
        <div className="p-2 space-y-1">
          {MERGE_TAGS.map(({ tag, description }) => {
            const isSelected = selectedTags.includes(tag);
            const isCopied = copiedTag === tag;
            
            return (
              <div
                key={tag}
                className={`flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors group ${
                  isSelected ? 'bg-primary/10 border border-primary/20' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => handleInsertTag(tag)}
                    className="text-left w-full"
                  >
                    <code className="text-xs font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                      {`{{${tag}}}`}
                    </code>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {description}
                    </p>
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleCopyTag(tag)}
                >
                  {isCopied ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
