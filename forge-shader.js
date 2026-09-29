import {pc} from "./forge-engine.js";

class ForgeShaderSystem{
  constructor(){this.materials=new Map();this.time=0}
  make(name="ForgeDissolve"){
    const vertexGLSL="attribute vec3 aPosition; attribute vec2 aUv0; uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; varying vec2 vUv0; void main(void){vUv0=aUv0;gl_Position=matrix_viewProjection*matrix_model*vec4(aPosition,1.0);}";
    const fragmentGLSL="precision highp float; varying vec2 vUv0; uniform vec4 uColor; uniform float uTime; uniform float uDissolve; uniform float uEdge; uniform float uPulse; void main(void){ float wave=sin(vUv0.y*28.0+uTime*4.0)*0.025; float n=fract(sin(dot(vUv0+wave,vec2(12.9898,78.233)))*43758.5453); float mask=step(uDissolve,n); float edge=smoothstep(uDissolve,uDissolve+max(.001,uEdge),n)-smoothstep(uDissolve+max(.001,uEdge),uDissolve+max(.002,uEdge*2.0),n); vec3 color=mix(uColor.rgb,vec3(1.0,.35,.06),edge*(.65+.35*uPulse)); if(mask<.5)discard; gl_FragColor=vec4(color,1.0);}";
    const material=new pc.ShaderMaterial({uniqueName:name,vertexGLSL,fragmentGLSL,attributes:{aPosition:pc.SEMANTIC_POSITION,aUv0:pc.SEMANTIC_TEXCOORD0}});
    material.setParameter("uColor",[.18,.65,1,1]);material.setParameter("uTime",0);material.setParameter("uDissolve",0);material.setParameter("uEdge",.08);material.setParameter("uPulse",0);material.update();
    this.materials.set(name,material);return material
  }
  applyPreset(preset){
    const r=Forge.selected();if(!r)throw new Error("Select a renderable entity");
    const material=this.materials.get("ForgeDissolve")||this.make();
    const presets={dissolve:{dissolve:.35,edge:.08,color:[.16,.65,1,1]},energy:{dissolve:.08,edge:.18,color:[.25,.45,1,1]},hologram:{dissolve:-.05,edge:.2,color:[.1,.9,1,1]},damage:{dissolve:.15,edge:.1,color:[1,.08,.04,1]}};
    const p=presets[preset]||presets.dissolve;material.setParameter("uDissolve",p.dissolve);material.setParameter("uEdge",p.edge);material.setParameter("uColor",p.color);material.update();
    const walk=e=>{if(e.render?.meshInstances)for(const mi of e.render.meshInstances)mi.material=material;for(const child of e.children)walk(child)};walk(r.entity);
    r.components.shader={preset,material:"ForgeDissolve"};return true
  }
  update(dt){this.time+=dt;for(const m of this.materials.values())m.setParameter("uTime",this.time)}
  serialize(){return{materials:[...this.materials.keys()]}}
}
window.ForgeShaders=new ForgeShaderSystem();
Forge.onPrePhysics(dt=>window.ForgeShaders.update(dt));
window.ForgeShaders.make();