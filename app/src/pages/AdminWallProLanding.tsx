import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, ExternalLink, Upload, Save, Loader2, ImageIcon, Film, Check, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useWallProLandingMedia } from '@/hooks/useWallProLandingMedia';
import { LANDING_SLOTS, validateLandingMedia, validLandingUrl, type LandingMedia } from '@/lib/wallpro-landing-content';
import { uploadLandingMedia } from '@/lib/wallpro-landing-upload';

function SlotEditor({ slot, value, saved, onSaved, onDirty }: { slot: typeof LANDING_SLOTS[number]; value: LandingMedia; saved?: LandingMedia; onSaved: () => Promise<unknown>; onDirty: (key: string, dirty: boolean) => void }) {
  const [draft, setDraft] = useState(value);
  const [baseline, setBaseline] = useState(value);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mediaError, setMediaError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const posterInput = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => { onDirty(slot.key, dirty || !!busy); }, [slot.key, dirty, busy, onDirty]);
  useEffect(() => () => controller.current?.abort(), []);
  function edit(patch: Partial<LandingMedia>) { setDraft(d => ({ ...d, ...patch })); setNotice(''); setError(''); setMediaError(false); }

  async function upload(file: File | undefined, poster = false) {
    if (!file) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(poster ? 'Uploading cover' : 'Uploading'); setProgress(0); setError(''); setNotice('');
    try {
      const url = await uploadLandingMedia(file, slot.key, poster ? 'image' : slot.kind, setProgress, abort.signal);
      edit(poster ? { poster: url } : { src: url });
      setNotice('Uploaded. Preview it, then publish this space.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); }
    finally { setBusy(''); controller.current = null; }
  }

  async function save() {
    const problem = validateLandingMedia(draft);
    if (problem) { setError(problem); return; }
    setBusy('Publishing'); setError(''); setNotice('');
    try {
      const payload = { ...draft, title: draft.title.trim(), alt: draft.alt.trim(), updated_at: new Date().toISOString() };
      const table = supabase.from('wallpro_landing_media' as never);
      // Compare the saved revision so an old open tab cannot overwrite someone else's changes.
      const query = baseline.updated_at
        ? table.update(payload as never).eq('slot', slot.key).eq('updated_at', baseline.updated_at)
        : table.insert(payload as never);
      const { data, error: saveError } = await query.select('*').single();
      if (saveError || !data) throw new Error(saveError?.code === '23505' || saveError?.code === 'PGRST116' ? 'This space changed in another tab. Reload this page before publishing.' : saveError?.message || 'Publishing did not complete.');
      const published = data as unknown as LandingMedia;
      setDraft(published); setBaseline(published);
      await onSaved(); setNotice('Published. The landing page now uses this media.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not publish. Your changes are still here.'); }
    finally { setBusy(''); }
  }

  // A background refresh may update a clean card, never an unsaved draft's revision.
  useEffect(() => {
    if (!dirty && !busy) { setDraft(value); setBaseline(value); }
  }, [value.updated_at]);
  const safeSrc = validLandingUrl(draft.src) ? draft.src : '';
  const safePoster = validLandingUrl(draft.poster) ? draft.poster : '';
  return <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 md:p-6">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-bold">{slot.label}</h2><p className="mt-2 max-w-xl text-sm text-slate-300">{slot.help}</p></div><label className="flex items-center gap-2 text-sm"><Switch checked={draft.enabled} disabled={!!busy} onCheckedChange={enabled => edit({ enabled })} aria-label={`Show ${slot.label}`} />Show on page</label></div>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div><div className={`relative mx-auto overflow-hidden rounded-xl border border-slate-700 bg-black ${slot.ratio === '9:16' ? 'aspect-[9/16] max-w-[230px]' : 'aspect-video'}`}>
        {slot.kind === 'video' && safeSrc ? <video key={safeSrc} className="h-full w-full object-contain" src={safeSrc} poster={safePoster || undefined} controls playsInline preload="metadata" onError={() => setMediaError(true)} aria-label={`${slot.label} preview`} /> : (slot.kind === 'image' ? safeSrc : safePoster) ? <img key={safeSrc + safePoster} className="h-full w-full object-cover" src={slot.kind === 'image' ? safeSrc : safePoster} alt={draft.alt || `${slot.label} preview`} onError={() => setMediaError(true)} /> : <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">{slot.kind === 'video' ? <Film size={36} /> : <ImageIcon size={36} />}<span>No {slot.kind} selected</span></div>}
      </div>{mediaError && <p className="mt-3 text-sm text-amber-300">This media could not be previewed. Check the URL or upload a browser-compatible file. H.264 MP4 is recommended for video.</p>}
        <div className="mt-4 flex flex-wrap gap-2"><Button disabled={!!busy} variant="outline" onClick={() => fileInput.current?.click()}><Upload size={16} className="mr-2" />Upload {slot.kind}</Button>{slot.kind === 'video' && <Button disabled={!!busy} variant="outline" onClick={() => posterInput.current?.click()}>Upload cover</Button>}{slot.kind === 'video' && draft.src && <Button disabled={!!busy} variant="ghost" onClick={() => edit({ src: '' })}>Clear video</Button>}</div>
        <input ref={fileInput} type="file" className="hidden" accept={slot.kind === 'video' ? 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov' : 'image/jpeg,image/png,image/webp'} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={posterInput} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={e => { void upload(e.target.files?.[0], true); e.target.value = ''; }} />
        <p className="mt-3 text-xs text-slate-400">{slot.kind === 'video' ? 'MP4, WebM or MOV · up to 500 MB · MP4 recommended' : 'JPG, PNG or WebP · up to 20 MB'} · {slot.ratio}</p>
        {busy.startsWith('Uploading') && <div className="mt-3"><progress aria-label={busy} className="h-2 w-full" value={progress} max={100} /><div className="mt-1 flex justify-between text-sm"><span>{busy} · {progress}%</span><button type="button" className="underline" onClick={() => controller.current?.abort()}>Cancel</button></div></div>}
      </div>
      <fieldset disabled={!!busy} className="space-y-4 min-w-0"><label className="block text-sm">Title<Input className="mt-1" maxLength={180} value={draft.title} onChange={e => edit({ title: e.target.value })} /></label><label className="block text-sm">{slot.kind === 'video' ? 'Description' : 'Caption'}<Textarea className="mt-1" maxLength={800} value={draft.caption} onChange={e => edit({ caption: e.target.value })} /></label><label className="block text-sm">Image description<Input className="mt-1" maxLength={500} value={draft.alt} onChange={e => edit({ alt: e.target.value })} /><span className="mt-1 block text-xs text-slate-400">Describe the image for visitors using a screen reader.</span></label><label className="block text-sm">{slot.kind === 'video' ? 'Direct video URL' : 'Image URL'}<Input className="mt-1" value={draft.src} onChange={e => edit({ src: e.target.value.trim() })} placeholder="https://…" /><span className="mt-1 block text-xs text-slate-400">{slot.kind === 'video' ? 'A playable media-file URL, not a YouTube or Instagram page.' : 'Upload a file above or paste a secure image URL.'}</span></label>{slot.kind === 'video' && <label className="block text-sm">Cover image URL<Input className="mt-1" value={draft.poster} onChange={e => edit({ poster: e.target.value.trim() })} placeholder="https://…" /></label>}</fieldset>
    </div>
    <div className="mt-6 flex flex-wrap items-center gap-3"><Button disabled={!!busy || !dirty} onClick={() => void save()} className="bg-blue-600 text-white hover:bg-blue-500">{busy === 'Publishing' ? <Loader2 size={17} className="mr-2 animate-spin" /> : <Save size={17} className="mr-2" />}Publish this space</Button><Button disabled={!!busy || !dirty} variant="ghost" onClick={() => { setDraft(value); setBaseline(value); setError(''); setNotice(''); }}><RotateCcw size={15} className="mr-2" />Discard changes</Button>{!dirty && !busy && <span className="text-sm text-slate-400"><Check className="mr-1 inline h-4 w-4" />{saved ? 'Published' : 'Default media'}</span>}</div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-sky-200">{notice}</p>}
  </section>;
}

export default function AdminWallProLanding() {
  const query = useWallProLandingMedia();
  const dirtySlots = useRef(new Set<string>());
  const onDirty = useRef((key: string, dirty: boolean) => { if (dirty) dirtySlots.current.add(key); else dirtySlots.current.delete(key); }).current;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirtySlots.current.size) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return <div className="min-h-screen bg-[#061421] px-4 py-8 text-white md:px-8">
    <Helmet><title>WallPro Landing Media · Admin | DesignProAI</title><meta name="robots" content="noindex,nofollow" /></Helmet>
    <div className="mx-auto max-w-6xl"><div className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><Link to="/admin" className="mb-4 inline-flex items-center gap-2 text-sm text-slate-300"><ArrowLeft size={16} />Admin</Link><h1 className="text-3xl font-bold">WallPro landing media</h1><p className="mt-2 max-w-2xl text-slate-300">Swap images and videos, preview each space, then publish. Updates appear on the landing page without a deployment.</p></div><Button asChild variant="outline"><a href="/wallpro" target="_blank" rel="noreferrer">View landing page<ExternalLink size={16} className="ml-2" /></a></Button></div>
      <p className="mb-6 rounded-xl border border-sky-800/60 bg-sky-950/30 px-4 py-3 text-sm text-sky-100">Uploads here are public marketing media. Each space publishes separately. Videos stay as cover images until you supply a clip; playback uses controls and never starts with sound automatically.</p>
      {query.isLoading ? <p role="status" className="py-12 text-center">Loading saved media…</p> : query.isError ? <div role="alert" className="rounded-xl border border-red-700 p-6"><p>Saved media could not be loaded. Reload before making changes so existing content is protected.</p><Button className="mt-4" onClick={() => void query.refetch()}>Retry</Button></div> : <Tabs defaultValue="videos"><TabsList className="mb-6"><TabsTrigger value="videos">Videos &amp; reel</TabsTrigger><TabsTrigger value="images">Hero &amp; example images</TabsTrigger></TabsList>{['videos', 'images'].map(tab => <TabsContent key={tab} value={tab} forceMount className="space-y-6 data-[state=inactive]:hidden">{LANDING_SLOTS.filter(slot => (slot.kind === 'video') === (tab === 'videos')).map(slot => <SlotEditor key={slot.key} slot={slot} value={query.media[slot.key]} saved={query.data?.find(row => row.slot === slot.key)} onSaved={query.refetch} onDirty={onDirty} />)}</TabsContent>)}</Tabs>}
    </div>
  </div>;
}
