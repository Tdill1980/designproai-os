import { useState, useRef, useEffect } from 'react';
import { Code, Copy, Check, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { EmailBlock } from './types';

interface HtmlEditorProps {
  html: string;
  onChange: (html: string) => void;
  onInsertTag?: (tag: string) => void;
}

export function HtmlEditor({ html, onChange, onInsertTag }: HtmlEditorProps) {
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(html);
    setCopied(true);
    toast.success('HTML copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFormat = () => {
    try {
      // Simple HTML formatting
      const formatted = html
        .replace(/></g, '>\n<')
        .replace(/\n\n+/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line)
        .join('\n');
      onChange(formatted);
      toast.success('HTML formatted');
    } catch {
      toast.error('Failed to format HTML');
    }
  };

  // Insert tag at cursor position
  useEffect(() => {
    if (onInsertTag) {
      // This is handled via the parent component
    }
  }, [onInsertTag]);

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Code className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground text-sm">HTML Editor</h3>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleFormat} className="gap-2">
            <Wand2 className="h-4 w-4" />
            Format
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-2">
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            Copy
          </Button>
        </div>
      </div>
      
      <Textarea
        ref={textareaRef}
        value={html}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-sm min-h-[400px] rounded-none border-0 resize-none focus-visible:ring-0"
        placeholder="Enter your HTML here..."
        spellCheck={false}
      />
    </div>
  );
}

// Helper function to convert blocks to HTML
export function blocksToHtml(blocks: EmailBlock[]): string {
  const parts: string[] = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '</head>',
    '<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">',
  ];

  blocks.forEach(block => {
    switch (block.type) {
      case 'header':
        parts.push(`<div style="background-color: ${block.content.backgroundColor}; padding: 20px; text-align: center;">`);
        if (block.content.logoUrl) {
          parts.push(`<img src="${block.content.logoUrl}" alt="Logo" style="max-height: 50px; margin-bottom: 10px;">`);
        }
        parts.push(`<h1 style="color: #333; margin: 0;">${block.content.title}</h1>`);
        parts.push('</div>');
        break;

      case 'text':
        parts.push(`<p style="font-size: ${block.content.fontSize}px; text-align: ${block.content.align}; color: #333; line-height: 1.6;">${block.content.text}</p>`);
        break;

      case 'button':
        parts.push(`<div style="text-align: center; margin: 20px 0;">`);
        parts.push(`<a href="${block.content.url}" style="display: inline-block; background-color: ${block.content.backgroundColor}; color: ${block.content.textColor}; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500;">${block.content.text}</a>`);
        parts.push('</div>');
        break;

      case 'image':
        parts.push(`<div style="text-align: center; margin: 20px 0;">`);
        parts.push(`<img src="${block.content.url}" alt="${block.content.alt}" style="width: ${block.content.width}; max-width: 100%;">`);
        parts.push('</div>');
        break;

      case 'divider':
        parts.push(`<hr style="border: none; border-top: ${block.content.height}px solid ${block.content.color}; margin: 30px 0;">`);
        break;

      case 'footer':
        parts.push(`<footer style="text-align: ${block.content.align}; color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">`);
        parts.push(`<p>${block.content.text}</p>`);
        parts.push('</footer>');
        break;
    }
  });

  parts.push('</body>');
  parts.push('</html>');

  return parts.join('\n');
}
