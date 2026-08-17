/**
 * NeuralNetwork RAG Retrieval Module
 *
 * Queries the neuralnetwork_knowledge table and returns formatted context
 * to APPEND to existing render prompts as supplementary reference info.
 *
 * CRITICAL: This module is fail-safe. If ANY error occurs, it returns ""
 * so the render pipeline continues unchanged. RAG is supplementary, never blocking.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface RAGOptions {
  collections: string[];       // e.g. ['finish_library', 'production_rules']
  maxChars?: number;           // default 6000
  orgId?: string | null;       // NULL = global only
  finishName?: string;         // optional: filter finish_library by name
}

export interface RAGDocument {
  id: string;
  collection: string;
  name: string;
  content: string;
  version: number;
}

/**
 * Fetch relevant knowledge documents and return formatted context string.
 *
 * Returns "" on ANY error — zero risk to render pipeline.
 * The returned string is intended to be appended as a separate { text } part
 * in the Gemini API parts array, NOT injected into the main prompt.
 */
export async function fetchRAGContext(options: RAGOptions): Promise<string> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.warn("[RAG] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — skipping RAG");
      return "";
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { collections, maxChars = 6000, orgId = null, finishName } = options;

    if (!collections || collections.length === 0) {
      return "";
    }

    // Build query: active docs in requested collections
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from("neuralnetwork_knowledge")
      .select("id, collection, name, content, version")
      .in("collection", collections)
      .eq("status", "active")
      .order("version", { ascending: false })
      .limit(25);

    // Scope to global docs, or global + org-specific
    if (orgId) {
      query = query.or(`org_id.is.null,org_id.eq.${orgId}`);
    } else {
      query = query.is("org_id", null);
    }

    const { data, error } = await query;

    if (error) {
      console.warn("[RAG] Query error (non-fatal):", error.message);
      return "";
    }

    if (!data || data.length === 0) {
      console.log("[RAG] No knowledge docs found for collections:", collections.join(", "));
      return "";
    }

    // If finishName provided, prioritize matching finish doc
    const docs: RAGDocument[] = data as RAGDocument[];
    if (finishName) {
      const finishKey = finishName.toLowerCase().replace(/\s+/g, "_");
      // Move matching finish doc to front
      docs.sort((a, b) => {
        const aMatch = a.collection === "finish_library" && a.name === finishKey ? -1 : 0;
        const bMatch = b.collection === "finish_library" && b.name === finishKey ? -1 : 0;
        return aMatch - bMatch;
      });
    }

    // Concatenate content, respecting maxChars cap
    let context = "\n\n=== REFERENCE KNOWLEDGE (supplementary) ===\n";
    let totalChars = context.length;
    let includedCount = 0;

    for (const doc of docs) {
      const entry = `\n[${doc.collection}/${doc.name}]\n${doc.content}\n`;
      if (totalChars + entry.length > maxChars) break;
      context += entry;
      totalChars += entry.length;
      includedCount++;
    }

    if (includedCount === 0) {
      return "";
    }

    console.log(`[RAG] Retrieved ${includedCount} docs (${totalChars} chars) from: ${collections.join(", ")}`);
    return context;
  } catch (err) {
    console.warn("[RAG] Retrieval failed (non-fatal):", err);
    return "";
  }
}

/**
 * Fetch raw knowledge documents for admin/API use.
 * Returns the documents array directly (not formatted as prompt text).
 */
export async function fetchRAGDocuments(options: {
  collections?: string[];
  orgId?: string | null;
  limit?: number;
  status?: string;
}): Promise<{ documents: RAGDocument[]; totalChars: number }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { collections, orgId = null, limit = 50, status = "active" } = options;

  let query = (supabase as any)
    .from("neuralnetwork_knowledge")
    .select("id, collection, name, content, version")
    .eq("status", status)
    .order("collection", { ascending: true })
    .order("name", { ascending: true })
    .limit(limit);

  if (collections && collections.length > 0) {
    query = query.in("collection", collections);
  }

  if (orgId) {
    query = query.or(`org_id.is.null,org_id.eq.${orgId}`);
  } else {
    query = query.is("org_id", null);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`RAG query failed: ${error.message}`);
  }

  const documents = (data || []) as RAGDocument[];
  const totalChars = documents.reduce((sum, d) => sum + (d.content?.length || 0), 0);

  return { documents, totalChars };
}
