// Entrega de Kits - roteirizacao operacional v6.6
(function(){
  const oldDeliverView=deliverView, oldStatus=status, oldCreateBatch=createBatch;
  function pendingOrdered(){return S.items.filter(i=>i.status!=='delivered').sort((a,b)=>(a.position||999999)-(b.position||999999))}
  function geoPos(){return new Promise(resolve=>{if(!navigator.geolocation)return resolve(null);navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude}),()=>resolve(null),{enableHighAccuracy:true,timeout:10000,maximumAge:30000})})}
  function hav(a,b){const R=6371,toR=v=>v*Math.PI/180,d1=toR(b.lat-a.lat),d2=toR(b.lng-a.lng),x=Math.sin(d1/2)**2+Math.cos(toR(a.lat))*Math.cos(toR(b.lat))*Math.sin(d2/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
  function progress(t){let b=document.getElementById('optimizeRoute');if(b){b.disabled=true;b.textContent=t}let m=document.getElementById('make');if(m){m.disabled=true;m.textContent=t}}
  async function geocodeItems(items){
    await loadGoogleMaps(); const geocoder=new google.maps.Geocoder(),out=[]; let cursor=0,done=0;
    async function worker(){while(cursor<items.length){let i=items[cursor++];try{let g=await geocodeGoogle(geocoder,address(i.c||{})),loc=g?.pos||g?.location||g?.geometry?.location||g;if(loc){let lat=typeof loc.lat==='function'?loc.lat():loc.lat,lng=typeof loc.lng==='function'?loc.lng():loc.lng;if(Number.isFinite(lat)&&Number.isFinite(lng))out.push({i,lat,lng})}}catch(e){}done++;if(done%10===0||done===items.length)progress('Localizando '+done+' de '+items.length+'...');await sleep(20)}}
    await Promise.all(Array.from({length:Math.min(6,items.length)},worker)); return out
  }
  function nearest(rows,start){let left=[...rows],out=[],cur=start;while(left.length){let k=0,best=Infinity;for(let j=0;j<left.length;j++){let d=hav(cur,left[j]);if(d<best){best=d;k=j}}let z=left.splice(k,1)[0];out.push(z);cur=z}return out}
  function dirOptimize(rows,origin){return new Promise(resolve=>{if(rows.length<3)return resolve(rows);let svc=new google.maps.DirectionsService(),dest=rows[rows.length-1],mid=rows.slice(0,-1);svc.route({origin,destination:{lat:dest.lat,lng:dest.lng},waypoints:mid.map(r=>({location:{lat:r.lat,lng:r.lng},stopover:true})),optimizeWaypoints:true,travelMode:google.maps.TravelMode.DRIVING},(res,st)=>{if(st!=='OK'||!res?.routes?.[0])return resolve(rows);let ord=res.routes[0].waypoint_order||[],sorted=ord.map(k=>mid[k]);sorted.push(dest);resolve(sorted)})})}
  async function saveOrder(seq){let parts=chunk(seq,25),done=0;for(let part of parts){let now=new Date().toISOString();let rs=await Promise.all(part.map((i,j)=>db.from('kit_delivery_items').update({position:done+j+1,updated_at:now}).eq('id',i.id)));let bad=rs.find(r=>r.error);if(bad)throw bad.error;done+=part.length;progress('Salvando rota '+done+' de '+seq.length+'...')}}
  async function optimizeBatch(opts={}){
    let start=opts.start||await geoPos();if(!start){alert('Para montar a rota a partir de onde você está, permita o acesso à Localização/GPS e tente novamente.');return false}
    let pending=S.items.filter(i=>i.status==='pending'||i.status==='not_found');if(pending.length<2)return true;
    try{
      progress('Preparando '+pending.length+' entregas...');
      let geo=await geocodeItems(pending);if(geo.length<2)throw new Error('Não foi possível localizar endereços suficientes ('+geo.length+' de '+pending.length+').');
      progress('Montando sequência geográfica...');
      let ordered=nearest(geo,start),final=[],origin=start,parts=chunk(ordered,24);
      for(let k=0;k<parts.length;k++){progress('Otimizando trecho '+(k+1)+' de '+parts.length+'...');let o=await dirOptimize(parts[k],origin);final.push(...o);let last=o[o.length-1];origin={lat:last.lat,lng:last.lng}}
      let used=new Set(final.map(r=>r.i.id)),missing=pending.filter(i=>!used.has(i.id)),seq=[...final.map(r=>r.i),...missing];
      await saveOrder(seq);await openBatch(S.batch);
      if(!opts.silent)alert('Rota pronta: '+final.length+' endereços ordenados a partir da sua localização.');
      return true
    }catch(e){alert('Não foi possível otimizar a rota: '+(e.message||e));render();return false}
  }
  createBatch=async function(){
    let start=await geoPos();if(!start){alert('Ative a localização do iPhone para criar a rota já otimizada a partir de onde você está.');return}
    progress('Criando rota...');
    await oldCreateBatch();
    let b=S.batches?.[0];if(!b)return;
    await openBatch(b);
    let ok=await optimizeBatch({start,silent:true});
    if(ok)alert('Rota criada e otimizada a partir da sua localização. Já pode iniciar as entregas.')
  };
  function allOptimized(){let rows=pendingOrdered();if(!rows.length)return '<div class="muted">Nenhuma entrega pendente.</div>';return rows.map((i,k)=>{let c=i.c||{},ph=String(c.phone||'').replace(/\\D/g,''),wa=ph.startsWith('55')?ph:'55'+ph;return '<div class="stop"><div class="num">'+(k+1)+'</div><div class="info"><b>'+x(c.name||'Contato')+'</b><span>'+x(address(c))+'</span>'+(ph?'<a target="_blank" href="https://wa.me/'+wa+'">WhatsApp</a>':'')+' <a target="_blank" href="https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(address(c))+'&travelmode=driving">📍 Abrir GPS</a></div><div class="acts"><button data-i="'+i.id+'" data-s="delivered" class="ok">Entregue</button><button data-i="'+i.id+'" data-s="not_found" class="danger">Não localizado</button></div></div>'}).join('')}
  function nextCard(){let list=pendingOrdered(),i=list[0];if(!i)return '<div class="card"><b>✅ Rota concluída</b><p class="muted" style="margin-top:6px">Não há entregas pendentes neste lote.</p></div>';let c=i.c||{},done=S.items.filter(z=>z.status==='delivered').length,total=S.items.length,ph=String(c.phone||'').replace(/\D/g,''),wa=ph.startsWith('55')?ph:'55'+ph;return '<div class="card" style="border:2px solid #0969f0"><span class="ey">PRÓXIMA ENTREGA • '+(done+1)+' DE '+total+'</span><h2 style="margin-top:6px">'+x(c.name||'Contato')+'</h2><p style="margin-top:7px;font-size:13px;line-height:1.45">'+x(address(c))+'</p><a class="maps full" style="display:block;text-align:center;margin-top:12px;font-size:14px;padding:13px" target="_blank" href="https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(address(c))+'&travelmode=driving">📍 ABRIR GPS</a><div class="grid" style="margin-top:9px"><button data-next-status="'+i.id+'" data-s="delivered" class="ok" style="padding:13px">✓ ENTREGUE</button><button data-next-status="'+i.id+'" data-s="not_found" class="danger" style="padding:13px">NÃO LOCALIZADO</button></div>'+(ph?'<a style="display:block;text-align:center;margin-top:10px" target="_blank" href="https://wa.me/'+wa+'">WhatsApp</a>':'')+'<p class="muted" style="margin-top:10px">Ao confirmar, a próxima entrega aparece automaticamente.</p></div>'}
  deliverView=function(){if(!S.batch)return oldDeliverView();let d=S.items.filter(i=>i.status==='delivered').length,p=S.items.length?Math.round(d/S.items.length*100):0;shell('<div class="title"><button id="back" class="back">‹</button><div><span class="ey">Lote ativo</span><h2>'+x(S.batch.name)+'</h2></div></div><div class="card"><b>'+d+' de '+S.items.length+' entregues</b><span class="muted" style="float:right">'+p+'%</span><div class="progress"><i style="width:'+p+'%"></i></div></div>'+nextCard()+'<details class="card"><summary style="cursor:pointer;font-weight:800">Ver todas as entregas na ordem otimizada</summary><div style="margin-top:12px">'+(S.busy?'Carregando...':allOptimized())+'</div></details><div class="card"><button id="optimizeRoute" class="ghost full">📍 Recalcular rota a partir de onde estou</button><p class="muted" style="margin-top:7px">Use somente se você mudou bastante de localização ou quiser recalcular as entregas pendentes.</p></div>');back.onclick=()=>{S.batch=null;S.routes=[];S.items=[];render()};document.querySelectorAll('[data-next-status]').forEach(b=>b.onclick=()=>oldStatus(b.dataset.nextStatus,b.dataset.s));document.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>oldStatus(b.dataset.i,b.dataset.s));let op=document.getElementById('optimizeRoute');if(op)op.onclick=()=>optimizeBatch()}
  window.optimizeBatch=optimizeBatch;
})();