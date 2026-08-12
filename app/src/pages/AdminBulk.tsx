import { BulkSwatchUploader } from "@/components/admin/BulkSwatchUploader";

const AdminBulk = () => {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-foreground mb-2">Bulk Swatch Upload</h1>
        <p className="text-muted-foreground mb-8">
          Upload ZIP files containing pre-named swatch images. Files should be named by product code (e.g., 2080-G103.png).
        </p>
        <BulkSwatchUploader />
      </div>
    </div>
  );
};

export default AdminBulk;
