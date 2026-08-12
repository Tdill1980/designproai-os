import { useState } from 'react';
import { 
  Type, 
  Image, 
  Square, 
  Minus, 
  Layout, 
  Trash2, 
  GripVertical,
  Plus,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmailBlock } from './types';

interface BlockEditorProps {
  blocks: EmailBlock[];
  onChange: (blocks: EmailBlock[]) => void;
}

const BLOCK_TYPES = [
  { type: 'header', icon: Layout, label: 'Header' },
  { type: 'text', icon: Type, label: 'Text' },
  { type: 'button', icon: Square, label: 'Button' },
  { type: 'image', icon: Image, label: 'Image' },
  { type: 'divider', icon: Minus, label: 'Divider' },
  { type: 'footer', icon: Layout, label: 'Footer' },
] as const;

const generateId = () => Math.random().toString(36).substr(2, 9);

const getDefaultContent = (type: EmailBlock['type']): Record<string, any> => {
  switch (type) {
    case 'header':
      return { title: 'Email Header', logoUrl: '', backgroundColor: '#ffffff' };
    case 'text':
      return { text: 'Enter your text here...', fontSize: '16', align: 'left' };
    case 'button':
      return { text: 'Click Here', url: '#', backgroundColor: '#8B5CF6', textColor: '#ffffff' };
    case 'image':
      return { url: '', alt: 'Image', width: '100%' };
    case 'divider':
      return { color: '#eeeeee', height: '1' };
    case 'footer':
      return { text: '© {{current_year}} RestylePro. All rights reserved.', align: 'center' };
    default:
      return {};
  }
};

