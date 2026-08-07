import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname,join } from "node:path";
import { fileURLToPath } from "node:url";

const sql=readFileSync(join(dirname(fileURLToPath(import.meta.url)),"../../supabase/migrations/20260806180500_designpro_vehicle_dimensions.sql"),"utf8").toLowerCase();
for(const column of ["id","make","model","year_range","year_start","year_end","side_width","side_height","hood_width","hood_length","roof_width","roof_length","front_width","front_height","rear_width","rear_height","back_width","back_height","total_sqft","overall_length","recommended_size"])
  assert.match(sql,new RegExp(`\\b${column}\\b`),`missing GENIE column ${column}`);
assert.ok(sql.includes("public.designpro_vehicle_dimensions"));
assert.ok(!/public\.vehicle_dimensions\b/.test(sql),"shared vehicle_dimensions dependency forbidden");
assert.ok(!sql.includes("unique (make")&&!sql.includes("unique(make"),"duplicate grounded rows must remain permitted");
assert.ok(sql.includes("lower(btrim(make)),lower(btrim(model))"),"normalized make/model lookup index required");
assert.ok(sql.includes("year_start,year_end,id"),"deterministic year/id lookup index required");
assert.ok(sql.includes("grant all on public.designpro_vehicle_dimensions to service_role"));
console.log("standalone GENIE vehicle dimension cache contract passed");
