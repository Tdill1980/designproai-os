const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * proxy-image-fetch — Fetches an image URL from anywhere on the public web
 * and returns it as a base64 data URL. Used by PatternPro custom upload
 * to bypass browser CORS restrictions when users paste URLs from sites
 * like Pinterest, Instagram, Google Images, etc.
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'url required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!/^https?:\/\//i.test(url)) {
      return new Response(JSON.stringify({ error: 'http(s) URL required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
      },
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Source returned ${res.status}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const contentType = res.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) {
      return new Response(JSON.stringify({ error: `Not an image (${contentType})` }), {
        status: 415,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 25 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Image larger than 25MB' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < buf.length; i += chunkSize) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    const dataUrl = `data:${contentType};base64,${base64}`;

    return new Response(JSON.stringify({ dataUrl, contentType, size: buf.byteLength }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
