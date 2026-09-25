import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../supabase/functions/render-wall-view/handler.ts', import.meta.url), 'utf8');

test('WallPro AI render keeps original room as visual authority', () => {
  for (const phrase of [
    "ORIGINAL ROOM PHOTO",
    "FLAT PRINT MASTER",
    "placement constraint only",
    "Do not copy the guide\\'s flat pasted appearance",
    "photograph of a finished installation",
  ]) assert.ok(source.includes(phrase), phrase);
});

test('geometry remains guidance, not the customer-facing rendering authority', () => {
  assert.ok(source.includes("Image 3 is a geometry guide"));
  assert.ok(source.includes("Use it ONLY to identify the exact wall surface, physical scale and coverage boundary"));
  assert.ok(source.includes("Create the wall treatment natively in Image 1"));
});

test('protected areas are restored after AI rendering on the geometry path too', () => {
  assert.match(source, /if \(maskBytes && wallPhotoBytes\) \{/);
  assert.doesNotMatch(source, /if \(maskBytes && wallPhotoBytes && !input\.geometryPath\)/);
});
