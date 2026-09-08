"use strict";
const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { buildPanelProFileOutputHandoff,SOURCE_APPS } = require("./panelpro-file-output-contract.cjs");
const { GRAPH_VERSION,hashJson,compilePanelProFileOutputGraph,publicNode,verifyPieceArtifactJoin } = require("./panelpro-file-output-graph.cjs");
const { verifyDesignProPieceSources,verifyDesignProTemplateVehicle } = require("./panelpro-source-binding.cjs");
const { preparePanelProFileOutput,renderPanelProFileOutputPiece } = require("./panelpro-file-output-render.cjs");
const { canonicalUuid,immutableStorageUpload } = require("./runtime-contract.cjs");
const { createDeterministicZip64Stream } = require("./output-qc.cjs");
const { stampSvg,renderStampedProof } = require("./designpro-standalone-claimant.cjs");
const { MAX_STANDARD_UPLOAD_BYTES,spoolImmutableBuffer,spoolDeterministicZip64,uploadSpoolWithTus,removeCommittedSpool } = require("./zip-spool.cjs");
const PREVIEW_ROLES=new Set(["branded-template","template-overlay","installation-mask","placement-comparison","bleed-preview","production-panel-proof","qc-approved-panel-proof"]);
const DIGEST=/^[a-f0-9]{64}$/;
const MAX_SOURCE_BYTES=256*1024*1024;
function failure(code,status=409,retryable=false) {return Object.assign(new Error(code),{code,status,retryable});}
function resultOf(result,code) {if(result.error)throw failure(code,503,true);return result.data;}
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
function sourceApp(value) {const app=SOURCE_APPS.find(a=>a.toLowerCase()===String(value||"").toLowerCase());if(!app)throw failure("panelprofile_source_app_invalid",400);return app;}
function assertOwnerPath(ownerId,ref) {
  const path=String(ref?.storagePath||"");
  if (!DIGEST.test(String(ref?.contentHash||"")) || !/^[A-Za-z0-9._~/-]+$/.test(path)
    || path.includes("..") || path.includes("//")
    || ![`designpro/user_${ownerId}/`,`users/${ownerId}/revisions/`].some(prefix=>path.startsWith(prefix))) throw failure("panelprofile_asset_owner_scope_invalid",403);
  return path;
}
function sourceIdentity(source) {return {sourceApp:source.source_app,sourceJobId:source.source_job_id,generationId:source.generation_id,designId:source.design_id,orderId:source.order_id,revisionId:source.revision_id,atlasRevisionId:source.handoff?.atlasRevisionId||null};}

