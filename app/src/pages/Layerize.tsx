import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Download, FileImage, Layers3, Loader2, LockKeyhole, Scissors, ShieldCheck, Shirt, Upload, WalletCards } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type OutputMode = "editable_layers" | "screen_print" | "embroidery_prep";
type AssetIdentity = { storagePath: string; contentHash: string; byteSize: number; contentType: string };
type LayerizeResult = {
  success: boolean; idempotent?: boolean; runId: string; tokensCharged?: number;
  layerCount: number; pathCount: number; warnings?: string[]; fidelityLock: boolean;
  generativeAiUsed: boolean; zipUrl: string; masterSvgUrl: string; layerizedSvgUrl: string;
};

const MODES: Array<{id:OutputMode;title:string;subtitle:string;detail:string;icon:typeof Layers3}> = [
  { id:"editable_layers", title:"Editable Layers", subtitle:"Flattened art → production layers", detail:"Fidelity master plus separated SVG/EPS color layers for Illustrator, CorelDRAW and production editing.", icon:Layers3 },
  { id:"screen_print", title:"Screen Print", subtitle:"Production color separations", detail:"Adds one solid-black SVG/EPS plate per derived source color. Visible lettering remains source-derived outlines.", icon:Scissors },
  { id:"embroidery_prep", title:"Embroidery Prep", subtitle:"Clean vectors for digitizing", detail:"Separated vector art and a thread-color map. DST/PES stitch programming remains a digitizer step.", icon:Shirt },
];

const MAX_BYTES = 25 * 1024 * 1024;
const MIME_BY_EXT: Record<string,string> = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", svg:"image/svg+xml" };

async function sessionToken() {
  const result = await supabase.auth.getSession();
  const token = result.data.session?.access_token;
  if (!token) throw new Error("auth_required");
  return token;
}

async function api<T>(path:string, body:unknown):Promise<T> {
  const token = await sessionToken();
  const response = await fetch("/api" + path, {
    method:"POST", credentials:"include",
    headers:{ "content-type":"application/json", authorization:"Bearer " + token },
    body:JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(payload?.error || "layerize_api_" + response.status)) as Error & {status?:number};
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

async function fileHash(file:File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2,"0")).join("");
}

async function uploadSource(file:File):Promise<AssetIdentity> {
  if (file.size < 1 || file.size > MAX_BYTES) throw new Error("file_size_invalid");
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) throw new Error("file_type_invalid");
  const intent = await api<{signedUrl:string;asset:AssetIdentity}>("/assets/upload-intents", {
    revisionId:crypto.randomUUID(), kind:"attachment", contentHash:await fileHash(file),
    contentType, byteSize:file.size, fileName:file.name,
  });
  const form = new FormData();
  form.append("cacheControl","31536000");
  form.append("",file);
  const uploaded = await fetch(intent.signedUrl, { method:"PUT", headers:{"x-upsert":"false"}, body:form });
  if (!uploaded.ok && ![400,409].includes(uploaded.status)) throw new Error("storage_upload_" + uploaded.status);
  const verified = await api<{asset:AssetIdentity & {verified:true}}>("/assets/verify", {asset:intent.asset});
  return verified.asset;
}

function friendlyError(error:unknown) {
  const raw = error instanceof Error ? error.message : String(error || "layerize_failed");
  if (raw.includes("layerize_tokens_required")) return "Layerize needs 3 tokens. A $25 pay-per-use pack adds exactly 3.";
  if (raw.includes("layerize_svg_requires_outlined_paths")) return "This SVG still contains live text or non-path objects. Outline the type first, or upload the flattened PNG/JPG so Layerize preserves the visible letterforms.";
  if (raw.includes("layerize_source_too_large_pixels")) return "This source is too large to fidelity-trace in one pass. Export at 24 megapixels or less without changing the artwork.";
  if (raw.includes("layerize_run_in_progress")) return "This exact file is already being Layerized. The same file will not be charged twice.";
  if (raw.includes("file_size_invalid")) return "Files must be between 1 byte and 25 MB.";
  if (raw.includes("file_type_invalid")) return "Layerize accepts PNG, JPG/JPEG, WEBP, and outlined SVG.";
  return raw.replaceAll("_"," ");
}

