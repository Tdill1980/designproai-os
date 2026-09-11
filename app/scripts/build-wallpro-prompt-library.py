#!/usr/bin/env python3
"""Compile docs/wallpro/WallProBatch_500_Industry_Prompt_Library.xlsx into
app/src/data/wallpro-prompt-library.json. The Prompt ID column is the permanent
DesignID; the row's taxonomy is stored beside the prompt, never inside it."""
import json, re, sys, pathlib
import openpyxl
root = pathlib.Path(__file__).resolve().parents[2]
wb = openpyxl.load_workbook(root / 'docs/wallpro/WallProBatch_500_Industry_Prompt_Library.xlsx', read_only=True)
rows = list(wb['500 Prompt Library'].iter_rows(values_only=True))
keys = ['id','segment','industry','room','title','designType','style','palette','intensity','prompt','tags']
lib = []
for r in rows[1:]:
    d = dict(zip(keys, r)); d['tags'] = [t.strip() for t in str(d['tags']).split(',') if t.strip()]
    for k in keys[:-1]: d[k] = str(d[k]).strip()
    if not re.match(r'^WPB-\d{4}$', d['id']): sys.exit('bad DesignID ' + d['id'])
    lib.append(d)
if len({d['id'] for d in lib}) != len(lib): sys.exit('duplicate DesignIDs')
(root / 'app/src/data/wallpro-prompt-library.json').write_text(json.dumps(lib, ensure_ascii=False, indent=0) + '\n')
print(len(lib), 'prompts')
