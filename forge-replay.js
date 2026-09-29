
class ForgeReplaySystem{
  constructor(){this.recording=false;this.playing=false;this.frames=[];this.time=0;this.index=0;this.fixedDt=1/60;this.maxSeconds=600}
  startRecord(){this.recording=true;this.playing=false;this.frames=[];this.time=0;this.index=0;return true}
  recordStep(dt){
    if(!this.recording)return;
    this.time+=dt;if(this.time>this.maxSeconds){this.stopRecord();return}
    const input=window.ForgeRuntime?.input?.snapshot?.()||{};
    const player=window.ForgeGameplay?.characters?.values?.().next?.().value;
    let transform=null;if(player){const p=player.entity.getPosition(),r=player.entity.getEulerAngles();transform={position:[p.x,p.y,p.z],rotation:[r.x,r.y,r.z]}}
    this.frames.push({t:Number(this.time.toFixed(4)),input,transform})
  }
  stopRecord(){this.recording=false;return this.serialize()}
  play(data=this.serialize()){this.load(data);this.playing=true;this.index=0;this.time=0;return true}
  stop(){this.playing=false;this.index=0;return true}
  step(dt){
    if(!this.playing||!this.frames.length)return;
    this.time+=dt;
    while(this.index<this.frames.length-1&&this.frames[this.index+1].t<=this.time)this.index++;
    const f=this.frames[this.index];if(!f)return;
    const input=window.ForgeRuntime?.input;if(input){for(const [action,down] of Object.entries(f.input||{})){if(down)input.down.add(action);else input.down.delete(action)}}
  }
  serialize(){return{version:1,fixedDt:this.fixedDt,duration:this.frames.at(-1)?.t||0,frames:this.frames}}
  load(data){this.frames=data?.frames||[];this.fixedDt=Number(data?.fixedDt||1/60);this.time=0;this.index=0}
  status(){return{recording:this.recording,playing:this.playing,frames:this.frames.length,duration:this.frames.at(-1)?.t||0,index:this.index,time:this.time}}
}
window.ForgeReplay=new ForgeReplaySystem();
Forge.onPrePhysics(dt=>{window.ForgeReplay.recordStep(dt);window.ForgeReplay.step(dt)});
