import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card } from "./ui/card";
import { toast } from "sonner";
import { Trash2, Upload } from "lucide-react";
import { Skeleton } from "./ui/skeleton";

interface MediaManagerProps {
  table: string;
  bucket: string;
  title: string;
  hasHex?: boolean;
  hasFinish?: boolean;
  hasCategory?: boolean;
  categoryOptions?: string[];
  hasPrice?: boolean;
  defaultPrice?: number;
  hasBeforeAfter?: boolean;
}

export const MediaManager = ({
  table,
  bucket,
  title,
  hasHex,
  hasFinish,
  hasCategory,
  categoryOptions = [],
  hasPrice,
  defaultPrice,
  hasBeforeAfter,
}: MediaManagerProps) => {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [beforeFile, setBeforeFile] = useState<File | null>(null);
  const [afterFile, setAfterFile] = useState<File | null>(null);
  const [hex, setHex] = useState("");
  const [finish, setFinish] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState(defaultPrice?.toString() || "");
  const [description, setDescription] = useState("");

  const queryClient = useQueryClient();

  const { data: items, isLoading } = useQuery({
    queryKey: [table],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table as any)
        .select("*")
        .order("sort_order", { ascending: true });
      
      if (error) throw error;
      return data as any[];
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!name || (!file && !hasBeforeAfter)) {
        throw new Error("Please fill in required fields");
      }

      let mediaUrl = "";
      let beforeUrl = "";
      let afterUrl = "";

      if (hasBeforeAfter && beforeFile && afterFile) {
        const beforePath = `${Date.now()}-before-${beforeFile.name}`;
        const afterPath = `${Date.now()}-after-${afterFile.name}`;

        const { error: beforeUploadError } = await supabase.storage
          .from(bucket)
          .upload(beforePath, beforeFile);
        
        if (beforeUploadError) throw beforeUploadError;

        const { error: afterUploadError } = await supabase.storage
          .from(bucket)
          .upload(afterPath, afterFile);
        
        if (afterUploadError) throw afterUploadError;

        const { data: beforeData } = supabase.storage.from(bucket).getPublicUrl(beforePath);
        const { data: afterData } = supabase.storage.from(bucket).getPublicUrl(afterPath);

        beforeUrl = beforeData.publicUrl;
        afterUrl = afterData.publicUrl;
      } else if (file) {
        const filePath = `${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(filePath, file);
        
        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
        mediaUrl = data.publicUrl;
      }

      const insertData: any = {
        name,
        is_active: true,
        sort_order: (items?.length || 0) + 1,
      };

      if (hasBeforeAfter) {
        insertData.before_url = beforeUrl;
        insertData.after_url = afterUrl;
        if (description) insertData.description = description;
      } else {
        insertData.media_url = mediaUrl;
        insertData.media_type = file?.type.startsWith("video") ? "video" : "image";
      }

      if (hasHex && hex) insertData.hex = hex;
      if (hasFinish && finish) insertData.finish = finish;
      if (hasCategory && category) insertData.category = category;
      if (hasPrice && price) insertData.price = parseFloat(price);

      const { error } = await supabase.from(table as any).insert([insertData]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [table] });
      toast.success("Item uploaded successfully");
      setName("");
      setFile(null);
      setBeforeFile(null);
      setAfterFile(null);
      setHex("");
      setFinish("");
      setCategory("");
      setPrice("");
      setDescription("");
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [table] });
      toast.success("Item deleted successfully");
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  if (isLoading) {
    return <Skeleton className="h-96" />;
  }

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-secondary/20">
        <h3 className="text-lg font-semibold mb-4">Add New {title}</h3>
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter name"
            />
          </div>

          {hasBeforeAfter ? (
            <>
              <div>
                <Label htmlFor="before">Before Image *</Label>
                <Input
                  id="before"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setBeforeFile(e.target.files?.[0] || null)}
                />
              </div>
              <div>
                <Label htmlFor="after">After Image *</Label>
                <Input
                  id="after"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setAfterFile(e.target.files?.[0] || null)}
                />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter description"
                />
              </div>
            </>
          ) : (
            <div>
              <Label htmlFor="file">File *</Label>
              <Input
                id="file"
                type="file"
                accept="image/*,video/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
          )}

          {hasHex && (
            <div>
              <Label htmlFor="hex">Hex Color</Label>
              <Input
                id="hex"
                value={hex}
                onChange={(e) => setHex(e.target.value)}
                placeholder="#000000"
              />
            </div>
          )}

          {hasFinish && (
            <div>
              <Label htmlFor="finish">Finish Type</Label>
              <Input
                id="finish"
                value={finish}
                onChange={(e) => setFinish(e.target.value)}
                placeholder="Gloss, Matte, Satin, etc."
              />
            </div>
          )}

          {hasCategory && (
            <div>
              <Label htmlFor="category">Category</Label>
              {categoryOptions.length > 0 ? (
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Select category</option>
                  {categoryOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <Input
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Enter category"
                />
              )}
            </div>
          )}

          {hasPrice && (
            <div>
              <Label htmlFor="price">Price</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
          )}

          <Button
            onClick={() => uploadMutation.mutate()}
            disabled={uploadMutation.isPending}
            className="w-full bg-primary hover:bg-primary/90"
          >
            <Upload className="w-4 h-4 mr-2" />
            {uploadMutation.isPending ? "Uploading..." : "Upload"}
          </Button>
        </div>
      </Card>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items?.map((item: any) => (
          <Card key={item.id} className="p-4 bg-secondary/20 relative">
            {hasBeforeAfter ? (
              <div className="grid grid-cols-2 gap-2 aspect-video mb-2">
                <img src={item.before_url} alt="Before" className="w-full h-full object-cover rounded" />
                <img src={item.after_url} alt="After" className="w-full h-full object-cover rounded" />
              </div>
            ) : item.media_type === "video" ? (
              <video src={item.media_url} className="w-full aspect-video object-cover rounded mb-2" />
            ) : (
              <img src={item.media_url} alt={item.name} className="w-full aspect-square object-cover rounded mb-2" />
            )}
            <p className="font-semibold">{item.name}</p>
            {item.hex && (
              <div className="flex items-center gap-2 mt-1">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: item.hex }} />
                <span className="text-xs text-muted-foreground">{item.hex}</span>
              </div>
            )}
            {item.finish && <p className="text-xs text-muted-foreground">Finish: {item.finish}</p>}
            {item.category && <p className="text-xs text-muted-foreground">Category: {item.category}</p>}
            {item.price && <p className="text-xs text-primary">${item.price}</p>}
            
            <Button
              variant="destructive"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => deleteMutation.mutate(item.id)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
};