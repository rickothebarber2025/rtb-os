import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const clean=(v:unknown)=>String(v??"").trim();
function serviceKey(){const d=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(d)return d;const k=Deno.env.get("SUPABASE_SECRET_KEYS");if(!k)return"";try{const p=JSON.parse(k);return p.default||Object.values(p)[0]||""}catch{return""}}
function today(){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
async function safe<T>(p:PromiseLike<{data:T|null;error:unknown}>,f:T):Promise<T>{try{const r=await p;return r.error?f:(r.data??f)}catch{return f}}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL")||"",key=serviceKey(),gkey=Deno.env.get("GEMINI_API_KEY");
  if(!url||!key||!gkey)return json({error:"Required function secrets are missing."},500);
  const admin=createClient(url,key,{auth:{persistSession:false}});
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  const {data:auth,error:authErr}=await admin.auth.getUser(token);
  if(authErr||!auth.user)return json({error:"Session expired."},401);
  const profile=await safe(admin.from("user_profiles").select("email,active").eq("id",auth.user.id).maybeSingle(),null as any);
  if(!profile?.active)return json({error:"Account is inactive."},403);
  const staff=await safe(admin.from("staff").select("id,business_unit_id,full_name,email,role,tier,start_date").ilike("email",clean(profile.email)).eq("active",true).maybeSingle(),null as any);
  if(!staff)return json({error:"No active staff profile is linked to this login."},404);

  const date=today();
  const existing=await safe(admin.from("staff_ai_coaching_messages").select("*").eq("staff_id",staff.id).eq("message_date",date).eq("message_type","daily_focus").maybeSingle(),null as any);
  if(existing)return json({message:existing,cached:true});

  const since=new Date(Date.now()-30*86400000).toISOString();
  const [tasks,shifts,checklists,feedback,activity,performance]=await Promise.all([
   safe(admin.from("staff_tasks").select("title,category,details,due_date,status,completed_at").eq("staff_id",staff.id).order("created_at",{ascending:false}).limit(50),[]),
   safe(admin.from("staff_shift_records").select("shift_date,status,late_minutes,missed_shift,missed_checkout,checked_in_at,checked_out_at").eq("staff_id",staff.id).gte("shift_date",date).order("shift_date",{ascending:false}).limit(20),[]),
   safe(admin.from("operation_checklist_run_items").select("label,status,completed_at,note,run:operation_checklist_runs!inner(run_date,checklist_type,business_unit_id)").eq("completed_by_staff_id",staff.id).gte("completed_at",since).order("completed_at",{ascending:false}).limit(50),[]),
   safe(admin.from("customer_feedback_enriched").select("rating,review_text,sentiment,main_category,priority,response_created_at").eq("staff_id",staff.id).order("response_created_at",{ascending:false}).limit(30),[]),
   safe(admin.from("owner_activity_events").select("category,action,title,body,created_at").eq("actor_staff_id",staff.id).gte("created_at",since).order("created_at",{ascending:false}).limit(50),[]),
   safe(admin.from("staff_performance_summary").select("*").eq("staff_id",staff.id).maybeSingle(),null),
  ]);

  const prompt="You are RTB Gemini, the staff career coach inside RTB OS. Write a short personalized daily coaching message for this staff member using only the supplied data. Explain what they should focus on today, how their recent behavior is contributing to their career growth at RTB, and how they are contributing to the shop. Be specific but supportive. Do not reveal other staff data. Do not invent facts. Return JSON only with keys title, body, focus_points (array of 1-4 strings), career_progress (object with status, message), shop_contribution (object with status, message).";
  const model=Deno.env.get("GEMINI_MODEL")||"gemini-flash-latest";
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":gkey},body:JSON.stringify({systemInstruction:{parts:[{text:prompt}]},contents:[{role:"user",parts:[{text:JSON.stringify({staff,tasks,shifts,checklists,feedback,activity,performance,date})}]}],generationConfig:{temperature:.2,responseMimeType:"application/json"}})});
  const raw=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(raw?.error?.message||"Gemini request failed.");
  const text=raw?.candidates?.[0]?.content?.parts?.find((p:any)=>p.text)?.text||"";
  if(!text)throw new Error("Gemini returned an empty coaching message.");
  const parsed=JSON.parse(text);
  const row={staff_id:staff.id,business_unit_id:staff.business_unit_id,message_date:date,message_type:"daily_focus",title:parsed.title||"Your RTB focus today",body:parsed.body||"Review your Staff Hub and complete today's responsibilities.",focus_points:Array.isArray(parsed.focus_points)?parsed.focus_points:[],career_progress:parsed.career_progress||{},shop_contribution:parsed.shop_contribution||{},generated_by:"gemini",model,updated_at:new Date().toISOString()};
  const {data:saved,error:saveErr}=await admin.from("staff_ai_coaching_messages").upsert(row,{onConflict:"staff_id,message_date,message_type"}).select().single();
  if(saveErr)throw saveErr;
  return json({message:saved,cached:false});
 }catch(e){return json({error:e instanceof Error?e.message:"Staff coaching failed."},500)}
});
