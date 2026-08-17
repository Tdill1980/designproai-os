// Brand Override Registry

import * as hexis from "./hexis.ts";
import * as inozetek from "./inozetek.ts";
import * as kpmf from "./kpmf.ts";
import * as oracal from "./oracal.ts";
import * as avery from "./avery.ts";
import * as m3 from "./3m.ts";
import * as teckwrap from "./teckwrap.ts";
import * as vvivid from "./vvivid.ts";
import * as stek from "./stek.ts";
import * as gswf from "./gswf.ts";
import * as arlon from "./arlon.ts";
import * as carlas from "./carlas.ts";
import * as flexishield from "./flexishield.ts";

export const brandOverrides: Record<string, { parse: ($: any, sourceUrl: string) => Promise<any[]> }> = {
  hexis,
  inozetek,
  kpmf,
  oracal,
  avery,
  "3m": m3,
  teckwrap,
  vvivid,
  stek,
  gswf,
  arlon,
  carlas,
  flexishield,
};

export const supportedBrands = Object.keys(brandOverrides);
