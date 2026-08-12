import { useState, useEffect } from 'react';
import { ArrowLeft, Save, Send, Blocks, Code } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmailTemplate, EmailBlock, CATEGORIES } from './types';
import { BlockEditor } from './BlockEditor';
import { HtmlEditor, blocksToHtml } from './HtmlEditor';
import { MergeTagsPanel } from './MergeTagsPanel';
import { TemplatePreview } from './TemplatePreview';
import { toast } from 'sonner';

interface TemplateEditorProps {
  template: EmailTemplate | null;
  onSave: (template: Partial<EmailTemplate>) => Promise<void>;
  onBack: () => void;
  onSendTest: (template: EmailTemplate, email: string) => Promise<void>;
}

export function TemplateEditor({ template, onSave, onBack, onSendTest }: TemplateEditorProps) {
  const [editorMode, setEditorMode] = useState<'visual' | 'html'>('html');
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  // Form state
  const [name, setName] = useState(template?.name || '');
  const [slug, setSlug] = useState(template?.slug || '');
  const [description, setDescription] = useState(template?.description || '');
  const [subject, setSubject] = useState(template?.subject || '');
  const [htmlContent, setHtmlContent] = useState(template?.html_content || '');
  const [category, setCategory] = useState(template?.category || 'transactional');
  const [fromName, setFromName] = useState(template?.from_name || 'RestylePro');
  const [fromEmail, setFromEmail] = useState(template?.from_email || 'onboarding@resend.dev');
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);

  // Auto-generate slug from name
  useEffect(() => {
    if (!template && name) {
      setSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, ''));
    }
  }, [name, template]);

  // Sync blocks to HTML when in visual mode
  useEffect(() => {
    if (editorMode === 'visual' && blocks.length > 0) {
      setHtmlContent(blocksToHtml(blocks));
    }
  }, [blocks, editorMode]);

  const handleSave = async () => {
    if (!name || !slug || !subject) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        id: template?.id,
        name,
        slug,
        description,
        subject,
        html_content: htmlContent,
        category: category as EmailTemplate['category'],
        from_name: fromName,
        from_email: fromEmail,
        merge_tags: extractMergeTags(htmlContent + subject),
      });
      toast.success('Template saved successfully');
    } catch (error) {
      toast.error('Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!testEmail) {
      toast.error('Please enter a test email address');
      return;
    }

    setSendingTest(true);
    try {
      await onSendTest({
        ...template!,
        name,
        slug,
        subject,
        html_content: htmlContent,
        category: category as EmailTemplate['category'],
        from_name: fromName,
        from_email: fromEmail,
      } as EmailTemplate, testEmail);
      toast.success(`Test email sent to ${testEmail}`);
    } catch (error) {
      toast.error('Failed to send test email');
    } finally {
      setSendingTest(false);
    }
  };

  const handleInsertTag = (tag: string) => {
    // Insert at cursor in subject or HTML based on focus
    setHtmlContent(prev => prev + tag);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-foreground">
              {template ? 'Edit Template' : 'New Template'}
            </h2>
            <p className="text-muted-foreground">
              {template ? `Editing: ${template.name}` : 'Create a new email template'}
            </p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Save Template'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Settings & Editor */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border border-border rounded-lg bg-card">
            <div>
              <Label>Template Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Design Pack Delivery"
              />
            </div>
            <div>
              <Label>Slug *</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g., design-pack-delivery"
                className="font-mono"
              />
            </div>
            <div className="md:col-span-2">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of when this email is sent"
              />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as 'transactional' | 'marketing' | 'notification')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>From Name</Label>
              <Input
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="RestylePro"
              />
            </div>
          </div>

          {/* Subject Line */}
          <div className="p-4 border border-border rounded-lg bg-card">
            <Label>Subject Line *</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Your {{design_name}} is Ready!"
              className="mt-2"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Use merge tags like {'{{customer_name}}'} for personalization
            </p>
          </div>

          {/* Editor Tabs */}
          <Tabs value={editorMode} onValueChange={(v) => setEditorMode(v as 'visual' | 'html')}>
            <TabsList className="mb-4">
              <TabsTrigger value="visual" className="gap-2">
                <Blocks className="h-4 w-4" />
                Visual Editor
              </TabsTrigger>
              <TabsTrigger value="html" className="gap-2">
                <Code className="h-4 w-4" />
                HTML Editor
              </TabsTrigger>
            </TabsList>

            <TabsContent value="visual">
              <BlockEditor blocks={blocks} onChange={setBlocks} />
            </TabsContent>

            <TabsContent value="html">
              <HtmlEditor
                html={htmlContent}
                onChange={setHtmlContent}
                onInsertTag={handleInsertTag}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Column - Merge Tags & Preview */}
        <div className="space-y-6">
          {/* Merge Tags */}
          <MergeTagsPanel
            onInsertTag={handleInsertTag}
            selectedTags={extractMergeTags(htmlContent + subject)}
          />

          {/* Test Email */}
          <div className="p-4 border border-border rounded-lg bg-card space-y-3">
            <Label>Send Test Email</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="test@example.com"
              />
              <Button
                variant="outline"
                onClick={handleSendTest}
                disabled={sendingTest || !testEmail}
                className="gap-2 shrink-0"
              >
                <Send className="h-4 w-4" />
                {sendingTest ? 'Sending...' : 'Send'}
              </Button>
            </div>
          </div>

          {/* Preview */}
          <TemplatePreview html={htmlContent} subject={subject} />
        </div>
      </div>
    </div>
  );
}

// Extract merge tags from content
function extractMergeTags(content: string): string[] {
  const matches = content.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
}
