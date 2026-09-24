const { createHash } = require("node:crypto");
const { deflateRawSync } = require("node:zlib");
const sharp = require("sharp");

const BUCKET = "wrap-files";
const TOKEN_COST = 3;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MODES = new Set(["editable_layers", "screen_print", "embroidery_prep"]);
let tracerPromise = null;

function tracer() {
  if (!tracerPromise) tracerPromise = import("./layerize-vtracer/engine.mjs");
  return tracerPromise;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeName(value, fallback = "artwork") {
  const out = String(value || "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return out || fallback;
}

function xmlEscape(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function readAttr(attrs, name) {
  const rx = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  return attrs.match(rx)?.[1] ?? null;
}

function normalizeFill(fill) {
  const raw = String(fill || "#000000").trim().toLowerCase();
  if (raw === "none") return "none";
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/.test(raw)) return "#" + raw.slice(1).split("").map((c) => c + c).join("");
  const rgb = raw.match(/^rgb\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)$/i);
  if (!rgb) return raw;
  const h = (n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
  return `#${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`;
}

function readSvgMeta(svg) {
  const viewBox = svg.match(/viewBox="([^"]+)"/i)?.[1] || "";
  const parts = viewBox.split(/[\\s,]+/).map(Number);
  let width = Number(svg.match(/<svg[^>]*\\swidth="([\\d.]+)/i)?.[1] || 0);
  let height = Number(svg.match(/<svg[^>]*\\sheight="([\\d.]+)/i)?.[1] || 0);
  if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
    width ||= parts[2];
    height ||= parts[3];
  }
  width ||= 1000;
  height ||= 1000;
  return { width, height, viewBox: viewBox || `0 0 ${width} ${height}` };
}

function extractPaths(svg) {
  const out = [];
  const groupFills = [];
  const groupOpacities = [];
  const tagRx = /<(\/?)(g|path)\b([^>]*)>/gi;
  let match;
  let sourceIndex = 0;
  while ((match = tagRx.exec(svg)) !== null) {
    const close = match[1] === "/";
    const tag = match[2].toLowerCase();
    const attrs = match[3];
    if (tag === "g") {
      if (close) {
        groupFills.pop();
        groupOpacities.pop();
      } else {
        groupFills.push(readAttr(attrs, "fill") || "");
        const op = Number(readAttr(attrs, "fill-opacity") || "1");
        groupOpacities.push(Number.isFinite(op) ? op : 1);
      }
      continue;
    }
    if (close) continue;
    const d = readAttr(attrs, "d");
    if (!d) continue;
    let fill = readAttr(attrs, "fill") || "";
    if (!fill) {
      for (let i = groupFills.length - 1; i >= 0; i -= 1) {
        if (groupFills[i]) { fill = groupFills[i]; break; }
      }
    }
    fill = normalizeFill(fill || "#000000");
    if (fill === "none") continue;
    const ownOpacity = readAttr(attrs, "fill-opacity");
    const opacity = ownOpacity == null ? (groupOpacities.at(-1) ?? 1) : Number(ownOpacity);
    out.push({ d, fill, fillOpacity: Number.isFinite(opacity) ? opacity : 1, sourceIndex: sourceIndex++ });
  }
  return out;
}

function hexRgb(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbDistance(a, b) {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}

/**
 * The fidelity master is NEVER clustered. Only the production derivatives use
 * this small antialias merge so a black letter edge does not become 18 screens.
 */
function groupedProductionLayers(paths, threshold = 22) {
  const counts = new Map();
  for (const p of paths) counts.set(p.fill, (counts.get(p.fill) || 0) + 1);
  const colors = [...counts.keys()].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
  const reps = [];
  const map = new Map();
  for (const color of colors) {
    const rgb = hexRgb(color);
    let rep = null;
    if (rgb) {
      for (const candidate of reps) {
        const crgb = hexRgb(candidate);
        if (crgb && rgbDistance(rgb, crgb) <= threshold) { rep = candidate; break; }
      }
    }
    if (!rep) { rep = color; reps.push(color); }
    map.set(color, rep);
  }
  const groups = new Map();
  for (const p of paths) {
    const key = map.get(p.fill) || p.fill;
    const arr = groups.get(key) || [];
    arr.push(p);
    groups.set(key, arr);
  }
  return groups;
}

function colorSlug(fill) {
  return String(fill).replace(/^#/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "color";
}

function buildLayerSvg(meta, paths, options = {}) {
  const body = [...paths].sort((a,b) => a.sourceIndex - b.sourceIndex).map((p) => {
    const fill = options.fillOverride || p.fill;
    const opacity = p.fillOpacity < 1 ? ` fill-opacity="${p.fillOpacity.toFixed(4)}"` : "";
    return `    <path d="${xmlEscape(p.d)}" fill="${xmlEscape(fill)}"${opacity}/>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}" viewBox="${xmlEscape(meta.viewBox)}">\n  <g id="${xmlEscape(options.layerId || "Layer")}">\n${body}\n  </g>\n</svg>\n`;
}

function buildGroupedMaster(meta, groups) {
  let idx = 1;
  const body = [];
  for (const [fill, paths] of groups.entries()) {
    const id = `Layer_${String(idx).padStart(2,"0")}_${colorSlug(fill)}`;
    body.push(`  <g id="${id}" data-layer-color="${xmlEscape(fill)}">`);
    for (const p of [...paths].sort((a,b) => a.sourceIndex-b.sourceIndex)) {
      const opacity = p.fillOpacity < 1 ? ` fill-opacity="${p.fillOpacity.toFixed(4)}"` : "";
      body.push(`    <path d="${xmlEscape(p.d)}" fill="${xmlEscape(fill)}"${opacity}/>`);
    }
    body.push("  </g>");
    idx += 1;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}" viewBox="${xmlEscape(meta.viewBox)}">\n${body.join("\n")}\n</svg>\n`;
}

function readNumber(text, cursor) {
  while (cursor.i < text.length && /[\\s,]/.test(text[cursor.i])) cursor.i += 1;
  const match = text.slice(cursor.i).match(/^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?/);
  if (!match) throw new Error("layerize_eps_path_number_invalid");
  cursor.i += match[0].length;
  return Number(match[0]);
}

function svgPathToPs(d, sx, sy) {
  const out = [];
  const c = { i: 0 };
  let cmd = "";
  let cx=0, cy=0, startX=0, startY=0;
  const ws = () => { while (c.i < d.length && /[\\s,]/.test(d[c.i])) c.i += 1; };
  const hasCommand = () => { ws(); return c.i < d.length && /[A-Za-z]/.test(d[c.i]); };
  const fmt = (x,y) => `${(x*sx).toFixed(3)} ${(y*sy).toFixed(3)}`;
  while (c.i < d.length) {
    ws();
    if (hasCommand()) cmd=d[c.i++];
    if (!cmd) throw new Error("layerize_eps_path_command_missing");
    if (/[AaSsTt]/.test(cmd)) throw new Error("layerize_eps_unsupported_path_command");
    const relative=cmd===cmd.toLowerCase();
    switch(cmd.toUpperCase()) {
      case "M": {
        let first=true;
        do {
          let x=readNumber(d,c), y=readNumber(d,c); if(relative){x+=cx;y+=cy;}
          cx=x;cy=y;if(first){startX=x;startY=y;out.push(`${fmt(x,y)} moveto`);first=false;}else out.push(`${fmt(x,y)} lineto`);
          ws();
        } while(c.i<d.length && !hasCommand());
        break;
      }
      case "L": {
        do { let x=readNumber(d,c),y=readNumber(d,c);if(relative){x+=cx;y+=cy;}cx=x;cy=y;out.push(`${fmt(x,y)} lineto`);ws(); } while(c.i<d.length&&!hasCommand());
        break;
      }
      case "H": {
        do { let x=readNumber(d,c);if(relative)x+=cx;cx=x;out.push(`${fmt(cx,cy)} lineto`);ws(); } while(c.i<d.length&&!hasCommand());
        break;
      }
      case "V": {
        do { let y=readNumber(d,c);if(relative)y+=cy;cy=y;out.push(`${fmt(cx,cy)} lineto`);ws(); } while(c.i<d.length&&!hasCommand());
        break;
      }
      case "C": {
        do {
          let x1=readNumber(d,c),y1=readNumber(d,c),x2=readNumber(d,c),y2=readNumber(d,c),x=readNumber(d,c),y=readNumber(d,c);
          if(relative){x1+=cx;y1+=cy;x2+=cx;y2+=cy;x+=cx;y+=cy;}
          out.push(`${fmt(x1,y1)} ${fmt(x2,y2)} ${fmt(x,y)} curveto`);cx=x;cy=y;ws();
        } while(c.i<d.length&&!hasCommand());
        break;
      }
      case "Q": {
        do {
          let qx=readNumber(d,c),qy=readNumber(d,c),x=readNumber(d,c),y=readNumber(d,c);
          if(relative){qx+=cx;qy+=cy;x+=cx;y+=cy;}
          const c1x=cx+(2/3)*(qx-cx),c1y=cy+(2/3)*(qy-cy),c2x=x+(2/3)*(qx-x),c2y=y+(2/3)*(qy-y);
          out.push(`${fmt(c1x,c1y)} ${fmt(c2x,c2y)} ${fmt(x,y)} curveto`);cx=x;cy=y;ws();
        } while(c.i<d.length&&!hasCommand());
        break;
      }
      case "Z": out.push("closepath");cx=startX;cy=startY;cmd=""; break;
      default: throw new Error(`layerize_eps_unsupported_path_command:${cmd}`);
    }
  }
  return out;
}

function svgToEps(svg, title) {
  const meta=readSvgMeta(svg);
  const paths=extractPaths(svg);
  const w=Math.max(1,Math.round(meta.width)),h=Math.max(1,Math.round(meta.height));
  const lines=[
    "%!PS-Adobe-3.0 EPSF-3.0","%%Creator: DesignProAI Layerize",
    `%%Title: ${String(title||"layerize.eps").replace(/[\\r\\n]/g," ")}`,
    `%%BoundingBox: 0 0 ${w} ${h}`,"%%Pages: 1","%%LanguageLevel: 2","%%EndComments",
    "%%Page: 1 1","gsave",`0 ${h} translate`,"1 -1 scale"
  ];
  for (const p of paths) {
    const rgb=hexRgb(p.fill); if(!rgb||p.fillOpacity<=0) continue;
    lines.push(`${(rgb[0]/255).toFixed(4)} ${(rgb[1]/255).toFixed(4)} ${(rgb[2]/255).toFixed(4)} setrgbcolor`,"newpath");
    lines.push(...svgPathToPs(p.d,1,1),"eofill");
  }
  lines.push("grestore","showpage","%%EOF","");
  return Buffer.from(lines.join("\n"),"utf8");
}

const CRC_TABLE = (() => {
  const table=new Uint32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
  return table;
})();
function crc32(buffer){let c=0xffffffff;for(const b of buffer)c=CRC_TABLE[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
function dosDateTime(date=new Date()){
  const year=Math.max(1980,date.getFullYear());
  return {time:(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1),date:((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()};
}
function zipFiles(files){
  const local=[],central=[];let offset=0;const now=dosDateTime();
  for(const file of files){
    const name=Buffer.from(file.name.replaceAll("\\","/"),"utf8"),raw=Buffer.isBuffer(file.data)?file.data:Buffer.from(file.data);
    const compressed=deflateRawSync(raw,{level:6}),crc=crc32(raw);
    const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50,0);head.writeUInt16LE(20,4);head.writeUInt16LE(0,6);head.writeUInt16LE(8,8);
    head.writeUInt16LE(now.time,10);head.writeUInt16LE(now.date,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(compressed.length,18);head.writeUInt32LE(raw.length,22);head.writeUInt16LE(name.length,26);head.writeUInt16LE(0,28);
    local.push(head,name,compressed);
    const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);ch.writeUInt16LE(0,8);ch.writeUInt16LE(8,10);
    ch.writeUInt16LE(now.time,12);ch.writeUInt16LE(now.date,14);ch.writeUInt32LE(crc,16);ch.writeUInt32LE(compressed.length,20);ch.writeUInt32LE(raw.length,24);ch.writeUInt16LE(name.length,28);
    ch.writeUInt16LE(0,30);ch.writeUInt16LE(0,32);ch.writeUInt16LE(0,34);ch.writeUInt16LE(0,36);ch.writeUInt32LE(0,38);ch.writeUInt32LE(offset,42);
    central.push(ch,name);offset+=head.length+name.length+compressed.length;
  }
  const centralBuf=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(0,4);end.writeUInt16LE(0,6);
  end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(centralBuf.length,12);end.writeUInt32LE(offset,16);end.writeUInt16LE(0,20);
  return Buffer.concat([...local,centralBuf,end]);
}

async function upload(supabase,path,bytes,contentType){
  const {error}=await supabase.storage.from(BUCKET).upload(path,bytes,{contentType,upsert:true,cacheControl:"31536000"});
  if(error)throw new Error(`layerize_upload_failed:${error.message}`);
}

async function sign(supabase,path){
  if(!path)return null;
  const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(path,3600);
  if(error||!data?.signedUrl)throw new Error(`layerize_sign_failed:${error?.message||"missing_url"}`);
  return data.signedUrl;
}

function readme(mode,layerCount,warnings){
  const modeText=mode==="screen_print"
    ?"Screen Print mode includes one solid-black plate per derived production color. Merge/spot-map colors and add your shop's halftone/registration settings before output."
    :mode==="embroidery_prep"
      ?"Embroidery Prep contains separated vector art for digitizing. It is NOT a DST/PES stitch file; stitch direction, density, underlay and sequencing remain digitizer decisions."
      :"Editable Layers contains the fidelity master plus separated SVG/EPS production layers.";
  return [
    "LAYERIZE™ — PRODUCTION ART RECONSTRUCTION","",
    "FIDELITY LOCK: ON",
    "• Customer typography was NOT re-typed, font-matched or substituted.",
    "• Letterforms are source-derived vector outlines.",
    "• Generative AI did NOT redraw the artwork.",
    "• No post-trace node simplification was applied to the fidelity master.",
    "• The untouched master is the authority; production color clustering applies only to derivatives.","",
    modeText,`Derived production color layers: ${layerCount}`,"",
    "A flattened raster cannot reveal the original font file or Illustrator layer names. Layerize preserves the visible geometry present in the supplied pixels.",
    ...(warnings.length?["","PRODUCTION NOTES:",...warnings.map(w=>`• ${w}`)]:[]),"","Built by ProductionFlow™ / Layerize™"
  ].join("\n");
}

function createLayerizeService({supabase}) {
  if(!supabase)throw new Error("layerize_supabase_required");

  return {
    async run({ownerId,asset,fileName,outputMode}) {
      if(!/^[0-9a-f-]{36}$/i.test(String(ownerId||"")))throw Object.assign(new Error("layerize_owner_invalid"),{status:400});
      if(!asset||typeof asset!=="object")throw Object.assign(new Error("layerize_asset_required"),{status:400});
      const sourceHash=String(asset.contentHash||"").toLowerCase();
      const sourcePath=String(asset.storagePath||"");
      const byteSize=Number(asset.byteSize);
      const contentType=String(asset.contentType||"").toLowerCase().split(";",1)[0];
      if(!/^[0-9a-f]{64}$/.test(sourceHash)||!Number.isInteger(byteSize)||byteSize<1||byteSize>MAX_SOURCE_BYTES)
        throw Object.assign(new Error("layerize_asset_identity_invalid"),{status:400});
      if(!sourcePath.startsWith(`users/${ownerId}/revisions/`)||sourcePath.includes(".."))
        throw Object.assign(new Error("layerize_asset_path_rejected"),{status:403});
      if(!MODES.has(outputMode))throw Object.assign(new Error("layerize_output_mode_invalid"),{status:400});
      if(!["image/png","image/jpeg","image/webp","image/svg+xml"].includes(contentType))
        throw Object.assign(new Error("layerize_content_type_unsupported"),{status:415});

      const {data:blob,error:downloadError}=await supabase.storage.from(BUCKET).download(sourcePath);
      if(downloadError||!blob)throw Object.assign(new Error(`layerize_source_download_failed:${downloadError?.message||"missing"}`),{status:502});
      const sourceBytes=Buffer.from(await blob.arrayBuffer());
      if(sourceBytes.length!==byteSize||sha256(sourceBytes)!==sourceHash)
        throw Object.assign(new Error("layerize_source_identity_mismatch"),{status:409});

      const {data:reservation,error:reserveError}=await supabase.rpc("reserve_layerize_run",{
        p_owner:ownerId,p_source_hash:sourceHash,p_output_mode:outputMode,p_source_path:sourcePath,p_file_name:String(fileName||"artwork").slice(0,255)
      });
      if(reserveError){
        const code=/layerize_tokens_required/.test(reserveError.message||"")?"layerize_tokens_required":"layerize_reservation_failed";
        throw Object.assign(new Error(code),{status:code==="layerize_tokens_required"?402:500,cause:reserveError});
      }
      const runId=String(reservation?.runId||"");
      if(reservation?.state==="completed"&&!reservation?.fresh){
        return {
          success:true,idempotent:true,runId,fidelityLock:true,generativeAiUsed:false,
          tokensCharged:reservation.tokensCharged||0,layerCount:reservation.layerCount||0,pathCount:reservation.pathCount||0,
          warnings:Array.isArray(reservation.warnings)?reservation.warnings:[],
          zipUrl:await sign(supabase,reservation.outputStoragePath),
          masterSvgUrl:await sign(supabase,reservation.masterStoragePath),
          layerizedSvgUrl:await sign(supabase,reservation.layerizedStoragePath),
        };
      }
      if(reservation?.state==="working"&&!reservation?.fresh){
        throw Object.assign(new Error("layerize_run_in_progress"),{status:409});
      }

      try{
        let fidelitySvg;let original={width:0,height:0};let traceEngine="source-svg";
        if(contentType==="image/svg+xml"){
          fidelitySvg=sourceBytes.toString("utf8");
          if(!/<svg\\b/i.test(fidelitySvg))throw new Error("layerize_svg_invalid");
          if(/<(text|image|use|foreignObject|rect|circle|ellipse|polygon|polyline|line)\\b/i.test(fidelitySvg))
            throw Object.assign(new Error("layerize_svg_requires_outlined_paths"),{status:422});
          const meta=readSvgMeta(fidelitySvg);original={width:meta.width,height:meta.height};
        }else{
          const info=await sharp(sourceBytes,{failOn:"none"}).metadata();
          if(!info.width||!info.height)throw new Error("layerize_source_decode_failed");
          original={width:info.width,height:info.height};
          // Protect the runtime from pathological uploads. Vector output is still
          // source-derived; this rejects rather than silently downsizing.
          if(info.width*info.height>24_000_000)throw Object.assign(new Error("layerize_source_too_large_pixels"),{status:413});
          const {data:pixels,info:rawInfo}=await sharp(sourceBytes,{failOn:"none"}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
          const {vectorizeFidelity}=await tracer();
          fidelitySvg=vectorizeFidelity(new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength),rawInfo.width,rawInfo.height);
          traceEngine="vtracer-native-fidelity";
        }

        const paths=extractPaths(fidelitySvg);
        if(!paths.length)throw Object.assign(new Error("layerize_no_paths_recovered"),{status:422});
        const meta=readSvgMeta(fidelitySvg);
        const groups=groupedProductionLayers(paths,22);
        const groupedMaster=buildGroupedMaster(meta,groups);
        const warnings=[];
        if(Math.min(original.width||0,original.height||0)>0&&Math.min(original.width,original.height)<600)
          warnings.push(`Low-resolution source (${original.width}×${original.height}px). Geometry in the supplied pixels is preserved; details absent from those pixels cannot be recovered exactly.`);
        if(groups.size>16)warnings.push(`${groups.size} production colors remain after antialias clustering. Screen-print jobs should merge or spot-map near-identical colors before output.`);

        const files=[];
        const originalExt=contentType==="image/svg+xml"?"svg":contentType==="image/jpeg"?"jpg":contentType==="image/webp"?"webp":"png";
        files.push({name:`SOURCE/${safeName(fileName||"artwork") || `artwork.${originalExt}`}`,data:sourceBytes});
        files.push({name:"MASTER/01_fidelity-master.svg",data:Buffer.from(fidelitySvg)});
        files.push({name:"MASTER/01_fidelity-master.eps",data:svgToEps(fidelitySvg,"Layerize Fidelity Master")});
        files.push({name:"MASTER/02_layerized-by-color.svg",data:Buffer.from(groupedMaster)});
        files.push({name:"MASTER/02_layerized-by-color.eps",data:svgToEps(groupedMaster,"Layerize Production Layers")});

        const layerManifest=[];let idx=1;
        for(const [fill,layerPaths] of groups.entries()){
          const num=String(idx).padStart(2,"0"),slug=colorSlug(fill),name=`${num}_${slug}`;
          const layerSvg=buildLayerSvg(meta,layerPaths,{layerId:`Layer_${name}`});
          files.push({name:`LAYERS/${name}.svg`,data:Buffer.from(layerSvg)});
          files.push({name:`LAYERS/${name}.eps`,data:svgToEps(layerSvg,`Layerize ${fill}`)});
          layerManifest.push({index:idx,color:fill,paths:layerPaths.length,svg:`LAYERS/${name}.svg`,eps:`LAYERS/${name}.eps`});
          if(outputMode==="screen_print"){
            const plate=buildLayerSvg(meta,layerPaths,{fillOverride:"#000000",layerId:`ScreenPlate_${name}`});
            files.push({name:`SCREEN_PRINT/${name}_plate.svg`,data:Buffer.from(plate)});
            files.push({name:`SCREEN_PRINT/${name}_plate.eps`,data:svgToEps(plate,`Screen Plate ${fill}`)});
          }
          idx+=1;
        }
        if(outputMode==="screen_print")files.push({name:"SCREEN_PRINT/README.txt",data:Buffer.from("One solid-black plate per derived source color. Review/merge colors and add your shop's registration, underbase, choke/spread and halftone settings before output. Typography remains source-derived outlines.\n")});
        if(outputMode==="embroidery_prep"){
          files.push({name:"EMBROIDERY_PREP/vector-master.svg",data:Buffer.from(groupedMaster)});
          files.push({name:"EMBROIDERY_PREP/thread-color-map.json",data:Buffer.from(JSON.stringify(layerManifest.map(x=>({layer:x.index,sourceColor:x.color})),null,2))});
          files.push({name:"EMBROIDERY_PREP/README.txt",data:Buffer.from("Separated vector art for embroidery digitizing. This is not a DST/PES stitch file. Stitch type, direction, density, underlay, pull compensation, trims and sequencing remain digitizer decisions.\n")});
        }
        const manifest={product:"Layerize™",runId,outputMode,generatedAt:new Date().toISOString(),sourceFile:fileName,sourceContentHash:sourceHash,
          traceEngine,fidelityLock:true,generativeAiUsed:false,typographyPolicy:"source-derived vector outlines; never re-typeset, font-matched or substituted",
          postTraceSimplification:false,sourceDimensions:original,pathCount:paths.length,layerCount:groups.size,layers:layerManifest,warnings};
        files.push({name:"layer-manifest.json",data:Buffer.from(JSON.stringify(manifest,null,2))});
        files.push({name:"README-LAYERIZE.txt",data:Buffer.from(readme(outputMode,groups.size,warnings))});
        const zip=zipFiles(files);

        const base=`users/${ownerId}/layerize/${sourceHash}/${outputMode}`;
        const outputPath=`${base}/layerize.zip`,masterPath=`${base}/fidelity-master.svg`,layerizedPath=`${base}/layerized-by-color.svg`;
        await Promise.all([
          upload(supabase,outputPath,zip,"application/zip"),
          upload(supabase,masterPath,Buffer.from(fidelitySvg),"image/svg+xml"),
          upload(supabase,layerizedPath,Buffer.from(groupedMaster),"image/svg+xml"),
        ]);
        const {error:completeError}=await supabase.rpc("complete_layerize_run",{
          p_run_id:runId,p_output_path:outputPath,p_master_path:masterPath,p_layerized_path:layerizedPath,
          p_layer_count:groups.size,p_path_count:paths.length,p_warnings:warnings
        });
        if(completeError)throw new Error(`layerize_complete_record_failed:${completeError.message}`);
        return {
          success:true,idempotent:false,runId,fidelityLock:true,generativeAiUsed:false,
          tokensCharged:Number(reservation?.tokensCharged||0),chargeSource:reservation?.chargeSource||null,
          layerCount:groups.size,pathCount:paths.length,warnings,
          typographyPolicy:manifest.typographyPolicy,
          zipUrl:await sign(supabase,outputPath),masterSvgUrl:await sign(supabase,masterPath),layerizedSvgUrl:await sign(supabase,layerizedPath)
        };
      }catch(error){
        await supabase.rpc("fail_layerize_run",{p_run_id:runId,p_reason:String(error?.message||error).slice(0,500)}).catch(()=>{});
        throw error;
      }
    }
  };
}

module.exports={createLayerizeService,_layerizeInternals:{extractPaths,groupedProductionLayers,buildLayerSvg,zipFiles,svgToEps}};
