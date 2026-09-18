import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Download, FileCheck2, Loader2, Mail, RefreshCw, Search, Share2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DesignProofEmailDialog } from '@/components/tools/DesignProofEmailDialog';
import { getDesignProofLink, listDesignProofs, proofQuantity, type DesignProofMetadata, type DesignProofRecord, type SavedDesignProof } from '@/lib/design-proof-export';
import { toast } from 'sonner';

export default function DesignProofs() {
  const [params] = useSearchParams();
  const wpw = params.get('brand') === 'weprintwraps';
  const [identity, setIdentity] = useState<{ id: string } | null | undefined>(undefined);
  const [tool, setTool] = useState('');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState<{ proof: SavedDesignProof; metadata: DesignProofMetadata; owner: string } | null>(null);
  const [shared, setShared] = useState<{ url: string; owner: string } | null>(null);

  useEffect(() => {
    let active = true;
    let authChanged = false;
    const receive = (user: { id: string; is_anonymous?: boolean } | undefined) => {
      if (active) setIdentity(user && !user.is_anonymous ? { id: user.id } : null);
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { authChanged = true; receive(session?.user); });
    supabase.auth.getSession().then(({ data }) => { if (!authChanged) receive(data.session?.user); }).catch(() => receive(undefined));
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  const catalog = useQuery({
    queryKey: ['design-proofs', identity?.id, wpw, tool, search, page],
    queryFn: () => listDesignProofs({ brand: wpw ? 'weprintwraps' : undefined, tool: (tool || undefined) as DesignProofMetadata['tool'], search, page }),
    enabled: !!identity,
    retry: 1,
  });

  async function act(record: DesignProofRecord, action: 'download' | 'share' | 'email') {
    if (!identity) return;
    setBusy(record.id);
    try {
      const proof = await getDesignProofLink(record.storage_path);
      if (action === 'email') setEmail({ proof, metadata: record.metadata, owner: identity.id });
      else if (action === 'share') {
        setShared({ url: proof.pdfUrl, owner: identity.id });
        try { await navigator.clipboard.writeText(proof.pdfUrl); toast.success('Proof link copied. Available for seven days.'); }
        catch { toast.success('Your download link is ready to copy below.'); }
      } else {
        const link = document.createElement('a');
        link.href = proof.pdfUrl; link.download = `${record.tool}-Design-Proof.pdf`;
        document.body.appendChild(link); link.click(); link.remove();
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : 'The proof could not be opened.'); }
    finally { setBusy(null); }
  }

  return <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900 sm:px-8">
    <Helmet><title>{wpw ? 'WPW ' : ''}DesignProofs — DesignProAI</title><meta name="robots" content="noindex,nofollow" /></Helmet>
    <div className="w-full max-w-6xl space-y-6" style={{ marginInline: 'auto' }}>
      <Link className="inline-flex items-center gap-2 text-sm text-blue-700" to={wpw ? '/shopflow' : '/dashboard'}><ArrowLeft className="h-4 w-4" />{wpw ? 'WPW ShopFlow' : 'Dashboard'}</Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">{wpw ? 'WePrintWraps · ' : ''}DesignProAI OS</p>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-bold"><FileCheck2 className="h-8 w-8 text-blue-600" />DesignProofs</h1>
        <p className="mt-3 max-w-2xl text-gray-600">Your saved approval PDFs, organized by system. Download or email every view in one document.</p>
      </header>

      {identity === undefined && <p role="status" className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading your account…</p>}
      {identity === null && <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="text-xl font-bold">Sign in to open your proof library</h2>
        <p className="mb-5 mt-2 text-sm text-gray-600">Use the same DesignProAI account you used to save the proof in PatternPro or WallPro. An order lookup alone does not open your private files.</p>
        <Link className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700" to="/login" state={{ from: wpw ? '/design-proofs?brand=weprintwraps' : '/design-proofs' }}>Sign in to DesignProAI</Link>
      </section>}

      {identity && <>
        <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4" onSubmit={event => { event.preventDefault(); setSearch(draft.trim()); setPage(0); }}>
          <label className="min-w-[140px] text-sm font-medium">System<select aria-label="System" className="mt-1 block w-full rounded-md border border-gray-300 bg-white p-2 text-gray-900" value={tool} onChange={event => { setTool(event.target.value); setPage(0); }}><option value="">All systems</option><option value="patternpro">PatternPro</option><option value="wallpro">WallPro</option></select></label>
          <label className="min-w-[200px] flex-1 text-sm font-medium">Find a proof<Input className="mt-1 border-gray-300 bg-white text-gray-900" value={draft} onChange={event => setDraft(event.target.value)} placeholder="DesignID, GenerationID, project, customer, or order" maxLength={160} /></label>
          <Button type="submit" className="gap-2 bg-blue-600 text-white hover:bg-blue-700"><Search className="h-4 w-4" />Search</Button>
          <Button type="button" variant="outline" className="border-gray-300 bg-white text-gray-900" onClick={() => void catalog.refetch()} disabled={catalog.isFetching} aria-label="Refresh proofs"><RefreshCw className={`h-4 w-4 ${catalog.isFetching ? 'animate-spin' : ''}`} /></Button>
        </form>
        {shared?.owner === identity.id && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4"><label className="text-sm font-medium">Share this PDF · link available for seven days<Input className="mt-2 bg-white text-gray-900" readOnly value={shared.url} onFocus={event => event.target.select()} /></label></div>}
        {catalog.isLoading && <p role="status">Loading saved proofs…</p>}
        {catalog.error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{catalog.error.message}</p>}
        {catalog.data?.proofs.length === 0 && <section className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center"><h2 className="text-lg font-bold">{search || tool ? 'No matching proofs' : 'Your saved proofs will appear here'}</h2><p className="mt-2 text-sm text-gray-600">{search || tool ? 'Try another system or design reference.' : 'Open 3D Proof in PatternPro or WallPro, then choose Save to DesignProofs, Share, or Email Proof.'}</p></section>}
        <div className="grid gap-4 md:grid-cols-2">
          {catalog.data?.proofs.map(record => <article key={record.id} className="min-w-0 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">{record.tool === 'wallpro' ? 'WallPro' : 'PatternPro'}</span><span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700">{record.brand === 'weprintwraps' ? 'WPW' : 'Standard'}</span></div>
            <h2 className="break-words text-lg font-bold">{record.metadata.vehicle}</h2>
            <p className="mt-1 break-words text-sm text-gray-700">{record.metadata.design} · {record.metadata.finish}</p>
            <p className="mt-1 text-sm text-gray-600">{proofQuantity(record.metadata)}</p>
            {record.metadata.customerName && <p className="mt-2 text-sm">Customer: {record.metadata.customerName}</p>}
            <dl className="my-4 space-y-1 break-all text-xs text-gray-500">
              <div><dt className="inline font-semibold">Saved: </dt><dd className="inline">{new Date(record.created_at).toLocaleString()}</dd></div>
              {([['DesignID', record.metadata.designId], ['GenerationID', record.metadata.generationId], ['Project ID', record.metadata.projectId], ['Source ID', !record.metadata.designId && !record.metadata.generationId && !record.metadata.projectId ? record.metadata.sourceId : undefined], ['Quote', record.metadata.quoteNumber], ['Order', record.metadata.orderNumber], ['Proof ID', record.id]] as const).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="inline font-semibold">{label}: </dt><dd className="inline">{value}</dd></div>)}
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-2 border-gray-300 bg-white text-gray-900" disabled={!!busy} onClick={() => void act(record, 'download')}><Download className="h-4 w-4" />PDF</Button>
              <Button size="sm" variant="outline" className="gap-2 border-gray-300 bg-white text-gray-900" disabled={!!busy} onClick={() => void act(record, 'share')}><Share2 className="h-4 w-4" />Share</Button>
              <Button size="sm" className="gap-2 bg-blue-600 text-white hover:bg-blue-700" disabled={!!busy} onClick={() => void act(record, 'email')}>{busy === record.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}Email Proof</Button>
            </div>
          </article>)}
        </div>
        {(page > 0 || catalog.data?.hasMore) && <div className="flex items-center justify-between"><Button variant="outline" disabled={page === 0 || catalog.isFetching} onClick={() => setPage(value => value - 1)}>Previous</Button><span className="text-sm">Page {page + 1}</span><Button variant="outline" disabled={!catalog.data?.hasMore || catalog.isFetching} onClick={() => setPage(value => value + 1)}>Next</Button></div>}
      </>}
      <footer className="border-t border-gray-200 pt-5 text-right text-xs text-gray-500">{wpw ? '® DesignProAI Software for WePrintWraps' : '® DesignProAI Software'}</footer>
    </div>
    {identity && email?.owner === identity.id && <DesignProofEmailDialog proof={email.proof} metadata={email.metadata} onClose={() => setEmail(null)} />}
  </main>;
}
