// Isolated UI fixture: no production writes or external inventory calls.
const http=require('http'),fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..'),port=8770;
const one={pk_code:'PK-TEST',pk_name:'วัสดุทดสอบ',unit:'ชิ้น',qty_per_unit:1,required_qty:3000};
const person='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222';
let trashPurged=false;const management={settings:{start:'08:00',end:'17:00',lunchStart:'12:00',lunchEnd:'13:00',holidays:[],exceptionOwnerName:'สองนคร กรียินดี',exceptionOwnerId:'11111111-1111-4111-8111-111111111111'},cases:[]};
const data={people:[{id:person,display_name:'ผู้ทำรายการทดสอบ',active:true}],jobs:[{id:job,name:'เบิกทดสอบ',active:true}],skills:[],standards:[],tickets:[{id:'33333333-3333-4333-8333-333333333333',ticket_no:'TEST-001,TEST-002',job_type_id:job,assignee_id:person,status:'done',fg_code:'FG-TEST',fg_name:'สูตรทดสอบ',requested_qty:3000,bom_version:'a'.repeat(64),created_at:'2026-09-29T08:00:00+07:00',started_at:'2026-09-30T11:00:00+07:00',ended_at:'2026-09-30T14:00:00+07:00',pause_intervals:[{start:'2026-09-30T11:30:00+07:00',end:'2026-09-30T13:30:00+07:00'}],documents:[{number:'TEST-001',quantity:null},{number:'TEST-002',quantity:null}],priority:'normal',planned_date:null,due_at:null,materials:[{...one,actual_qty:2990,confirmed_at:'2026-09-30T07:00:00Z',reason_code:'stock_shortage',short_reason:'fixture'}]}]};
data.tickets.push({...data.tickets[0],id:'55555555-5555-4555-8555-555555555555',ticket_no:'TEST-PLAN',status:'queued',started_at:null,ended_at:null,materials:[],documents:[],fg_code:null});
if(process.env.QA_FOLLOWUP==='1')data.tickets[0].status='partial';
if(process.env.QA_AUTOPICKS==='1')Object.assign(data.tickets[0],{status:'active',ended_at:null,materials:[{...one,required_qty:49.92},{...one,pk_code:'QA-2',required_qty:2.88}]});
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/rest/v1/rpc/')){let body='';req.on('data',c=>body+=c);req.on('end',()=>{const a=JSON.parse(body||'{}'),name=url.pathname.split('/').pop();let response;
  if(name==='verify_role_code')response=a.p_username==='qa'&&a.p_code==='qa';
  else if(name==='get_management_state')response=management;
  else if(name==='manage_work'){const t=data.tickets.find(t=>t.id===a.p_args.ticket_id);response=true;if(a.p_action==='history')response=[{event_type:'case',ticket_no:'TEST-001',actor_role:'clerk',actor_username:'qa',created_at:'2026-10-01T02:00:00Z',reason:'fixture',before_state:{status:'open'},after_state:{status:'resolved'}}];if(a.p_action==='case')management.cases=[{ticket_id:t.id,line_index:a.p_args.line_index,fingerprint:a.p_args.fingerprint,status:a.p_args.status,note:a.p_args.note,updated_at:new Date().toISOString(),updated_by:'qa'}];if(a.p_action==='settings')management.settings=a.p_args.settings;if(a.p_action==='plan')Object.assign(t,a.p_args);}
  else if(name==='get_dashboard_state')response=data;
  else if(name==='get_deleted_tickets_as_supervisor')response=process.env.QA_TRASH_CONFLICT==='1'&&!trashPurged?[{...data.tickets[0],id:'44444444-4444-4444-8444-444444444444',ticket_no:'PK2610-0035',status:'cancelled',deleted_at:'2026-09-30T06:48:34Z',documents:[],materials:[]}]:[];
  else if(name==='get_ticket_history')response=[];
  else if(name==='get_withdrawal_stock_catalog')response={snapshot_id:1,report_date:'fixture',snapshot_saved_at:new Date().toISOString(),items:[]};
  else if(name==='perform_work_action'){
   const args=a.p_args,t=data.tickets[0];
   if(a.p_action==='confirm_ticket_picks_as_operator'){t.materials=t.materials.map((l,i)=>({...l,...args.p_picks[i],confirmed_at:new Date().toISOString()}));if(args.p_close_status){t.status=args.p_close_status;t.ended_at=new Date().toISOString();}console.log('Autopicks saved',JSON.stringify({status:t.status,picks:args.p_picks}));}
   if(a.p_action==='purge_ticket_as_supervisor')trashPurged=true;
   if(a.p_action==='edit_ticket_with_times_as_supervisor'){t.documents=args.p_documents;t.requested_qty=args.p_requested_qty;t.materials=t.materials.map(l=>({...l,required_qty:t.requested_qty}));}
   if(a.p_action==='edit_ticket_picks_as_supervisor'){t.materials=t.materials.map((l,i)=>({...l,...args.p_picks[i],confirmed_at:new Date().toISOString()}));t.status=t.materials.some(l=>l.actual_qty<l.required_qty)?'partial':'done';}
   if(a.p_action==='set_work_standard_as_supervisor')data.standards=[{job_type_id:args.p_job_id,fg_code:args.p_fg_code,setup_minutes:args.p_setup,minutes_per_line:args.p_line,minutes_per_1000_fg:args.p_fg}];
   response=true;console.log('Fixture action',a.p_action);
  }else{res.writeHead(400);return res.end(JSON.stringify({message:'Unsupported fixture RPC'}));}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));});return;}
 if(url.pathname==='/config.js'){res.setHeader('Content-Type','text/javascript');return res.end(`export const SUPABASE_URL='http://localhost:${port}',SUPABASE_PUBLISHABLE_KEY='qa-local-only',PK_WMS_URL='http://localhost:${port}',PK_WMS_PUBLISHABLE_KEY='qa-local-only';`);}
 if(url.pathname==='/pk-bom.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({source_sha256:'a'.repeat(64),formulas:[{fg_code:'FG-TEST',fg_name:'สูตรทดสอบ',lines:[one]}]}));}
 const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 fs.readFile(file,(err,b)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':/\.(mjs|js)$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'image/jpeg');res.end(b);});
});server.listen(port,'127.0.0.1',()=>console.log('Operations fixture http://localhost:'+port));
