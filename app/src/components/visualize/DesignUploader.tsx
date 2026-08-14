import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Upload, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface DesignUploaderProps {
  onDesignUpload: (design: { url: string; fileName: string }) => void;
}

export function DesignUploader({ onDesignUpload }: DesignUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ url: string; fileName: string } | null>(null);
  const { toast } = useToast();

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      toast({ 
        title: 'Invalid file type', 
        description: 'Please upload PNG, JPG, or PDF', 
        variant: 'destructive' 
      });
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast({ 
        title: 'File too large', 
        description: 'Maximum file size is 20MB', 
        variant: 'destructive' 
      });
      return;
    }

    try {
      setUploading(true);

      const fileName = `${crypto.randomUUID()}.${file.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage
        .from('wrap-files')
        .upload(`designs/${fileName}`, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('wrap-files')
        .getPublicUrl(`designs/${fileName}`);

      const designData = { url: publicUrl, fileName: file.name };
      setPreview(designData);
      onDesignUpload(designData);

      toast({ title: 'Design uploaded successfully' });
    } catch (error: any) {
      console.error('Design upload error:', error);
      toast({ 
        title: 'Upload failed', 
        description: error.message, 
        variant: 'destructive' 
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Label>Upload 2D Design</Label>
      
      <div className="border-2 border-dashed rounded-lg p-6 text-center">
        {preview ? (
          <div className="space-y-4">
            {preview.url.endsWith('.pdf') ? (
              <div className="p-8 bg-muted rounded">
                <p className="text-sm font-medium">📄 {preview.fileName}</p>
              </div>
            ) : (
              <img src={preview.url} alt="Design preview" className="mx-auto max-h-48 rounded" />
            )}
            <Button
              variant="outline"
              onClick={() => {
                setPreview(null);
                onDesignUpload({ url: '', fileName: '' });
              }}
            >
              Upload Different Design
            </Button>
          </div>
        ) : (
          <label className="cursor-pointer">
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,application/pdf"
              className="hidden"
              onChange={handleFileUpload}
              disabled={uploading}
            />
            <div className="space-y-2">
              {uploading ? (
                <Loader2 className="w-12 h-12 mx-auto animate-spin text-muted-foreground" />
              ) : (
                <Upload className="w-12 h-12 mx-auto text-muted-foreground" />
              )}
              <p className="text-sm text-muted-foreground">
                {uploading ? 'Uploading...' : 'Click to upload design file'}
              </p>
              <p className="text-xs text-muted-foreground">
                PNG, JPG, or PDF (max 20MB)
              </p>
            </div>
          </label>
        )}
      </div>
    </div>
  );
}