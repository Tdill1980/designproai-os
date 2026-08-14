import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { MightyMailLibrary } from '@/components/mightymail/MightyMailLibrary';
import { ShopEmailBrandingCard } from '@/components/mightymail/ShopEmailBrandingCard';
import { EmailTemplate } from '@/components/mightymail/types';
import { toast } from 'sonner';

// ─────────────────────────────────────────────────────────────────────
// ShopEmailTemplates
//
// Subscriber-facing read-only library of Shop -> Customer email templates.
// Filters out:
//   - RP -> Shop sales pitches (admin-only, sold via /admin/mightymail)
//   - Internal admin templates that aren't in any defined series
//
// What shops can do here:
//   - Browse templates organized by series (drip / lifecycle / standalone)
//   - Preview rendered emails with sample merge data
//   - "Use This Template" → duplicates into their own slug-prefixed copy
//     so they can edit a personal version without touching the master.
// ─────────────────────────────────────────────────────────────────────
export default function ShopEmailTemplates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTemplates((data || []) as EmailTemplate[]);
    } catch (error) {
      console.error('Error fetching templates:', error);
      toast.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  // "Use this template" — duplicate the master into a shop-prefixed copy
  // they can adjust without touching the original.
  const handleUseTemplate = async (template: EmailTemplate) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Please sign in first');
        return;
      }
      const newSlug = `${template.slug}-mine-${Date.now().toString(36)}`;
      const { error } = await supabase
        .from('email_templates')
        .insert({
          name: `${template.name} (Mine)`,
          slug: newSlug,
          description: template.description,
          subject: template.subject,
          html_content: template.html_content,
          category: template.category,
          from_name: template.from_name,
          from_email: template.from_email,
          merge_tags: template.merge_tags,
          is_active: false,
        });
      if (error) throw error;
      toast.success('Saved to your templates. Find it in your campaigns.');
      await fetchTemplates();
    } catch (error: any) {
      console.error('Error duplicating template:', error);
      toast.error(error?.message ?? 'Could not save template');
    }
  };

  // Read-only stubs (UI never calls these in readOnly mode but the prop type
  // requires them).
  const noop = () => {};

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              onClick={() => navigate('/dashboard')}
              aria-label="Back to dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-fuchsia-500 shadow-md">
                <Mail className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Email Templates</h1>
                <p className="text-sm text-gray-500">
                  Email copy for your customers — drips, retargeting, post-install, marketing.
                  Browse, preview, and save a copy to edit.
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ShopEmailBrandingCard />

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <MightyMailLibrary
            templates={templates}
            audienceFilter="shop-to-customer"
            readOnly
            onCreate={noop}
            onEdit={noop}
            onDelete={noop}
            onToggleActive={noop}
            onDuplicate={handleUseTemplate}
          />
        )}
      </main>
    </div>
  );
}
