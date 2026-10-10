import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const d=import.meta.dirname;
const b=await chromium.launch();const p=await b.newPage();
const pts=[['p15',60,440],['p15',60,372],['p15',200,470],['p15',300,600],['p03',150,60],['p03',230,25],['p03',210,36]];
for(const [f,x,y] of pts){
 const data='data:image/png;base64,'+readFileSync(`${d}/crops/${f}.png`).toString('base64');
 const r=await p.evaluate(async([data,x,y])=>{const i=new Image();i.src=data;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const g=c.getContext('2d');g.drawImage(i,0,0);return Array.from(g.getImageData(x*2,y*2,1,1).data)},[data,x,y]);
 console.log(f,x,y,r.join(','));
}
await b.close();
