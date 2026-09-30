// Local, in-memory UI fixture. Never connects to or writes production.
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const line={pk_code:'QA-1',pk_name:'รายการทดสอบฟอร์มเบิกจริง',unit:'ชิ้น',required_qty:10};
const data={people:[{id:'qa-person',display_name:'พนักงานทดสอบ',active:true}],jobs:[{id:'qa-job',name:'Job ทดสอบ',active:true}],skills:[],tickets:[{id:'qa-ticket',ticket_no:'LOCAL-QA-ONLY',assignee_id:'qa-person',job_type_id:'qa-job',status:'active',created_at:new Date().toISOString(),started_at:new Date().toISOString(),materials:[line,{...line,pk_code:'QA-2',unit:'ม้วน',required_qty:0.8888}]}]};
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/rest/v1/rpc/')){let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const args=JSON.parse(body||'{}'),name=url.pathname.split('/').pop();let response=null;
    if(name==='get_dashboard_state')response=data;
    else if(name==='verify_role_code')response=args.p_username==='qa'&&args.p_code==='qa';
    else if(name==='confirm_ticket_picks_as_operator'){
      const t=data.tickets[0];t.materials=t.materials.map((l,i)=>({...l,...args.p_picks[i],confirmed_at:new Date().toISOString()}));
      if(args.p_close_status){t.status=args.p_close_status;t.ended_at=new Date().toISOString();}
      console.log('LOCAL PICK SAVED',JSON.stringify({status:t.status,quantities:args.p_picks}));
    }else {res.writeHead(400);return res.end('{"message":"Unsupported fixture RPC"}');}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));
  });return;}
  if(url.pathname==='/config.js'){res.setHeader('Content-Type','text/javascript');return res.end("export const SUPABASE_URL='http://localhost:8766',SUPABASE_PUBLISHABLE_KEY='qa-local-only',PK_WMS_URL='',PK_WMS_PUBLISHABLE_KEY='';");}
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(err,b)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':/\.(mjs|js)$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'image/jpeg');res.end(b);});
}).listen(8766,'127.0.0.1',()=>console.log('Local fixture http://localhost:8766'));
