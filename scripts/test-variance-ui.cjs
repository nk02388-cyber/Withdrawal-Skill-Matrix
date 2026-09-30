// Local, in-memory UI fixture. Never connects to or writes production.
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const line={pk_code:'QA-1',pk_name:'รายการทดสอบฟอร์มเบิกจริง',unit:'ชิ้น',required_qty:10};
const data={people:[{id:'qa-person',display_name:'พนักงานทดสอบ',active:true}],jobs:[{id:'qa-job',name:'Job ทดสอบ',active:true}],skills:[],tickets:[{id:'qa-ticket',ticket_no:'LOCAL-QA-ONLY',assignee_id:'qa-person',job_type_id:'qa-job',status:'done',ended_at:new Date().toISOString(),created_at:new Date().toISOString(),started_at:new Date().toISOString(),materials:[{...line,actual_qty:10,confirmed_at:new Date().toISOString()},{...line,actual_qty:0.8888,confirmed_at:new Date().toISOString(),pk_code:'QA-2',unit:'ม้วน',required_qty:0.8888}]}]};
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/rest/v1/rpc/')){let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const args=JSON.parse(body||'{}'),name=url.pathname.split('/').pop();let response=null;
    if(name==='get_dashboard_state')response={...data,tickets:data.tickets.filter(t=>!t.deleted_at)};
    else if(name==='get_deleted_tickets_as_supervisor')response=data.tickets.filter(t=>t.deleted_at);
    else if(name==='add_staff_with_photo_as_supervisor'){response='qa-new';data.people.push({id:response,display_name:args.p_name,active:true,photo_data:args.p_photo});}
    else if(name==='set_staff_photo_as_supervisor'){data.people.find(p=>p.id===args.p_staff_id).photo_data=args.p_photo;}
    else if(name==='rename_staff_as_supervisor'){data.people.find(p=>p.id===args.p_staff_id).display_name=args.p_name;}
    else if(name==='get_ticket_history')response=[];
    else if(name==='set_ticket_deleted_as_supervisor'){data.tickets[0].deleted_at=args.p_deleted?new Date().toISOString():null;}
    else if(name==='verify_role_code')response=args.p_username==='qa'&&args.p_code==='qa';
    else if(['confirm_ticket_picks_as_operator','edit_ticket_picks_as_supervisor'].includes(name)){
      const t=data.tickets[0];t.materials=t.materials.map((l,i)=>({...l,...args.p_picks[i],confirmed_at:new Date().toISOString()}));
      if(name==='edit_ticket_picks_as_supervisor')t.status=t.materials.some(l=>l.actual_qty<l.required_qty)?'partial':'done';
      if(args.p_close_status){t.status=args.p_close_status;t.ended_at=new Date().toISOString();}
      console.log('LOCAL PICK SAVED',JSON.stringify({status:t.status,quantities:args.p_picks}));
    }else {res.writeHead(400);return res.end('{"message":"Unsupported fixture RPC"}');}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));
  });return;}
  if(url.pathname==='/config.js'){res.setHeader('Content-Type','text/javascript');return res.end("export const SUPABASE_URL='http://localhost:8769',SUPABASE_PUBLISHABLE_KEY='qa-local-only',PK_WMS_URL='',PK_WMS_PUBLISHABLE_KEY='';");}
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(err,b)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':/\.(mjs|js)$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'image/jpeg');res.end(b);});
}).listen(8769,'127.0.0.1',()=>console.log('Local fixture http://localhost:8769'));