function createPanelProFileOutputService({supabase,workerId,enabled=false,spoolDir,supabaseUrl,serviceRoleKey,tusEndpoint,
  prepare=preparePanelProFileOutput,renderPiece=renderPanelProFileOutputPiece,pollMs=2500,schedule=queueMicrotask,tusUploadOptions={}}={}) {
  let timer=null,busy=false,stopped=false,lastError=null;
  const activeControllers=new Set();
  async function rpc(name,args) {return resultOf(await supabase.rpc(name,args),name+"_failed");}
  async function canReview(ownerId) {
    const member=await supabase.from("designpro_qc_members").select("user_id,can_preflight").eq("user_id",ownerId).maybeSingle();
    return !member.error && member.data?.can_preflight===true;
  }
  async function readBytes(ownerId,ref,signal) {
    if(signal?.aborted)throw failure("panelprofile_lease_lost");
    const path=assertOwnerPath(ownerId,ref);
    const blob=resultOf(await supabase.storage.from("wrap-files").download(path),"panelprofile_asset_unavailable");
    if(!blob || blob.size<1 || blob.size>MAX_SOURCE_BYTES)throw failure("panelprofile_source_resource_limit");
    const bytes=Buffer.from(await blob.arrayBuffer());
    if(bytes.length>MAX_SOURCE_BYTES || sha(bytes)!==ref.contentHash)throw failure("panelprofile_source_hash_mismatch");
    return bytes;
  }
  async function* verifiedStream(ownerId,artifact,signal) {
    assertOwnerPath(ownerId,{storagePath:artifact.storage_path,contentHash:artifact.content_hash});
    const download=supabase.storage.from("wrap-files").download(artifact.storage_path);
    const data=resultOf(await (typeof download?.asStream==="function"?download.asStream():download),"panelprofile_artifact_unavailable");
    const chunks=typeof data?.stream==="function"?data.stream():data;
    if(!chunks || typeof chunks[Symbol.asyncIterator]!=="function")throw failure("panelprofile_artifact_stream_invalid");
    const digest=createHash("sha256");let count=0;
    for await(const chunk of chunks) {
      if(signal?.aborted)throw failure("panelprofile_lease_lost");
      count+=chunk.byteLength;
      if(count>Number(artifact.byte_size) || count>1024*1024*1024)throw failure("panelprofile_output_resource_limit");
      digest.update(chunk);yield chunk;
    }
    if(count!==Number(artifact.byte_size)||digest.digest("hex")!==artifact.content_hash)throw failure("panelprofile_output_hash_mismatch");
  }
  async function persist(run,node,artifact,signal) {
    if(signal?.aborted)throw failure("panelprofile_lease_lost");
    const bytes=Buffer.from(artifact.bytes),contentHash=sha(bytes);
    if(contentHash!==artifact.contentHash || !/^[A-Za-z0-9._~/-]+$/.test(artifact.name) || artifact.name.includes("..") || artifact.name.startsWith("/") || artifact.name.includes("//"))throw failure("panelprofile_artifact_identity_invalid");
    const ext=({"image/png":"png","image/tiff":"tiff","image/svg+xml":"svg","image/jpeg":"jpg","image/webp":"webp","application/pdf":"pdf","application/postscript":"eps","application/json":"json","application/zip":"zip"})[artifact.mimeType];
    if(!ext)throw failure("panelprofile_artifact_type_invalid");
    // A filename is an immutable identity including bytes, not a mutable UI URL.
    const name=artifact.role==="reused-asset"?artifact.name.replace(/^assets\//,`assets/${hashJson(artifact.pieceId).slice(0,16)}/`):artifact.name;
    const storagePath=`designpro/user_${run.owner_id}/${run.id}/panelprofile/${name.replace(/\.[^.]+$/,"")}-${contentHash}.${ext}`;
    let stored;
    if(bytes.length<=MAX_STANDARD_UPLOAD_BYTES) {
      try {stored=await immutableStorageUpload(supabase.storage,"wrap-files",storagePath,bytes,artifact.mimeType);}
      catch(error) {
        if(/different bytes/.test(String(error?.message)))throw failure("panelprofile_immutable_artifact_conflict");
        throw failure("panelprofile_artifact_write_unavailable",503,true);
      }
    }
    else {
      const spool=await spoolImmutableBuffer({spoolDir,runId:run.id,materialHash:hashJson({storagePath,contentHash}),bytes,signal});
      stored=await uploadSpoolWithTus({supabase,supabaseUrl,serviceRoleKey,endpoint:tusEndpoint,spoolDir,spool,storagePath,contentType:artifact.mimeType,signal,Upload:tusUploadOptions.Upload,FileUrlStorage:tusUploadOptions.FileUrlStorage});
      await removeCommittedSpool(spool);
    }
    return {...stored,role:artifact.role,pieceId:artifact.pieceId||"",mimeType:artifact.mimeType,metadata:artifact.metadata||{}};
  }
  async function registerSource(ownerId,raw) {
    canonicalUuid(ownerId,"ownerId");
    if(!await canReview(ownerId))throw failure("panelprofile_qc_permission_required",403);
    const actorId=ownerId;
    const input={...raw,sourceApp:sourceApp(raw?.sourceApp),tenantKey:`user_${ownerId}`};
    let designProRevision=null;
    if(input.sourceApp==="DesignPro") {
      const revision=resultOf(await supabase.from("designpro_revision_sources").select("revision_id,generation_id,owner_id,snapshot")
        .eq("revision_id",input.revisionId).maybeSingle(),"panelprofile_revision_lookup_failed");
      if(!revision || revision.generation_id!==input.generationId || !Array.isArray(revision.snapshot?.callOnePanels)
        || revision.snapshot.callOnePanels.length!==6
        || revision.snapshot.callOnePanels.some(p=>p.sourceMasterHash!==input.master?.contentHash))throw failure("panelprofile_canonical_revision_mismatch");
      await verifyDesignProPieceSources({supabase,input,revision});
      designProRevision=revision;
      const designId=revision.snapshot.designId;
      const orderId=revision.snapshot.orderId??revision.snapshot.orderNumber??null;
      if(!designId || (input.designId!=null && input.designId!==designId)
        || (input.orderId!=null && input.orderId!==orderId))throw failure("panelprofile_business_identity_mismatch");
      input.designId=designId;input.orderId=orderId;
      // Existing design staff may prepare a customer's source. Ownership is
      // resolved from that immutable revision; actor and owner stay distinct.
      ownerId=canonicalUuid(revision.owner_id,"sourceOwnerId");input.tenantKey=`user_${ownerId}`;
      let atlasQuery=supabase.from("designpro_flat_atlas_revisions").select("id,master_storage_path")
        .eq("generation_id",input.generationId).eq("owner_id",ownerId).eq("master_content_hash",input.master.contentHash);
      if(input.atlasRevisionId)atlasQuery=atlasQuery.eq("id",canonicalUuid(input.atlasRevisionId,"atlasRevisionId"));
      const atlases=resultOf(await atlasQuery.limit(2),"panelprofile_revision_lookup_failed");
      if(atlases.length!==1 || atlases[0].master_storage_path!==input.master.storagePath
        || (input.atlasRevisionId && input.atlasRevisionId!==atlases[0].id))throw failure("panelprofile_canonical_revision_mismatch");
      input.atlasRevisionId=atlases[0].id;
    }
    // Resolve the actual immutable geometry before hashing this admission. A
    // template's display approval alone cannot bind it to this source vehicle.
    assertOwnerPath(ownerId,input.template?.geometry);
    const geometry=JSON.parse((await readBytes(ownerId,input.template.geometry)).toString("utf8"));
    if(designProRevision) {
      const binding=verifyDesignProTemplateVehicle({input,revision:designProRevision,geometry,reviewerId:actorId,canReview:true});
      input.templateVehicleReview=binding.templateVehicleReview;
    } else if(input.templateVehicleReview!=null) {
      // Other source applications have no DesignPro immutable vehicle snapshot.
      throw failure("panelprofile_template_vehicle_review_source_invalid");
    }
    const request=buildPanelProFileOutputHandoff(input);
    const refs=[request.master,request.template.geometry,request.template.display,...request.availableAssets,
      ...request.pieces.flatMap(p=>[p.source,...(p.composition?[p.composition.background]:[])])];
    refs.forEach(ref=>assertOwnerPath(ownerId,ref));
    // An operator may prepare files but cannot silently substitute an ATLAS
    // revision or master belonging to a different generation.
    const display=await readBytes(ownerId,request.template.display);
    const displayMeta=await sharp(display,{limitInputPixels:40_000_000}).metadata().catch(()=>null);
    if(displayMeta?.format!=="png" || !displayMeta.width || !displayMeta.height)throw failure("panelprofile_template_display_invalid");
    if(geometry.templateId!==request.template.templateId || geometry.version!==request.template.version
      || geometry.displayContentHash!==request.template.display.contentHash)throw failure("panelprofile_template_geometry_mismatch");
    const existing=resultOf(await supabase.from("panelprofile_template_bank").select("template")
      .eq("owner_id",ownerId).eq("template_id",request.template.templateId).eq("version",request.template.version).maybeSingle(),"panelprofile_template_lookup_failed");
    if(existing && hashJson(existing.template)!==hashJson(request.template))throw failure("panelprofile_template_version_collision");
    if(!existing) {
      const inserted=await supabase.from("panelprofile_template_bank").insert({owner_id:ownerId,template_id:request.template.templateId,
        version:request.template.version,profile_hash:request.template.profileHash,geometry_hash:request.template.geometryHash,
        template:request.template,reviewed_by:actorId});
      if(inserted.error)throw failure("panelprofile_template_registration_failed",503,true);
    }
    const row={owner_id:ownerId,source_app:request.sourceApp,source_job_id:request.sourceJobId,generation_id:request.generationId,
      design_id:request.designId,order_id:request.orderId,revision_id:request.revisionId,input_hash:request.inputHash,handoff:input,registered_by:actorId};
    const insert=await supabase.from("panelprofile_source_handoffs").insert(row).select("*").single();
    if(insert.error?.code==="23505") {
      const existingSource=resultOf(await supabase.from("panelprofile_source_handoffs").select("*")
        .eq("owner_id",ownerId).eq("source_app",request.sourceApp).eq("source_job_id",request.sourceJobId)
        .eq("revision_id",request.revisionId).eq("input_hash",request.inputHash).single(),"panelprofile_source_lookup_failed");
      return {...sourceIdentity(existingSource),sourceId:existingSource.id,inputHash:existingSource.input_hash};
    }
    const created=resultOf(insert,"panelprofile_source_registration_failed");
    return {...sourceIdentity(created),sourceId:created.id,inputHash:created.input_hash};
  }
  async function createRun(ownerId,identity) {
    if(!enabled)throw failure("panelprofile_service_not_enabled",503);
    const app=sourceApp(identity.sourceApp);
    const reviewer=await canReview(ownerId);
    let query=supabase.from("panelprofile_source_handoffs").select("*")
      .eq("source_app",app).eq("source_job_id",String(identity.sourceJobId||""));
    if(identity.sourceId!=null)query=query.eq("id",canonicalUuid(identity.sourceId,"sourceId"));
    if(identity.inputHash!=null) {
      if(!DIGEST.test(identity.inputHash))throw failure("panelprofile_input_hash_invalid",400);
      query=query.eq("input_hash",identity.inputHash);
    }
    if(!reviewer)query=query.eq("owner_id",ownerId);
    for(const [field,key] of [["revision_id","revisionId"],["generation_id","generationId"],["design_id","designId"],["order_id","orderId"]])
      if(identity[key]!=null)query=query.eq(field,identity[key]);
    const rows=resultOf(await query.order("created_at",{ascending:false}).limit(2),"panelprofile_source_lookup_failed");
    if(!rows?.length)throw failure("panelprofile_source_not_prepared");
    if(rows.length>1)throw failure("panelprofile_revision_selection_required");
    const source=rows[0],nodes=compilePanelProFileOutputGraph(source.handoff);
    const run=await rpc("create_panelprofile_run",{p_owner_id:source.owner_id,p_source_id:source.id,p_definition:GRAPH_VERSION,p_nodes:nodes});
    schedule(()=>void tick());return getRun(ownerId,run.id);
  }
  async function listRuns(ownerId,filter={}) {
    const reviewer=await canReview(ownerId);
    let sources=supabase.from("panelprofile_source_handoffs").select("id");
    if(!reviewer || (!filter.sourceJobId&&!filter.generationId))sources=sources.eq("owner_id",ownerId);
    if(filter.sourceApp)sources=sources.eq("source_app",sourceApp(filter.sourceApp));
    if(filter.sourceJobId)sources=sources.eq("source_job_id",filter.sourceJobId);
    if(filter.generationId)sources=sources.eq("generation_id",filter.generationId);
    for(const [column,key] of [["revision_id","revisionId"],["design_id","designId"],["order_id","orderId"]])
      if(filter[key])sources=sources.eq(column,filter[key]);
    const ids=resultOf(await sources.limit(200),"panelprofile_source_lookup_failed")||[];
    if(!ids.length)return [];
    const runs=resultOf(await supabase.from("panelprofile_runs").select("id")
      .in("source_id",ids.map(s=>s.id)).order("created_at",{ascending:false}).limit(20),"panelprofile_run_lookup_failed")||[];
    return Promise.all(runs.map(r=>getRun(ownerId,r.id)));
  }
  async function getRun(ownerId,runId) {
    canonicalUuid(runId,"runId");
    const reviewer=await canReview(ownerId);
    let query=supabase.from("panelprofile_runs").select("*").eq("id",runId);
    if(!reviewer)query=query.eq("owner_id",ownerId);
    const run=resultOf(await query.maybeSingle(),"panelprofile_run_lookup_failed");
    if(!run)throw failure("panelprofile_run_not_found",404);
    const [source,nodes,artifacts]=await Promise.all([
      supabase.from("panelprofile_source_handoffs").select("*").eq("id",run.source_id).single().then(r=>resultOf(r,"panelprofile_source_lookup_failed")),
      supabase.from("panelprofile_nodes").select("*").eq("run_id",run.id).order("created_at").then(r=>resultOf(r,"panelprofile_node_lookup_failed")),
      supabase.from("panelprofile_artifacts").select("*").eq("run_id",run.id).order("created_at").then(r=>resultOf(r,"panelprofile_artifact_lookup_failed"))]);
    const handoff=buildPanelProFileOutputHandoff(source.handoff);
    const previews=[],files=[];
    for(const a of artifacts) {
      const preview=PREVIEW_ROLES.has(a.role);
      if(!preview && !reviewer)continue;
      const signed=resultOf(await supabase.storage.from("wrap-files").createSignedUrl(a.storage_path,300),"panelprofile_artifact_sign_failed");
      if(preview)previews.push({id:a.id,role:a.role,pieceId:a.piece_id,signedUrl:signed.signedUrl,contentHash:a.content_hash,
        approvedDisplay:true,geometryValidated:true,provenance:"generated-branded",profileHash:handoff.template.profileHash});
      else files.push({id:a.id,role:a.role,pieceId:a.piece_id,signedUrl:signed.signedUrl,contentHash:a.content_hash,mimeType:a.mime_type,name:a.storage_path.split("/").at(-1)});
    }
    const blockers=nodes.flatMap(n=>n.output?.blockers||[]);
    const pieces=handoff.pieces.map(p=>{
      const node=nodes.find(n=>n.input?.pieceId===p.pieceId);
      return {id:p.pieceId,label:p.pieceId,state:node?.state||"pending",trimWidthIn:p.widthInches,trimHeightIn:p.heightInches,
        printWidthIn:p.outputWidthInches,printHeightIn:p.outputHeightInches,bleedInches:5,ppi:handoff.outputPolicy.fullSizePpi,
        blockers:blockers.filter(b=>!b.pieceId||b.pieceId===p.pieceId)};
    });
    return {id:run.id,...sourceIdentity(source),status:run.state,stages:nodes.map(publicNode),previews,files,pieces,blockers,
      canReview:reviewer,artifactSetHash:run.artifact_set_hash,inputHash:run.input_hash,
      humanReviewUrl:source.source_app==="DesignPro"?`/designpro/jobs/${source.generation_id}/panelpro/surfaces`:null,
      createdAt:run.created_at,updatedAt:run.updated_at};
  }
  async function approve(ownerId,runId,body) {
    await getRun(ownerId,runId); // Never let a caller approve an arbitrary tenant's run.
    if(!await canReview(ownerId))throw failure("panelprofile_qc_permission_required",403);
    await rpc("approve_panelprofile_output",{p_run_id:runId,p_actor:ownerId,p_artifact_set_hash:body.artifactSetHash,
      p_checks:body.checks,p_approval_ref:body.approvalRef});
    schedule(()=>void tick());return getRun(ownerId,runId);
  }
  async function resume(ownerId,runId) {
    await getRun(ownerId,runId);
    await rpc("resume_panelprofile_run",{p_run_id:runId,p_actor:ownerId});
    schedule(()=>void tick());return getRun(ownerId,runId);
  }
  async function execute(claim,signal) {
    const {run,node,source}=claim,input=source.handoff,request=buildPanelProFileOutputHandoff(input);
    if(request.inputHash!==run.input_hash || run.input_hash!==source.input_hash)throw failure("panelprofile_input_identity_changed");
    const collected=[];
    const options={readBytes:ref=>readBytes(run.owner_id,ref,signal),writeArtifact:async artifact=>{
      const stored=await persist(run,node,artifact,signal);collected.push(stored);return stored;
    }};
    let output;
    if(node.node_key==="source.verify") {
      await options.readBytes(request.master);
      // Every reusable original enters the immutable ledger before verification
      // and the human gate, including assets unused by a particular panel.
      for(const asset of request.availableAssets) {
        const bytes=await options.readBytes(asset),ext=asset.storagePath.split(".").at(-1).toLowerCase();
        const mimeType=({png:"image/png",tif:"image/tiff",tiff:"image/tiff",svg:"image/svg+xml",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",pdf:"application/pdf",eps:"application/postscript"})[ext];
        if(!mimeType)throw failure("panelprofile_asset_type_invalid");
        const assetName=asset.assetId.replace(/[^A-Za-z0-9._-]/g,c=>`~${c.charCodeAt(0).toString(16)}`);
        await options.writeArtifact({name:`assets/original-${assetName}.${ext}`,bytes,contentHash:asset.contentHash,mimeType,
          role:"reused-asset",pieceId:"",metadata:{assetId:asset.assetId,sourceStoragePath:asset.storagePath,sourceContentHash:asset.contentHash,original:true}});
      }
      output={verified:true,inputHash:request.inputHash,availableAssetIds:request.availableAssets.map(a=>a.assetId)};
    } else if(node.node_key==="template.lookup") {
      const bank=resultOf(await supabase.from("panelprofile_template_bank").select("template").eq("owner_id",run.owner_id)
        .eq("template_id",request.template.templateId).eq("version",request.template.version).maybeSingle(),"panelprofile_template_lookup_failed");
      if(!bank || hashJson(bank.template)!==hashJson(request.template))throw failure("panelprofile_validated_template_required");
      await options.readBytes(request.template.geometry);
      const bytes=await options.readBytes(request.template.display);
      await options.writeArtifact({name:"previews/branded-template.png",bytes,contentHash:sha(bytes),mimeType:"image/png",role:"branded-template",
        metadata:{profileHash:request.template.profileHash,geometryHash:request.template.geometryHash,displayOrigin:"generated-branded",geometryValidated:true}});
      output={verified:true,cacheHit:true,templateId:request.template.templateId,profileHash:request.template.profileHash};
    } else if(node.node_key==="panelprofileoutput.plan") {
      output=await prepare(input,options);
      if(output.blockers?.length)return {state:"waiting",output,artifacts:[]};
    } else if(node.node_key.startsWith("panelprofileoutput.render:")) {
      output=await renderPiece(input,node.input.pieceId,options);
      if(!output.productionFilesCreated)return {state:"waiting",output,artifacts:[]};
    } else if(node.node_key==="panelprofileoutput.verify") {
      const nodes=resultOf(await supabase.from("panelprofile_nodes").select("*").eq("run_id",run.id),"panelprofile_node_lookup_failed");
      const artifacts=resultOf(await supabase.from("panelprofile_artifacts").select("*").eq("run_id",run.id),"panelprofile_artifact_lookup_failed");
      for(const a of artifacts)for await(const _chunk of verifiedStream(run.owner_id,a,signal)){ /* streamed hash/length verification */ }
      output=verifyPieceArtifactJoin(request,nodes,artifacts);
    } else if(node.node_key==="await_panelpro_preflight_qc") {
      return {state:"waiting",output:{inputHash:request.inputHash,artifactSetHash:run.artifact_set_hash,
        approvalRequired:true,qcApproved:false,blockers:[]},artifacts:[]};
    } else if(node.node_key==="panelprofileoutput.package") {
      const approval=resultOf(await supabase.from("panelprofile_nodes").select("output,state")
        .eq("run_id",run.id).eq("node_key","await_panelpro_preflight_qc").single(),"panelprofile_approval_lookup_failed");
      if(approval.state!=="completed" || approval.output?.qcApproved!==true || approval.output.artifactSetHash!==run.artifact_set_hash)throw failure("panelprofile_exact_approval_required");
      const artifacts=resultOf(await supabase.from("panelprofile_artifacts").select("*").eq("run_id",run.id),"panelprofile_artifact_lookup_failed");
      // Only the stored human approval can authorize these proof derivatives.
      // Original proofs and production artwork remain separate immutable files.
      const date=String(approval.output.approvedAt||"").slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !approval.output.actorId || !approval.output.approvalRef)throw failure("panelprofile_exact_approval_required");
      const sealBytes=await sharp(stampSvg(approval.output.actorId,request.designId,request.orderId,date)).png().toBuffer();
      for(const proof of artifacts.filter(a=>a.role==="production-panel-proof")) {
        const sourceBytes=await options.readBytes({storagePath:proof.storage_path,contentHash:proof.content_hash});
        const stamped=await renderStampedProof({sourceBytes,sourceHash:proof.content_hash,sourceByteSize:Number(proof.byte_size),sealBytes});
        const pieceName=String(proof.piece_id).replace(/[^A-Za-z0-9._-]/g,c=>`~${c.charCodeAt(0).toString(16)}`);
        const stored=await options.writeArtifact({name:`previews/${pieceName}-qc-approved-panel-proof.png`,bytes:stamped.bytes,contentHash:stamped.contentHash,
          role:"qc-approved-panel-proof",pieceId:proof.piece_id,mimeType:"image/png",metadata:{sourceProofPath:proof.storage_path,
            sourceProofHash:proof.content_hash,approvalRef:approval.output.approvalRef,approvedAt:approval.output.approvedAt,
            actorId:approval.output.actorId,artifactSetHash:run.artifact_set_hash,sealHash:sha(sealBytes),composition:stamped.composition,
            qcApproved:true,customerReleaseApproved:false}});
        artifacts.push({storage_path:stored.storagePath,content_hash:stored.contentHash,byte_size:stored.byteSize,
          role:stored.role,piece_id:stored.pieceId,mime_type:stored.mimeType,metadata:stored.metadata});
      }
      artifacts.sort((a,b)=>a.storage_path.localeCompare(b.storage_path));
      const manifest={contractVersion:GRAPH_VERSION,...sourceIdentity(source),inputHash:run.input_hash,artifactSetHash:run.artifact_set_hash,
        approval:approval.output,files:artifacts.map(a=>({role:a.role,pieceId:a.piece_id,contentHash:a.content_hash,byteSize:a.byte_size,
          ...(a.metadata?.original?{assetId:a.metadata.assetId,sourceStoragePath:a.metadata.sourceStoragePath}:{}),
          name:a.storage_path.split("/panelprofile/")[1]})),customerReleaseApproved:false};
      const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2));
      const entries=artifacts.map(a=>({name:a.storage_path.split("/panelprofile/")[1],byteSize:a.byte_size,
        open:()=>verifiedStream(run.owner_id,a,signal)}));
      entries.push({name:"manifest.json",bytes:manifestBytes});
      const materialHash=hashJson(manifest),spool=await spoolDeterministicZip64({spoolDir,runId:run.id,materialHash,
        createStream:()=>createDeterministicZip64Stream(entries),signal});
      const path=`designpro/user_${run.owner_id}/${run.id}/panelprofile/package-${spool.contentHash}.zip`;
      const stored=await uploadSpoolWithTus({supabase,supabaseUrl,serviceRoleKey,endpoint:tusEndpoint,spoolDir,spool,storagePath:path,contentType:"application/zip",signal,Upload:tusUploadOptions.Upload,FileUrlStorage:tusUploadOptions.FileUrlStorage});
      await removeCommittedSpool(spool);
      collected.push({...stored,role:"reviewed-package",pieceId:"",mimeType:"application/zip",metadata:{artifactSetHash:run.artifact_set_hash,customerReleaseApproved:false}});
      output={...manifest,zip:{storagePath:stored.storagePath,contentHash:stored.contentHash,byteSize:stored.byteSize},qcApproved:true};
    } else if(node.node_key==="panelprofileoutput.handoff") {
      const packageNode=resultOf(await supabase.from("panelprofile_nodes").select("output,state")
        .eq("run_id",run.id).eq("node_key","panelprofileoutput.package").single(),"panelprofile_package_lookup_failed");
      if(packageNode.state!=="completed")throw failure("panelprofile_package_required");
      const rendered=resultOf(await supabase.from("panelprofile_nodes").select("output").eq("run_id",run.id)
        .like("node_key","panelprofileoutput.render:%"),"panelprofile_node_lookup_failed");
      output={...sourceIdentity(source),inputHash:run.input_hash,artifactSetHash:run.artifact_set_hash,zip:packageNode.output.zip,
        requiresProofRefresh:request.pieces.some(p=>p.composition?.rebuildFromSeparatedAssets===true)
          || rendered.some(n=>n.output?.pieces?.some(p=>p.placements?.some(e=>e.moved))),
        status:"ready_for_source_app_review",qcApproved:true,customerReleaseApproved:false};
    } else throw failure("panelprofile_node_handler_missing");
    return {state:"completed",output,artifacts:collected};
  }
  async function tick() {
    if(!enabled||stopped||busy)return;busy=true;
    let claim=null,heartbeat=null,controller=null;
    try {
      claim=await rpc("claim_panelprofile_node",{p_worker:workerId,p_lease_seconds:180});
      if(!claim)return;
      controller=new AbortController();activeControllers.add(controller);
      heartbeat=setInterval(()=>void rpc("heartbeat_panelprofile_node",{p_node_id:claim.node.id,p_token:claim.node.lease_token})
        .then(held=>{if(!held)controller.abort();}).catch(()=>controller.abort()),30_000);heartbeat.unref?.();
      if(["panelprofileoutput.plan","panelprofileoutput.verify","panelprofileoutput.package"].includes(claim.node.node_key)
        || claim.node.node_key.startsWith("panelprofileoutput.render:")) {
        if(!await rpc("acquire_panelprofile_heavy_lease",{p_node_id:claim.node.id,p_token:claim.node.lease_token})) {
          // Capacity contention is scheduling, never an exhausted render attempt.
          await rpc("defer_panelprofile_node",{p_node_id:claim.node.id,p_token:claim.node.lease_token});return;
        }
      }
      const result=await execute(claim,controller.signal);
      if(controller.signal.aborted)throw failure("panelprofile_lease_lost");
      await rpc("finish_panelprofile_node",{p_node_id:claim.node.id,p_token:claim.node.lease_token,p_state:result.state,
        p_output:result.output,p_output_hash:hashJson(result.output),p_artifacts:result.artifacts});lastError=null;
    } catch(error) {
      lastError=error.code||"panelprofile_worker_failed";
      if(claim && !controller?.signal.aborted) {
        const output={errorCode:lastError,retryable:error.retryable===true,blockers:[{code:lastError}],qcApproved:false};
        await rpc("finish_panelprofile_node",{p_node_id:claim.node.id,p_token:claim.node.lease_token,
          p_state:error.retryable===true?"pending":"failed",p_output:output,p_output_hash:hashJson(output),p_artifacts:[]}).catch(()=>{});
      }
    } finally {
      if(heartbeat)clearInterval(heartbeat);if(controller)activeControllers.delete(controller);busy=false;
      if(claim&&!stopped)schedule(()=>void tick());
    }
  }
  function start(){stopped=false;if(!enabled||timer)return;timer=setInterval(()=>void tick(),pollMs);timer.unref?.();void tick();}
  function stop(){stopped=true;clearInterval(timer);timer=null;for(const controller of activeControllers)controller.abort();}
  async function capabilities(actorId) {
    const allowed=await canReview(actorId);
    return {canPrepare:allowed,canReview:allowed,enabled};
  }
  return {registerSource,createRun,listRuns,getRun,approve,resume,capabilities,start,stop,tick,execute,
    health:()=>({contractVersion:GRAPH_VERSION,enabled,busy,lastError,integrationState:enabled?"durable-graph":"disabled",approval:"existing-human-qc"})};
}
module.exports={createPanelProFileOutputService,assertOwnerPath,sourceApp};
