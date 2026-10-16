
class ForgeQAPro{
  constructor(){this.baselines=new Map(JSON.parse(localStorage.getItem("forge.qa.baselines")||"[]"));this.last=null}
  async pixels(){
    const data=Forge.canvas.toDataURL("image/png"),img=new Image();img.src=data;await img.decode();
    const c=document.createElement("canvas");c.width=img.naturalWidth||Forge.canvas.width;c.height=img.naturalHeight||Forge.canvas.height;
    const g=c.getContext("2d",{willReadFrequently:true});g.drawImage(img,0,0);const d=g.getImageData(0,0,c.width,c.height).data;return{width:c.width,height:c.height,data:d}
  }
  async audit(){
    const p=await this.pixels();let black=0,nonzero=0,sum=0,samples=[];
    const step=Math.max(1,Math.floor((p.width*p.height)/20000));
    for(let i=0,px=0;i<p.data.length;i+=4*step,px++){const r=p.data[i],g=p.data[i+1],b=p.data[i+2],a=p.data[i+3];const lum=(r+g+b)/3;sum+=lum;if(lum<12&&a>0)black++;if(lum>18&&a>0)nonzero++;if(px<20000)samples.push((r<<16)|(g<<8)|b)}
    const count=Math.ceil(p.data.length/(4*step)),blackRatio=count?black/count:1,visible=count?nonzero/count:0,mean=count?sum/count:0;
    const result={width:p.width,height:p.height,blackRatio:Number(blackRatio.toFixed(4)),visibleRatio:Number(visible.toFixed(4)),meanLuminance:Number(mean.toFixed(2)),engine:Forge.diagnostics()};
    this.last=result;return result
  }
  async saveBaseline(name="default"){const a=await this.audit();const p=await this.pixels();const sample=[];for(let i=0;i<p.data.length;i+=Math.max(4,Math.floor(p.data.length/8000)))sample.push(p.data[i]);this.baselines.set(name,{audit:a,sample});this.persist();return a}
  async diff(name="default"){const base=this.baselines.get(name);if(!base)return{ok:false,reason:"baseline-missing"};const p=await this.pixels(),sample=[];for(let i=0;i<p.data.length;i+=Math.max(4,Math.floor(p.data.length/8000)))sample.push(p.data[i]);const n=Math.min(base.sample.length,sample.length);let delta=0;for(let i=0;i<n;i++)delta+=Math.abs(base.sample[i]-sample[i]);delta=n?delta/(n*255):1;return{ok:true,meanSampleDelta:Number(delta.toFixed(4)),baseline:base.audit,current:await this.audit()}}
  persist(){localStorage.setItem("forge.qa.baselines",JSON.stringify([...this.baselines.entries()]))}
}
window.ForgeQAPro=new ForgeQAPro();