export function BlockEditor({ blocks, onChange }: BlockEditorProps) {
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null);

  const addBlock = (type: EmailBlock['type']) => {
    const newBlock: EmailBlock = {
      id: generateId(),
      type,
      content: getDefaultContent(type),
    };
    onChange([...blocks, newBlock]);
    setExpandedBlock(newBlock.id);
  };

  const updateBlock = (id: string, content: Record<string, any>) => {
    onChange(blocks.map(b => b.id === id ? { ...b, content } : b));
  };

  const deleteBlock = (id: string) => {
    onChange(blocks.filter(b => b.id !== id));
  };

  const moveBlock = (id: string, direction: 'up' | 'down') => {
    const index = blocks.findIndex(b => b.id === id);
    if (index === -1) return;
    
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= blocks.length) return;
    
    const newBlocks = [...blocks];
    [newBlocks[index], newBlocks[newIndex]] = [newBlocks[newIndex], newBlocks[index]];
    onChange(newBlocks);
  };

  const renderBlockEditor = (block: EmailBlock) => {
    const { type, content } = block;

    switch (type) {
      case 'header':
        return (
          <div className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input
                value={content.title}
                onChange={(e) => updateBlock(block.id, { ...content, title: e.target.value })}
              />
            </div>
            <div>
              <Label>Logo URL (optional)</Label>
              <Input
                value={content.logoUrl}
                onChange={(e) => updateBlock(block.id, { ...content, logoUrl: e.target.value })}
                placeholder="https://..."
              />
            </div>
            <div>
              <Label>Background Color</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={content.backgroundColor}
                  onChange={(e) => updateBlock(block.id, { ...content, backgroundColor: e.target.value })}
                  className="w-12 h-9 p-1"
                />
                <Input
                  value={content.backgroundColor}
                  onChange={(e) => updateBlock(block.id, { ...content, backgroundColor: e.target.value })}
                />
              </div>
            </div>
          </div>
        );

      case 'text':
        return (
          <div className="space-y-3">
            <div>
              <Label>Text Content</Label>
              <Textarea
                value={content.text}
                onChange={(e) => updateBlock(block.id, { ...content, text: e.target.value })}
                rows={4}
              />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <Label>Font Size (px)</Label>
                <Input
                  type="number"
                  value={content.fontSize}
                  onChange={(e) => updateBlock(block.id, { ...content, fontSize: e.target.value })}
                />
              </div>
              <div className="flex-1">
                <Label>Alignment</Label>
                <Select
                  value={content.align}
                  onValueChange={(v) => updateBlock(block.id, { ...content, align: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );

      case 'button':
        return (
          <div className="space-y-3">
            <div>
              <Label>Button Text</Label>
              <Input
                value={content.text}
                onChange={(e) => updateBlock(block.id, { ...content, text: e.target.value })}
              />
            </div>
            <div>
              <Label>URL</Label>
              <Input
                value={content.url}
                onChange={(e) => updateBlock(block.id, { ...content, url: e.target.value })}
                placeholder="https://... or {{merge_tag}}"
              />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <Label>Background</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={content.backgroundColor}
                    onChange={(e) => updateBlock(block.id, { ...content, backgroundColor: e.target.value })}
                    className="w-12 h-9 p-1"
                  />
                  <Input
                    value={content.backgroundColor}
                    onChange={(e) => updateBlock(block.id, { ...content, backgroundColor: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex-1">
                <Label>Text Color</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={content.textColor}
                    onChange={(e) => updateBlock(block.id, { ...content, textColor: e.target.value })}
                    className="w-12 h-9 p-1"
                  />
                  <Input
                    value={content.textColor}
                    onChange={(e) => updateBlock(block.id, { ...content, textColor: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case 'image':
        return (
          <div className="space-y-3">
            <div>
              <Label>Image URL</Label>
              <Input
                value={content.url}
                onChange={(e) => updateBlock(block.id, { ...content, url: e.target.value })}
                placeholder="https://..."
              />
            </div>
            <div>
              <Label>Alt Text</Label>
              <Input
                value={content.alt}
                onChange={(e) => updateBlock(block.id, { ...content, alt: e.target.value })}
              />
            </div>
            <div>
              <Label>Width</Label>
              <Input
                value={content.width}
                onChange={(e) => updateBlock(block.id, { ...content, width: e.target.value })}
                placeholder="100% or 300px"
              />
            </div>
          </div>
        );

      case 'divider':
        return (
          <div className="space-y-3">
            <div className="flex gap-4">
              <div className="flex-1">
                <Label>Color</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={content.color}
                    onChange={(e) => updateBlock(block.id, { ...content, color: e.target.value })}
                    className="w-12 h-9 p-1"
                  />
                  <Input
                    value={content.color}
                    onChange={(e) => updateBlock(block.id, { ...content, color: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex-1">
                <Label>Height (px)</Label>
                <Input
                  type="number"
                  value={content.height}
                  onChange={(e) => updateBlock(block.id, { ...content, height: e.target.value })}
                />
              </div>
            </div>
          </div>
        );

      case 'footer':
        return (
          <div className="space-y-3">
            <div>
              <Label>Footer Text</Label>
              <Textarea
                value={content.text}
                onChange={(e) => updateBlock(block.id, { ...content, text: e.target.value })}
                rows={2}
              />
            </div>
            <div>
              <Label>Alignment</Label>
              <Select
                value={content.align}
                onValueChange={(v) => updateBlock(block.id, { ...content, align: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">Left</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="right">Right</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Add Block Buttons */}
      <div className="flex flex-wrap gap-2 p-3 border border-dashed border-border rounded-lg bg-muted/30">
        {BLOCK_TYPES.map(({ type, icon: Icon, label }) => (
          <Button
            key={type}
            variant="outline"
            size="sm"
            onClick={() => addBlock(type)}
            className="gap-2"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Button>
        ))}
      </div>

      {/* Block List */}
      <div className="space-y-2">
        {blocks.map((block, index) => {
          const BlockIcon = BLOCK_TYPES.find(t => t.type === block.type)?.icon || Type;
          const isExpanded = expandedBlock === block.id;

          return (
            <div
              key={block.id}
              className="border border-border rounded-lg overflow-hidden bg-card"
            >
              <div 
                className="flex items-center gap-2 p-3 bg-muted/30 cursor-pointer"
                onClick={() => setExpandedBlock(isExpanded ? null : block.id)}
              >
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <BlockIcon className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm text-foreground flex-1 capitalize">
                  {block.type}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => { e.stopPropagation(); moveBlock(block.id, 'up'); }}
                    disabled={index === 0}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => { e.stopPropagation(); moveBlock(block.id, 'down'); }}
                    disabled={index === blocks.length - 1}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); deleteBlock(block.id); }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              {isExpanded && (
                <div className="p-4 border-t border-border">
                  {renderBlockEditor(block)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {blocks.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Plus className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Click a block type above to start building</p>
        </div>
      )}
    </div>
  );
}
