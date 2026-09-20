"use strict";
const sharp = require("sharp");

// Same magenta threshold as the existing text-layer designer, performed in
// the runtime where full-resolution RGBA decoding has a suitable CPU budget.
async function keyGeneratedLogo(bytes) {
  const {data,info}=await sharp(bytes,{limitInputPixels:40000000}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let minX=info.width,minY=info.height,maxX=-1,maxY=-1,removed=0;
  for(let y=0;y<info.height;y++) for(let x=0;x<info.width;x++) {
    const i=(y*info.width+x)*4;
    if(data[i]>140 && data[i+2]>140 && data[i+1]<120) {data[i+3]=0;removed++;}
    else if(data[i+3]>0) {minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  }
  if(!removed || maxX<minX || maxY<minY) throw new Error("proof_logo_alpha_invalid");
  const left=Math.max(0,minX-6),top=Math.max(0,minY-6);
  const right=Math.min(info.width-1,maxX+6),bottom=Math.min(info.height-1,maxY+6);
  return sharp(data,{raw:{width:info.width,height:info.height,channels:4}})
    .extract({left,top,width:right-left+1,height:bottom-top+1}).png().toBuffer();
}
module.exports={keyGeneratedLogo};
