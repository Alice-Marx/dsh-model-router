/** Once a gesture has two fingers, none of its remaining contacts may resume a held mouse drag. */
export function createDesktopTouchTracker(){
  const points=new Map();let multiple=false,center=null
  const average=()=>{const values=[...points.values()];return {x:values.reduce((sum,item)=>sum+item.x,0)/values.length,y:values.reduce((sum,item)=>sum+item.y,0)/values.length}}
  const clear=()=>{points.clear();multiple=false;center=null}
  return Object.freeze({clear,handle(action,event){
    if(event.pointerType!=='touch')return {handled:false}
    if(!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY)||!Number.isSafeInteger(event.pointerId))return {handled:true,release:true}
    if(action==='down'){
      points.set(event.pointerId,{x:event.clientX,y:event.clientY})
      if(points.size<2&&!multiple)return {handled:false}
      const release=!multiple;multiple=true;center=average();return {handled:true,release}
    }
    if(action==='move'){
      if(!points.has(event.pointerId))return {handled:multiple}
      points.set(event.pointerId,{x:event.clientX,y:event.clientY})
      if(!multiple)return {handled:false}
      if(points.size<2)return {handled:true}
      const next=average(),previous=center??next;center=next
      const deltaX=Math.max(-480,Math.min(480,Math.round(previous.x-next.x))),deltaY=Math.max(-480,Math.min(480,Math.round(previous.y-next.y)))
      return {handled:true,...(deltaX||deltaY?{wheel:{type:'wheel',deltaX,deltaY}}:{})}
    }
    const handled=multiple;points.delete(event.pointerId);center=points.size>=2?average():null
    if(!points.size){multiple=false;center=null}
    return {handled,release:handled&&!points.size}
  }})
}
