import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, ChevronRight, FileImage, Files, Layers, Loader2, ScanLine, ShieldCheck, Truck, Upload, X } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { observeAuthSession } from '@/lib/observe-auth-session';
import { dpApi, type CreateGenerationRequestOptions, type GenerationVehicle } from '@/lib/designpro-api';
import { OS_BRAND, PROOF_BRAND, osPageTitle } from '@/lib/os-brand';
import { useStickyOffset } from '@/lib/use-sticky-offset';
import { ToolAccountMenu } from '@/components/layout/ToolAccountMenu';
import { MagicStep, MagicFrame, MagicArrow, MAGIC_GRID } from '@/components/wallpro/WallProMagic';
import { AtlasPanelProofSheet } from '@/components/designpanelpro/AtlasPanelProofSheet';
import { useSubscriptionLimits } from '@/hooks/useSubscriptionLimits';
import { buildRecreateRequest, recreateInputError, recreateFileError, recreationLinks, RECREATE_MAX_FILES, RECREATE_PATHS, RECREATE_SURFACES, RECREATE_VEHICLES, type RecreatePath, type RecreatePayment } from '@/lib/recreatepro-intake';
import { clearRecreateDraft, loadRecreateDraft, saveRecreateDraft, type RecreateDraft, type RecreateReference } from '@/lib/recreatepro-draft';
import { prepareRecreateReference } from '@/lib/recreatepro-files';
import { importRecreateHandoff, RECREATE_HANDOFF_KEY } from '@/lib/recreatepro-handoff';
import './recreatepro.css';

const DEFAULT_VEHICLE: GenerationVehicle = { year: '', make: '', model: '', type: 'van' };
const PATH_ICONS = { exact: ScanLine, complete: Layers, transfer: Truck };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(['outputs_ready', 'failed', 'cancelled']);
const VIEW_LABELS: Record<string, string> = { driver: 'Driver', passenger: 'Passenger', hood: 'Hood', roof: 'Roof', front: 'Front', rear: 'Rear', closeup: 'Close-up', hero3d: 'Hero' };

