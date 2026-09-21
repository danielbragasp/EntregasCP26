import crypto from 'node:crypto';

function b64url(input){return Buffer.from(input).toString('base64url')}
function secondsTimestamp(date){return date.toISOString().replace(/\.\d{3}Z$/,'Z')}
async function accessToken(){
  const email=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key=(process.env.GOOGLE_PRIVATE_KEY||'').replace(/\\n/g,'\n');
  if(!email||!key) throw new Error('Google Route Optimization credentials not configured');
  const now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const payload=b64url(JSON.stringify({iss:email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const unsigned=header+'.'+payload;
  const sig=crypto.sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+sig})});
  const j=await r.json(); if(!r.ok) throw new Error(j.error_description||j.error||'OAuth failed'); return j.access_token;
}
export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try{
    const {origin,stops,maxSeconds=28800,serviceSeconds=300}=req.body||{};
    if(!origin||!Number.isFinite(origin.lat)||!Number.isFinite(origin.lng)||!Array.isArray(stops)||stops.length<2) return res.status(400).json({error:'Invalid route input'});
    const project=process.env.GOOGLE_CLOUD_PROJECT;
    if(!project) throw new Error('GOOGLE_CLOUD_PROJECT not configured');
    const start=new Date(), end=new Date(start.getTime()+24*3600*1000);
    const model={
      globalStartTime:secondsTimestamp(start),globalEndTime:secondsTimestamp(end),
      shipments:stops.map((s,idx)=>({label:String(s.id||idx),deliveries:[{arrivalLocation:{latitude:s.lat,longitude:s.lng},duration:String(serviceSeconds)+'s'}]})),
      vehicles:[{label:'delivery-route',startLocation:{latitude:origin.lat,longitude:origin.lng},costPerHour:100,costPerTraveledHour:100}]
    };
    const token=await accessToken();
    const r=await fetch('https://routeoptimization.googleapis.com/v1/projects/'+encodeURIComponent(project)+':optimizeTours',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({timeout:'30s',searchMode:'CONSUME_ALL_AVAILABLE_TIME',considerRoadTraffic:true,populatePolylines:true,model})});
    const j=await r.json(); if(!r.ok) return res.status(r.status).json({error:j.error?.message||'Google optimization failed',details:j.error||null});
    const route=j.routes?.[0]||{};
    const ordered=(route.visits||[]).map(v=>stops[v.shipmentIndex ?? 0]).filter(Boolean);
    const skipped=(j.skippedShipments||[]).map(s=>stops[s.index ?? 0]).filter(Boolean);
    return res.status(200).json({ordered,skipped,metrics:route.metrics||{},polyline:route.routePolyline?.points||null});
  }catch(e){return res.status(500).json({error:e.message||String(e)})}
}