export default function Layerize() {
  const navigate = useNavigate();
  const [file,setFile] = useState<File|null>(null);
  const [preview,setPreview] = useState("");
  const [mode,setMode] = useState<OutputMode>("editable_layers");
  const [balance,setBalance] = useState<number|null>(null);
  const [privileged,setPrivileged] = useState(false);
  const [loadingAccess,setLoadingAccess] = useState(true);
  const [running,setRunning] = useState(false);
  const [message,setMessage] = useState("");
  const [result,setResult] = useState<LayerizeResult|null>(null);
  const selected = useMemo(() => MODES.find(x => x.id === mode)!, [mode]);

  useEffect(() => {
    let live = true;
    (async () => {
      const userResult = await supabase.auth.getUser();
      const user = userResult.data.user;
      if (!user) { if (live) setLoadingAccess(false); return; }
      const responses = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id",user.id).in("role",["admin","tester"]).limit(1),
        supabase.from("user_tokens").select("balance").eq("user_id",user.id).maybeSingle(),
      ]);
      if (!live) return;
      setPrivileged(Boolean(responses[0].data?.length));
      setBalance(Number(responses[1].data?.balance || 0));
      setLoadingAccess(false);
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!running) { setMessage(""); return; }
    const messages = ["Verifying the original bytes…","Fidelity Lock: preserving letterforms…","Tracing fine geometry with no node simplification…","Separating production colors…","Building SVG + EPS layers…","Packaging the Layerize ZIP…"];
    let i = 0;
    setMessage(messages[0]);
    const timer = window.setInterval(() => { i = Math.min(i + 1, messages.length - 1); setMessage(messages[i]); }, 4500);
    return () => window.clearInterval(timer);
  }, [running]);

  const chooseFile = (next?:File|null) => {
    if (!next) return;
    const ext = (next.name.split(".").pop() || "").toLowerCase();
    if (!MIME_BY_EXT[ext]) { toast({title:"Unsupported file",description:"Use PNG, JPG/JPEG, WEBP, or outlined SVG.",variant:"destructive"}); return; }
    if (next.size > MAX_BYTES) { toast({title:"File too large",description:"Layerize accepts files up to 25 MB.",variant:"destructive"}); return; }
    setFile(next);
    setResult(null);
  };

  const run = async () => {
    if (!file) return;
    if (!privileged && (balance ?? 0) < 3) { navigate("/try#layerize"); return; }
    setRunning(true);
    setResult(null);
    try {
      const asset = await uploadSource(file);
      const output = await api<LayerizeResult>("/layerize/run", {asset,fileName:file.name,outputMode:mode});
      setResult(output);
      if (!privileged && !output.idempotent) setBalance(v => Math.max(0,(v ?? 3) - (output.tokensCharged ?? 3)));
      toast({title:"Layerize complete",description:String(output.layerCount) + " production layers · " + String(output.pathCount) + " source-derived paths"});
    } catch (error) {
      toast({title:"Layerize stopped",description:friendlyError(error),variant:"destructive"});
      if ((error as {status?:number})?.status === 402) navigate("/try#layerize");
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Layerize™ — ProductionFlow</title>
        <meta name="description" content="Turn flattened artwork into editable production layers without changing the font or redrawing the art."/>
      </Helmet>
      <main className="min-h-screen bg-slate-50 text-slate-950">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
            <button onClick={() => navigate("/designpro/jobs")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <ArrowLeft className="h-4 w-4"/> ProductionFlow
            </button>
            <div className="text-right"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-blue-600">DesignProAI / ProductionFlow</p><p className="text-sm font-black">Layerize™</p></div>
          </div>
        </header>

        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-[1.3fr_.7fr] md:px-6 md:py-14">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700"><ShieldCheck className="h-4 w-4"/> Fidelity Lock always ON</div>
              <h1 className="mt-5 text-4xl font-black tracking-tight md:text-6xl">Got a flattened file?<span className="block bg-gradient-to-r from-blue-700 to-cyan-500 bg-clip-text text-transparent">Layerize it.</span></h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600 md:text-lg">Reconstruct production layers from the pixels you actually received. Layerize treats typography as geometry — it never guesses a font, substitutes a font, or asks generative AI to redraw customer artwork.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {["Fonts never substituted","Micro-detail trace","No generative redraw","SVG + EPS","Screen print plates","Embroidery art prep"].map(x => <span key={x} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm">{x}</span>)}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-950 p-6 text-white shadow-xl">
              <div className="flex items-start justify-between"><div><p className="text-xs font-black uppercase tracking-[.18em] text-cyan-300">Pay to play</p><p className="mt-2 text-3xl font-black">{privileged?"Team access":"3 tokens"}</p><p className="mt-1 text-sm text-slate-300">{privileged?"Admin/tester runs are free.":"One $25 pay-per-use pack = one Layerize run."}</p></div><WalletCards className="h-7 w-7 text-cyan-300"/></div>
              <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
                {loadingAccess ? <p className="flex items-center gap-2 text-sm text-slate-300"><Loader2 className="h-4 w-4 animate-spin"/>Checking access…</p>
                : privileged ? <p className="flex items-center gap-2 text-sm font-bold text-emerald-300"><CheckCircle2 className="h-4 w-4"/>Internal access unlocked</p>
                : <><div className="flex items-center justify-between text-sm"><span className="text-slate-400">Token balance</span><b>{balance??0}</b></div>{(balance??0)<3 && <button onClick={() => navigate("/try#layerize")} className="mt-4 min-h-11 w-full rounded-lg bg-blue-600 px-4 text-sm font-black hover:bg-blue-500">Buy one Layerize run — $25</button>}</>}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-6 px-4 py-8 md:px-6 lg:grid-cols-[.9fr_1.1fr]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><Upload className="h-5 w-5"/></div><div><h2 className="font-black">1. Drop the artwork</h2><p className="text-sm text-slate-500">PNG · JPG/JPEG · WEBP · outlined SVG · max 25 MB</p></div></div>
              <label className="flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-5 text-center hover:border-blue-400 hover:bg-blue-50/40" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();chooseFile(e.dataTransfer.files?.[0]);}}>
                <input type="file" accept=".png,.jpg,.jpeg,.webp,.svg" className="hidden" onChange={e=>chooseFile(e.target.files?.[0])}/>
                {preview ? <><img src={preview} alt="Layerize source" className="max-h-44 max-w-full rounded-lg border border-slate-200 bg-white object-contain"/><p className="mt-3 max-w-full truncate text-sm font-black">{file?.name}</p><p className="text-xs text-slate-500">Tap or drop another file to replace</p></>
                : <><FileImage className="h-11 w-11 text-slate-400"/><p className="mt-3 text-sm font-black">Throw the flattened file in here.</p><p className="mt-1 text-xs text-slate-500">Layerize works from the source pixels — not a redesign.</p></>}
              </label>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5"><div className="flex gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-blue-700"/><div><h3 className="font-black text-blue-950">Typography Fidelity Lock</h3><p className="mt-1 text-sm leading-6 text-blue-900/75">A flattened image cannot reveal the original font file. Layerize preserves the exact visible letterforms as vector outlines instead of replacing them with a “close” font.</p></div></div></div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-black">2. Choose the production output</h2><p className="mt-1 text-sm text-slate-500">Every mode keeps an untouched fidelity master.</p>
              <div className="mt-4 grid gap-3">
                {MODES.map(item => { const Icon=item.icon, active=item.id===mode; return <button key={item.id} onClick={()=>setMode(item.id)} className={["flex w-full items-start gap-4 rounded-xl border p-4 text-left transition",active?"border-blue-500 bg-blue-50 ring-2 ring-blue-100":"border-slate-200 hover:bg-slate-50"].join(" ")}><div className={["grid h-10 w-10 shrink-0 place-items-center rounded-lg",active?"bg-blue-600 text-white":"bg-slate-100 text-slate-600"].join(" ")}><Icon className="h-5 w-5"/></div><div><p className="font-black">{item.title}</p><p className="text-sm font-semibold text-slate-700">{item.subtitle}</p><p className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</p></div></button>; })}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between"><div><h2 className="font-black">3. Layerize it</h2><p className="text-sm text-slate-500">{selected.title} · Fidelity Lock ON</p></div><ShieldCheck className="h-7 w-7 text-emerald-600"/></div>
              {!privileged&&!loadingAccess&&(balance??0)<3 ? <button onClick={()=>navigate("/try#layerize")} className="min-h-12 w-full rounded-xl bg-blue-600 px-5 text-sm font-black text-white hover:bg-blue-500">Buy one Layerize run — $25</button>
              : <button onClick={run} disabled={!file||running||loadingAccess} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-700 to-blue-500 px-5 text-sm font-black text-white shadow-lg shadow-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50">{running?<><Loader2 className="h-5 w-5 animate-spin"/>Layerizing…</>:<><Layers3 className="h-5 w-5"/>Layerize My Artwork</>}</button>}
              {running && <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3"><p className="text-sm font-black text-blue-950">{message}</p><p className="mt-1 text-xs text-blue-700">No font substitution. No generative redraw. No post-trace simplification on the master.</p></div>}
            </div>
          </div>

          {result && <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-lg lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-100 bg-emerald-50 p-5 md:p-6">
              <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-600 text-white"><CheckCircle2 className="h-6 w-6"/></div><div><h2 className="text-xl font-black text-emerald-950">Your artwork is Layerized.</h2><p className="text-sm text-emerald-800">Fidelity Lock applied · {result.layerCount} production layers · {result.pathCount} source-derived paths{result.idempotent?" · existing result reused":""}</p></div></div>
              <a href={result.zipUrl} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-600 px-5 text-sm font-black text-white hover:bg-emerald-500"><Download className="h-4 w-4"/>Download Layerize ZIP</a>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-3 md:p-6">
              <div className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Typography</p><p className="mt-2 font-black">Source-derived outlines</p><p className="mt-1 text-xs text-slate-500">No font matching or substitution.</p></div>
              <div className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Fidelity master</p><p className="mt-2 font-black">Unsimplified trace</p><a href={result.masterSvgUrl} className="mt-2 inline-block text-xs font-black text-blue-700">Open master SVG →</a></div>
              <div className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Charge</p><p className="mt-2 font-black">{result.tokensCharged ? String(result.tokensCharged)+" tokens" : "Team access"}</p><p className="mt-1 text-xs text-slate-500">{result.idempotent?"Retry reused the same paid result.":"Failed runs are automatically refunded."}</p></div>
            </div>
            {!!result.warnings?.length && <div className="border-t border-amber-100 bg-amber-50 px-5 py-4 md:px-6"><p className="text-xs font-black uppercase tracking-wider text-amber-800">Production notes</p>{result.warnings.map(x=><p key={x} className="mt-1 text-sm text-amber-900">• {x}</p>)}</div>}
          </div>}
        </section>
      </main>
    </>
  );
}