function LocalImage({ file, alt, className = '' }: { file?: File; alt: string; className?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) { setUrl(''); return; }
    const value = URL.createObjectURL(file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return url ? <img src={url} alt={alt} className={className} /> : <FileImage aria-hidden="true" className="h-10 w-10 text-slate-400" />;
}
function Visual({ src, file, alt, icon: Icon = FileImage }: { src?: string; file?: File; alt: string; icon?: typeof FileImage }) {
  return <MagicFrame><div className="absolute inset-0 flex items-center justify-center p-2">
    {src ? <img src={src} alt={alt} className="h-full w-full object-contain" /> : file ? <LocalImage file={file} alt={alt} className="h-full w-full object-contain" /> : <div className="flex flex-col items-center gap-2 text-center text-slate-500"><Icon className="h-9 w-9" aria-hidden="true" /><span className="text-xs">{alt}</span></div>}
  </div></MagicFrame>;
}

export default function RecreatePro() {
  const [identity, setIdentity] = useState<{ id: string | null; ready: boolean; unavailable: boolean }>({ id: null, ready: false, unavailable: false });
  useEffect(() => observeAuthSession(supabase.auth, ({ user, unavailable }) => setIdentity({ id: user?.id || null, ready: true, unavailable })), []);
  return <RecreateWorkspace key={identity.id || 'guest'} ownerId={identity.id} authReady={identity.ready} authUnavailable={identity.unavailable} />;
}

function RecreateWorkspace({ ownerId, authReady, authUnavailable }: { ownerId: string | null; authReady: boolean; authUnavailable: boolean }) {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const queryRequest = search.get('request');
  const requestId = queryRequest && UUID.test(queryRequest) ? queryRequest : null;
  const stickyTop = useStickyOffset('recreatepro-header');
  const { subscription, loading: subscriptionLoading } = useSubscriptionLimits();
  const [path, setPath] = useState<RecreatePath | null>(null);
  const [payment, setPayment] = useState<RecreatePayment>('project');
  const [vehicle, setVehicle] = useState<GenerationVehicle>({ ...DEFAULT_VEHICLE });
  const [notes, setNotes] = useState('');
  const [references, setReferences] = useState<RecreateReference[]>([]);
  const [rights, setRights] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [storageWarning, setStorageWarning] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedView, setSelectedView] = useState('driver');
  const [handoffReady, setHandoffReady] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [sourceGenerationId, setSourceGenerationId] = useState<string>();
  const [submitted, setSubmitted] = useState<CreateGenerationRequestOptions>();
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLElement>(null);
  const live = useRef(true);
  const submitLock = useRef(false);
  const fileLock = useRef(false);
  const handoffAttempt = useRef('');
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const owner = ownerId || 'guest';
  const choice = RECREATE_PATHS.find(item => item.key === path);
  const persist = (draft: RecreateDraft) => {
    const operation = saveQueue.current.then(() => saveRecreateDraft(owner, draft));
    saveQueue.current = operation.catch(() => undefined);
    return operation;
  };
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  useEffect(() => {
    if (!authReady) return;
    let active = true;
    void (async () => {
      try {
        let draft = await loadRecreateDraft(owner);
        if (!draft && ownerId && !requestId) {
          draft = await loadRecreateDraft('guest');
          if (draft) { await saveRecreateDraft(owner, draft); await clearRecreateDraft('guest'); }
        }
        if (!active) return;
        // Existing VehiclePro callers already carry their references. Recover
        // them here rather than asking the customer to upload a second time.
        let handoff: string | null = null;
        try { if (!requestId) handoff = sessionStorage.getItem(RECREATE_HANDOFF_KEY); } catch { /* private mode */ }
        if (handoff) {
          try {
            const imported = await importRecreateHandoff(handoff);
            if (!active) return;
            draft = { version: 1, updatedAt: Date.now(), path: 'exact', payment: 'project', vehicle: imported.vehicle, references: imported.references, notes: '' };
            await saveRecreateDraft(owner, draft);
            try { sessionStorage.removeItem(RECREATE_HANDOFF_KEY); } catch { /* private mode */ }
          } catch (issue) {
            if (active) setError(issue instanceof Error ? issue.message : 'Upload your reference to continue.');
          }
        }
        // A URL always selects its own job. A different local draft cannot put
        // another customer's reference or submission behind that URL.
        if (draft && (!requestId || draft.requestId === requestId)) {
          setPath(draft.path); setPayment(draft.payment); setVehicle(draft.vehicle);
          setNotes(draft.notes); setReferences(draft.references); setSubmitted(draft.submitted);
          setSourceGenerationId(draft.sourceGenerationId);
          if (!requestId && draft.requestId && UUID.test(draft.requestId)) setSearch({ request: draft.requestId }, { replace: true });
        }
      } catch { if (active) setStorageWarning('This browser cannot save a local draft. Keep this page open until your upload is accepted.'); }
      finally { if (active) setHydrated(true); }
    })();
    return () => { active = false; };
    // Rehydrate only on an account change, not every progress URL update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, authReady]);

  const draft = (): RecreateDraft => ({ version: 1, updatedAt: Date.now(), path, payment, vehicle, notes, references, requestId: requestId || undefined, submitted, sourceGenerationId });
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => { void persist(draft()).catch(() => { if (live.current) setStorageWarning('Draft saving is unavailable. Your accepted server job is still saved.'); }); }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, path, payment, vehicle, notes, references, requestId, submitted, sourceGenerationId]);

  const request = useQuery({
    queryKey: ['recreatepro', owner, requestId, 'request'], enabled: Boolean(ownerId && requestId),
    queryFn: () => dpApi.getGenerationRequest(requestId!), retry: 1,
    refetchInterval: query => TERMINAL.has(query.state.data?.state || '') ? false : 3000,
  });
  const state = request.data;
  const views = useQuery({
    queryKey: ['recreatepro', owner, requestId, 'views'], enabled: Boolean(ownerId && requestId),
    queryFn: () => dpApi.listGenerationViews(requestId!), retry: 1,
    refetchInterval: state && TERMINAL.has(state.state) ? 60000 : 4000,
  });
  const art = useQuery({
    queryKey: ['recreatepro', owner, requestId, 'art'], enabled: Boolean(ownerId && requestId),
    queryFn: () => dpApi.listFlatAtlasRevisions(requestId!), retry: 1,
    refetchInterval: state && TERMINAL.has(state.state) ? 60000 : 4000,
  });
  const proof = useQuery({
    queryKey: ['recreatepro', owner, requestId, 'proof'], enabled: Boolean(ownerId && requestId),
    queryFn: () => dpApi.getAtlasPanelProof(requestId!), retry: 1,
    refetchInterval: state && TERMINAL.has(state.state) ? 60000 : 4000,
  });
  const revisions = art.data?.slice().sort((a, b) => a.revisionSequence - b.revisionSequence) || [];
  const latest = revisions[revisions.length - 1];
  const visibleViews = views.data || [];
  const view = visibleViews.find(item => item.consumerRole === selectedView) || visibleViews.find(item => item.consumerRole === 'driver') || visibleViews[0];
  const firstPanel = latest?.callOnePanels?.find(panel => panel.surfaceKey === 'driver') || latest?.callOnePanels?.[0];
  const links = state?.generationId ? recreationLinks(state.generationId, latest?.id || state.atlasRevisionId) : null;
  const generating = Boolean(state && !TERMINAL.has(state.state));
  const locked = busy || fileBusy || Boolean(requestId || submitted);

  async function prepareProduction() {
    if (!state?.handoffReady) return;
    setHandoffError('');
    try {
      await dpApi.handoffGeneration(state.requestId);
      if (live.current) setHandoffReady(true);
    } catch (issue) {
      if (live.current) setHandoffError(`Your design is saved, but production preparation could not reconnect. ${issue instanceof Error ? issue.message : ''}`);
    }
  }
  useEffect(() => {
    if (!state?.handoffReady || handoffAttempt.current === state.requestId) return;
    handoffAttempt.current = state.requestId;
    void prepareProduction();
    // One idempotent handoff per request. Failure has an explicit retry action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.requestId, state?.handoffReady]);

  async function addFiles(files: FileList | File[]) {
    if (locked || fileLock.current) return;
    const batch = Array.from(files);
    if (references.length + batch.length > RECREATE_MAX_FILES) { setError('Keep this project to six reference images. Remove one before adding another.'); return; }
    fileLock.current = true; setFileBusy(true); setError('');
    try {
      const prepared: RecreateReference[] = [];
      for (const file of batch) {
        prepared.push(await prepareRecreateReference(file));
        if (!live.current) return;
      }
      setReferences(current => [...current, ...prepared]);
    } catch (issue) { if (live.current) setError(issue instanceof Error ? issue.message : 'The file could not be opened.'); }
    finally { fileLock.current = false; if (live.current) setFileBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitLock.current || requestId) return;
    const invalid = submitted ? null : recreateInputError({ path, count: references.length, vehicle, notes, rights });
    if (invalid) { setError(invalid); return; }
    if (!authReady || !hydrated) return;
    if (!ownerId) {
      try { await persist(draft()); }
      catch { setError('This browser cannot carry the upload through sign-in. Sign in first, then add your files.'); return; }
      navigate('/login', { state: { from: '/recreatepro' } });
      return;
    }
    if (subscriptionLoading) { setError('Your account access is still loading.'); return; }
    if (payment === 'subscription' && !subscription) { setError('No active subscription was found. Use Pay per project to continue, or activate your DesignProAI subscription first.'); return; }
    submitLock.current = true; setBusy(true); setError('');
    preview.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      // Billing and design allowance are enforced by the shared server request.
      // Never run a client-side overage charge, especially on an idempotent retry.
      if (!live.current) return;
      let input = submitted;
      if (!input) {
        const generationId = crypto.randomUUID().toLowerCase();
        const uploaded = [];
        for (const [index, reference] of references.entries()) {
          setMessage(`Uploading and verifying reference ${index + 1} of ${references.length}…`);
          if (reference.originalPdf) await dpApi.uploadRevisionAsset(generationId, 'attachment', reference.originalPdf);
          if (!live.current) return;
          const asset = await dpApi.uploadRevisionAsset(generationId, 'attachment', reference.file);
          if (!live.current) return;
          uploaded.push({ asset, surface: reference.surface });
        }
        input = buildRecreateRequest({ generationId, path: path!, vehicle, notes, references: uploaded, sourceGenerationId });
        setSubmitted(input);
        // Persist the exact envelope before POST. An ambiguous network result
        // retries this same identity and payload, never spends on a new job.
        try { await persist({ ...draft(), submitted: input }); }
        catch { setStorageWarning('Keep this page open until the job is accepted; browser draft storage is unavailable.'); }
      }
      if (!live.current) return;
      setMessage('Submitting your recreation to the design and production workflow…');
      const accepted = await dpApi.createGenerationRequest(input);
      if (!live.current) return;
      if (accepted.generationId !== input.generationId || accepted.pipelineMode !== input.pipelineMode) throw new Error('The server returned a different job identity. Your original request is preserved.');
      // Publish the durable URL even when local browser storage is unavailable.
      setSearch({ request: accepted.requestId }, { replace: true });
      try { await persist({ ...draft(), submitted: input, requestId: accepted.requestId }); } catch { /* URL is the server recovery key. */ }
    } catch (issue) { if (live.current) setError(`${issue instanceof Error ? issue.message : 'The request could not be confirmed.'} Your files and request are preserved. Retry checks the same design identity.`); }
    finally { submitLock.current = false; if (live.current) { setBusy(false); setMessage(''); } }
  }

  function startFresh() {
    if (busy || fileBusy || (submitted && !requestId) || generating) return;
    setSearch({}, { replace: true }); setSubmitted(undefined); setReferences([]); setNotes('');
    setRights(false); setReviewed(false); setHandoffReady(false); setHandoffError('');
    setSourceGenerationId(undefined); handoffAttempt.current = ''; setError('');
    saveQueue.current = saveQueue.current.then(() => clearRecreateDraft(owner)).catch(() => undefined);
  }

  async function transferResult() {
    if (!reviewed || !state || !latest || !latest.callOnePanels?.length || busy) return;
    const panels = latest.callOnePanels;
    if (panels.some(panel => !panel.signedUrl)) { setError('Some source panels are not available yet. Refresh the saved design before transferring.'); return; }
    setBusy(true); setError('');
    try {
      const transferred: RecreateReference[] = [];
      for (const panel of panels) {
        const response = await fetch(panel.signedUrl!);
        if (!response.ok) throw new Error('A saved panel could not be read. The current design has not changed.');
        const blob = await response.blob();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== panel.contentHash) throw new Error('The panel did not match its saved identity. Transfer was stopped.');
        const extension = panel.contentType === 'image/jpeg' ? 'jpg' : panel.contentType === 'image/webp' ? 'webp' : 'png';
        const file = new File([blob], `${panel.surfaceKey}.${extension}`, { type: panel.contentType });
        const invalid = recreateFileError(file);
        if (invalid) throw new Error(invalid);
        transferred.push({ id: crypto.randomUUID(), file, surface: panel.surfaceKey });
        if (!live.current) return;
      }
      setReferences(transferred); setPath('transfer'); setSourceGenerationId(state.generationId);
      setVehicle({ ...DEFAULT_VEHICLE, type: vehicle.type }); setNotes(''); setRights(false); setReviewed(false);
      setSubmitted(undefined); setSearch({}, { replace: true }); setHandoffReady(false); setHandoffError(''); handoffAttempt.current = '';
      document.getElementById('recreatepro-intake')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (issue) { if (live.current) setError(issue instanceof Error ? issue.message : 'Transfer could not be prepared.'); }
    finally { if (live.current) setBusy(false); }
  }

  const stage = requestId ? generating || !visibleViews.length ? 2 : reviewed ? 4 : 3 : 1;
  return <div className="recreatepro min-h-screen bg-[#f7f8fb] text-slate-950">
    <Helmet><title>{osPageTitle('RecreatePro')}</title><meta name="description" content="Recreate an AI design, photo or partial vehicle wrap, complete the missing surfaces, and move through review to production-ready files." /></Helmet>
    <header id="recreatepro-header" className="recreate-header sticky z-30 border-b border-blue-400 bg-slate-950 px-4 py-3 text-white" style={{ top: stickyTop }}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><Link to="/designpro" className="text-xs font-bold tracking-wider text-blue-300">{OS_BRAND.name}</Link><div className="text-2xl font-extrabold tracking-tight">Recreate<span className="recreate-wordmark">Pro</span><sup className="ml-0.5 text-[10px]">™</sup></div><span className="hidden border-l border-white/20 pl-4 text-xs text-slate-300 lg:block">Your design. Rebuilt for print.</span></div>
        <div className="flex items-center gap-3"><Link to="/revision-studio" className="text-xs font-semibold text-blue-200">My designs</Link><ToolAccountMenu /></div>
      </div>
    </header>
    <div className="mx-auto max-w-7xl space-y-6 px-4 pb-28 pt-4 sm:px-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-slate-500"><Link to="/designpro">Home</Link><ChevronRight className="h-3 w-3" /><span aria-current="page">RecreatePro</span></nav>
      <section className="recreate-hero rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
        <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-700">From reference to real production</div>
        <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight sm:text-4xl">Got the picture?<br /><span className="text-blue-700">Get the print files.</span></h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Bring your AI artwork, screenshot, old proof or a photo of one side. Recreate the design, complete the wrap, or adapt it to another vehicle—then review, revise and prepare it for print.</p>
        <p className="mt-3 text-xs text-slate-500">Reconstruction is reviewed against your reference. Final print files follow dimension checks, production approval and quality control.</p>
      </section>
      <fieldset disabled={locked} aria-label="Choose your RecreatePro path" className="grid gap-3 md:grid-cols-3">
        <legend className="mb-3 text-lg font-bold">What do you need RecreatePro to do?</legend>
        {RECREATE_PATHS.map(item => { const Icon = PATH_ICONS[item.key]; return <button type="button" key={item.key} aria-pressed={path === item.key} onClick={() => { setPath(item.key); setError(''); document.getElementById('recreatepro-intake')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className={`recreate-path rounded-xl border p-4 text-left transition ${path === item.key ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-500/20' : 'border-slate-200 bg-white hover:border-blue-400'}`}>
          <div className="flex items-center justify-between"><Icon className="mb-3 h-6 w-6 text-blue-700" />{path === item.key && <Check className="h-5 w-5 text-blue-700" />}</div><span className="block text-sm font-extrabold">{item.title}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{item.description}</span>
        </button>; })}
      </fieldset>
      <section aria-label="Your reference-to-print workflow" className={MAGIC_GRID}>
        <MagicStep n={1} title="Upload What You Have" copy="AI artwork, a proof, a photo—even one side." active={stage === 1}><Visual file={references[0]?.file} alt="Your uploaded reference" icon={Upload} /></MagicStep><MagicArrow />
        <MagicStep n={2} title="Recreate + Complete" copy="Rebuild the artwork and complete missing surfaces." active={stage === 2}><Visual src={proof.data?.sheet?.signedUrl || firstPanel?.signedUrl} alt="Your recreated artwork appears here" icon={Layers} /></MagicStep><MagicArrow />
        <MagicStep n={3} title="Review + Revise" copy="Compare the result and refine it in RevisionStudioIQ." active={stage === 3}><Visual src={view?.signedUrl} alt="Your actual vehicle preview" icon={ScanLine} /></MagicStep><MagicArrow />
        <MagicStep n={4} title="Make It Printable" copy="Review panels, approve production, then get your files." active={stage === 4}><Visual src={firstPanel?.signedUrl} alt="Production panel preview—not a final print file" icon={Files} /></MagicStep>
      </section>
      {storageWarning && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{storageWarning}</p>}
      {requestId && !ownerId && authReady && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">Sign in to reopen this saved design. <button type="button" className="font-bold underline" onClick={() => navigate('/login', { state: { from: `/recreatepro?request=${requestId}` } })}>Sign in</button></div>}
      {authUnavailable && <p role="alert" className="text-sm text-amber-800">Your session could not be checked. Sign in before submitting a recreation.</p>}
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.4fr)]">
        <form id="recreatepro-intake" className="scroll-mt-28 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" onSubmit={submit}>
          <fieldset disabled={locked} className="min-w-0 space-y-5">
            <div><h2 className="text-lg font-extrabold">{choice ? choice.title : 'Choose a path to begin'}</h2><p className="mt-1 text-xs leading-5 text-slate-600">{choice?.upload || 'Your reference and any edit instructions stay together throughout the job.'}</p></div>
            <div onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (path) void addFiles(event.dataTransfer.files); }}>
              <button type="button" disabled={!path || locked} onClick={() => fileInput.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/60 px-3 py-6 text-center hover:bg-blue-50 disabled:opacity-50"><Upload className="h-7 w-7 text-blue-600" /><span className="text-sm font-bold">Click to upload or drop your design</span><span className="text-xs text-slate-600">JPG, PNG, WebP or PDF · up to 6 files · 25 MB each</span></button>
              <input ref={fileInput} type="file" aria-label="Upload design references" className="sr-only" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={event => { if (event.target.files) void addFiles(event.target.files); }} />
              <p className="mt-2 text-[11px] leading-4 text-slate-500">PDFs use page 1 as the visual reference. The original PDF is retained. Export additional pages as images to include them.</p>
            </div>
            {references.length > 0 && <div className="grid grid-cols-2 gap-3">{references.map((reference, index) => <div key={reference.id} className="min-w-0 rounded-lg border border-slate-200 p-2"><div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded bg-slate-100"><LocalImage file={reference.file} alt={`Reference ${index + 1}`} className="h-full w-full object-contain" /><button type="button" aria-label={`Remove reference ${index + 1}`} onClick={() => setReferences(current => current.filter(item => item.id !== reference.id))} className="absolute right-1 top-1 rounded-full bg-white p-1 shadow"><X className="h-4 w-4" /></button></div><p className="mt-1 truncate text-[10px] text-slate-500" title={reference.file.name}>{reference.originalPdf ? 'PDF page 1 · ' : ''}{reference.file.name}</p><label className="mt-1 block text-[10px] font-semibold">This image shows<select aria-label={`Surface for reference ${index + 1}`} value={reference.surface} onChange={event => setReferences(current => current.map(item => item.id === reference.id ? { ...item, surface: event.target.value as RecreateReference['surface'] } : item))} className="mt-1 w-full rounded border border-slate-300 bg-white p-1.5 text-xs">{RECREATE_SURFACES.map(surface => <option key={surface.value} value={surface.value}>{surface.label}</option>)}</select></label></div>)}</div>}
            <div><h3 className="mb-2 text-sm font-bold">{path === 'transfer' ? 'Which vehicle are we moving it to?' : 'Which vehicle are we making this for?'}</h3><div className="grid grid-cols-2 gap-3"><label className="recreate-label">Vehicle type<select value={vehicle.type} onChange={event => setVehicle(current => ({ ...current, type: event.target.value as GenerationVehicle['type'] }))}>{RECREATE_VEHICLES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="recreate-label">Year<input inputMode="numeric" placeholder="2024" maxLength={4} value={vehicle.year} onChange={event => setVehicle(current => ({ ...current, year: event.target.value }))} /></label><label className="recreate-label">Make<input placeholder="Ford" maxLength={120} value={vehicle.make} onChange={event => setVehicle(current => ({ ...current, make: event.target.value }))} /></label><label className="recreate-label">Model / configuration<input placeholder="Transit 250, high roof" maxLength={120} value={vehicle.model} onChange={event => setVehicle(current => ({ ...current, model: event.target.value }))} /></label></div><p className="mt-2 text-[11px] text-slate-500">Include roof height, wheelbase or body configuration. Final production dimensions are verified before output.</p></div>
            <label className="recreate-label">Any edits or instructions? <span className="font-normal text-slate-500">Optional</span><textarea rows={4} value={notes} maxLength={4000} onChange={event => setNotes(event.target.value)} placeholder={'“Keep the same design, change the phone number to …”\n“Only have the driver side. Complete the rest.”'} /><span className="mt-1 block text-[11px] font-normal text-slate-500">Leave blank to keep the original design. Specific edits override only the details you name.</span></label>
            <fieldset aria-label="How would you like to use RecreatePro?"><legend className="mb-2 text-sm font-bold">Use it your way</legend><div className="grid grid-cols-2 gap-2">{([{ value: 'project', title: 'Pay per project', copy: 'No monthly plan required' }, { value: 'subscription', title: 'My subscription', copy: 'Use an existing plan' }] as const).map(item => <label key={item.value} className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-xs ${payment === item.value ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}><input type="radio" name="paymentPath" value={item.value} checked={payment === item.value} onChange={() => setPayment(item.value)} /><span><strong className="block">{item.title}</strong><span className="mt-1 block text-[10px] text-slate-600">{item.copy}</span></span></label>)}</div><p className="mt-2 text-[11px] leading-5 text-slate-500">{payment === 'project' ? 'Review your recreation, then purchase the Production Pack for the approved version. Design-credit requirements still apply.' : 'Your existing plan and design-credit rules apply. Production Packs are purchased separately; a subscription does not automatically unlock print files.'}</p></fieldset>
            <label className="flex items-start gap-2 text-xs leading-5 text-slate-600"><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} className="mt-1" /><span>I own this artwork or have permission to recreate and print it.</span></label>
          </fieldset>
          {fileBusy && <p role="status" className="mt-3 flex gap-2 text-xs text-blue-700"><Loader2 className="h-4 w-4 animate-spin" />Preparing your reference…</p>}
          {!requestId && <button type="submit" disabled={busy || fileBusy || !path || !authReady || !hydrated} className="recreate-primary mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{busy ? 'Submitting…' : submitted ? 'Retry this saved request' : !ownerId ? 'Sign in & keep my design' : choice?.action || 'Choose a path above'}</button>}
          {submitted && !requestId && <p className="mt-2 text-xs leading-5 text-slate-600">The submission is preserved. Retrying uses the same design ID and uploads—it does not create a second order.</p>}
          {requestId && <div className="mt-4 space-y-2"><p className="text-xs leading-5 text-slate-600">Your source is preserved. Changes to this saved design belong in RevisionStudioIQ.</p><button type="button" disabled={busy || generating || !state} onClick={startFresh} className="recreate-secondary w-full">Start another recreation</button></div>}
        </form>
        <section ref={preview} aria-label="Recreation preview and progress" className="min-w-0 scroll-mt-28 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-extrabold">Your design, coming together</h2>{state?.designId && <span className="text-xs font-semibold text-slate-500">{state.designId} · V{latest?.revisionSequence || 1}</span>}</div>
            {(busy || generating) && <div role="status" aria-live="polite" className="my-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800"><Loader2 className="h-4 w-4 shrink-0 animate-spin" /><span>{message || (state?.phase === 'photographer' ? `Preparing vehicle views · ${state.shotsComplete || 0} of ${state.shotsTotal || 7} reported complete` : 'Recreating your artwork. Saved previews appear here as they arrive.')}</span></div>}
            {request.isError && <div role="alert" className="my-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Status could not be refreshed. Your saved job has not been restarted.<button type="button" onClick={() => { void request.refetch(); void views.refetch(); void art.refetch(); void proof.refetch(); }} className="ml-2 underline">Refresh status</button></div>}
            {state && ['failed', 'cancelled'].includes(state.state) && <div role="alert" className="my-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">This recreation needs attention. Your source and any completed artwork remain saved.{state.failureCode && <details className="mt-2"><summary>Technical detail</summary>{state.failureCode}</details>}</div>}
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><div><p className="mb-1 text-xs font-bold text-slate-500">YOUR REFERENCE</p><div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-slate-100">{references[0] ? <LocalImage file={references[0].file} alt="Original uploaded design" className="h-full w-full object-contain" /> : <p className="px-4 text-center text-xs text-slate-500">{requestId ? 'Original reference is retained with the saved job.' : 'Upload your design to see it here.'}</p>}</div></div><div><p className="mb-1 text-xs font-bold text-blue-700">RECREATED PREVIEW</p><div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-slate-100">{view?.signedUrl || firstPanel?.signedUrl ? <img src={view?.signedUrl || firstPanel?.signedUrl} alt={view ? `${VIEW_LABELS[view.consumerRole] || view.consumerRole} preview of the recreated design` : 'First saved production panel preview'} className="h-full w-full object-contain" /> : <div className="flex flex-col items-center gap-2 px-5 text-center"><Layers className="h-9 w-9 text-blue-400" /><p className="text-xs leading-5 text-slate-500">The actual recreated artwork appears here. Compare it with your original before approving.</p></div>}</div></div></div>
            {visibleViews.length > 0 && <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">{visibleViews.map(item => <button type="button" key={item.consumerRole} onClick={() => setSelectedView(item.consumerRole)} aria-pressed={view?.consumerRole === item.consumerRole} className={`overflow-hidden rounded-lg border p-1 ${view?.consumerRole === item.consumerRole ? 'border-blue-600 ring-1 ring-blue-500' : 'border-slate-200'}`}>{item.signedUrl && <img src={item.signedUrl} alt="" className="aspect-[4/3] w-full object-contain" />}<span className="block text-[9px] font-semibold">{VIEW_LABELS[item.consumerRole] || item.consumerRole}</span></button>)}</div>}
            {requestId && <p className="mt-3 break-all text-[10px] text-slate-400">Request {requestId}{state?.generationId ? ` · Generation ${state.generationId}` : ''}</p>}
          </div>
          {requestId && <AtlasPanelProofSheet proof={proof.data} status={proof.status} />}
          {links && <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><h3 className="text-lg font-extrabold">Review it. Make it yours. Take it to print.</h3><p className="mt-2 text-xs leading-5 text-slate-600">Your original instructions, design versions, production panels and files stay linked to this design. {PROOF_BRAND.short} is a review document; final print files are released after production checks.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><Link to={links.revision} className="recreate-primary flex items-center justify-center rounded-lg px-4 py-3 text-center text-sm font-bold text-white">Open RevisionStudioIQ</Link>{handoffReady ? <Link to={links.production} className="recreate-secondary flex items-center justify-center text-center">Review & order print files</Link> : <span className="recreate-secondary text-center text-slate-500">{handoffError ? 'Production preparation needs attention' : state?.handoffReady ? 'Connecting production…' : 'Production opens when the proof set is ready'}</span>}</div>{handoffError && <p role="alert" className="mt-3 text-xs text-amber-800">{handoffError}<button type="button" onClick={() => void prepareProduction()} className="ml-2 underline">Retry preparation</button></p>}
            {latest?.callOnePanels?.length && state?.state === 'outputs_ready' ? <div className="mt-4 border-t border-slate-200 pt-4"><label className="flex items-start gap-2 text-xs leading-5 text-slate-600"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} className="mt-1" />I have reviewed this reconstruction against my source, including text and logos.</label><button type="button" disabled={!reviewed || busy} onClick={() => void transferResult()} className="recreate-secondary mt-3 flex w-full items-center justify-center gap-2 disabled:opacity-50"><Truck className="h-4 w-4" />Use this design on another vehicle</button><p className="mt-2 text-[11px] text-slate-500">Uses this version’s saved panel artwork—not a reinterpretation of the original screenshot. Your existing job stays intact.</p></div> : null}
          </div>}
          {!requestId && <div className="rounded-xl border border-blue-100 bg-white p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-5 w-5 text-blue-600" />One connected production workflow</h3><p className="mt-2 text-xs leading-6 text-slate-600">Reference → Recreated artwork → Vehicle previews → RevisionStudioIQ → Production Pack → PanelPro quality checks → WrapBox files.</p><p className="mt-2 text-[11px] leading-5 text-slate-500">Missing views are designed from the reference’s visual language, not recovered originals. Review spelling, logos, layout and inferred surfaces before approving production.</p></div>}
        </section>
      </div>
    </div>
  </div>;
}
