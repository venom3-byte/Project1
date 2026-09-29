
class ForgeUISystem{
  constructor(){this.root=null;this.elements=[];this.ensure()}
  ensure(){
    if(this.root&&document.body.contains(this.root))return;
    this.root=document.createElement("div");this.root.id="forgeGameUI";Object.assign(this.root.style,{position:"fixed",inset:"0",pointerEvents:"none",zIndex:"80",display:"none",fontFamily:"system-ui,Segoe UI,sans-serif"});
    document.body.appendChild(this.root)
  }
  clear(){this.ensure();this.root.innerHTML="";this.elements=[]}
  show(){this.ensure();this.root.style.display="block"}
  hide(){this.ensure();this.root.style.display="none"}
  text(id,text,style={}){
    this.ensure();
    let e=document.getElementById("forge-ui-"+id);
    if(!e){e=document.createElement("div");e.id="forge-ui-"+id;this.root.appendChild(e);this.elements.push({id,type:"text",text,style})}
    e.textContent=text;Object.assign(e.style,{position:"absolute",left:"20px",top:"20px",color:"#fff",fontSize:"18px",textShadow:"0 2px 5px #000",...style});return e
  }
  button(id,label,onClick,style={}){
    this.ensure();let e=document.getElementById("forge-ui-"+id);
    if(!e){e=document.createElement("button");e.id="forge-ui-"+id;e.textContent=label;e.onclick=onClick;e.style.pointerEvents="auto";this.root.appendChild(e);this.elements.push({id,type:"button",label,style})}
    Object.assign(e.style,{position:"absolute",left:"20px",top:"70px",padding:"10px 14px",borderRadius:"10px",border:"1px solid #ffffff44",background:"#071321cc",color:"#fff",...style});return e
  }
  hudForThirdPerson(getState){
    this.clear();this.show();
    this.text("title","FORGE GAME",{left:"20px",top:"18px",fontWeight:"800",letterSpacing:"2px"});
    this.text("hp","HP 100",{right:"20px",left:"auto",top:"18px",fontWeight:"800"});
    this.text("state","READY",{left:"20px",top:"55px",fontSize:"12px",color:"#9fc0db"});
    const tick=()=>{if(this.root.style.display==="none")return;const s=getState?.();if(s){this.text("hp","HP "+Math.round(s.hp),{right:"20px",left:"auto",top:"18px",fontWeight:"800",color:s.hp<30?"#ff7180":"#fff"});this.text("state",s.state||"READY",{left:"20px",top:"55px",fontSize:"12px",color:"#9fc0db"})}requestAnimationFrame(tick)};tick()
  }
  serialize(){return{version:1,elements:this.elements}}
  load(data){this.clear();if(!data?.elements)return;for(const e of data.elements){if(e.type==="text")this.text(e.id,e.text,e.style);if(e.type==="button")this.button(e.id,e.label,()=>{},e.style)}}
}
window.ForgeUISystem=new ForgeUISystem();
