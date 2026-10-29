(async () => {
 const result={capturedAt:new Date().toISOString(),manifestVersion:chrome.runtime.getManifest().version};
 try{
  const response=await chrome.runtime.sendMessage({target:'recorder',type:'STATUS'});Object.assign(result,response);
  result.session=(await chrome.storage.session.get('nativeMobileViewport')).nativeMobileViewport;
  try{const tab=await chrome.tabs.get(response.status.tabId);const b=await chrome.windows.get(tab.windowId);result.windowBounds={width:b.width,height:b.height,left:b.left,top:b.top};
   try{const [p]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({width:innerWidth,height:innerHeight,scrollY})});result.pageViewport=p.result;}catch(e){result.pageError=e.message;}
  }catch(e){result.tabError=e.message;}
  result.debuggerAttached=(await chrome.debugger.getTargets()).find(t=>t.tabId===response.status.tabId)?.attached;
 }catch(e){result.error=e.message;}
 const value=JSON.stringify(result,null,2);document.querySelector('#result').textContent=value;
 const url=URL.createObjectURL(new Blob([value],{type:'application/json'}));await chrome.downloads.download({url,filename:`Page Recorder/performance-stats-${Date.now()}.json`,saveAs:false});
})();
