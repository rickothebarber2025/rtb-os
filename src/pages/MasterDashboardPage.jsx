import { useState, useRef, useCallback } from "react";
import Papa from "papaparse";

const G = {
  gold:"#C9A84C",dark:"#0f0f0f",card:"#1a1a1a",card2:"#222",
  border:"#2a2a2a",muted:"#666",green:"#4CAF7D",red:"#E05252",
  blue:"#5B9BE0",purple:"#9B7FD4",orange:"#E09040",
};

const MONTHLY=[
  {month:"Jan",revenue:6665},{month:"Feb",revenue:13105},
  {month:"Mar",revenue:14620},{month:"Apr",revenue:14230},
  {month:"May",revenue:12500,partial:true},
];
const BOOKSY_STAFF=[
  {name:"RICKO",revenue:29675,appts:756,occ:57,color:G.gold},
  {name:"Sara", revenue:9410, appts:126,occ:50,color:G.blue},
  {name:"STEPH",revenue:6865, appts:178,occ:15,color:G.green},
  {name:"JOSH", revenue:4975, appts:131,occ:11,color:G.purple},
  {name:"Gloria",revenue:3570,appts:47, occ:25,color:G.orange},
  {name:"Leyla",revenue:3315, appts:45, occ:49,color:"#60C8A0"},
];
const SERVICES=[
  {name:"Signature Haircut",  revenue:18800,count:419,cancelRate:15},
  {name:"Signature + Beard",  revenue:11230,count:225,cancelRate:8},
  {name:"Loc Retwist",        revenue:6720, count:84, cancelRate:28},
  {name:"High School Cut",    revenue:5495, count:157,cancelRate:16},
  {name:"Cornrows",           revenue:3445, count:53, cancelRate:25},
  {name:"Starter Locs",       revenue:2000, count:20, cancelRate:35},
  {name:"Out-Line / Line-Up", revenue:1980, count:99, cancelRate:20},
  {name:"Kid's Cut",          revenue:1475, count:59, cancelRate:5},
  {name:"Hair Wash & Blowout",revenue:640,  count:8,  cancelRate:50},
];
const SEGMENTS=[
  {label:"Slipping Away",count:3000,color:G.red},
  {label:"First Visit",  count:1408,color:G.muted},
  {label:"Non-App User", count:385, color:G.blue},
  {label:"Returning",    count:87,  color:G.green},
  {label:"New Client",   count:70,  color:G.purple},
];
const TOP_CLIENTS=[
  {name:"Elikya",           bookings:106,noShows:1, value:4253},
  {name:"Bucky",            bookings:107,noShows:5, value:4050},
  {name:"Oscar Kamunga",    bookings:121,noShows:3, value:3784},
  {name:"Nathan",           bookings:144,noShows:1, value:3484},
  {name:"Hader Herrera",    bookings:93, noShows:5, value:3397},
  {name:"Wendell Laguerre", bookings:65, noShows:2, value:3067},
  {name:"Greg 20Coeurs",    bookings:91, noShows:10,value:2872},
  {name:"Lateef POPOOLA",   bookings:41, noShows:1, value:2840},
  {name:"Jonathan Martinez",bookings:69, noShows:0, value:2751},
  {name:"Jayson B",         bookings:65, noShows:2, value:2626},
];
const UPCOMING=[
  {date:"Jun 2",client:"Joseph Ayoub Jr", service:"Signature Haircut",  staffer:"RICKO", amount:45},
  {date:"Jun 2",client:"Faycal Bamba",    service:"Out-Line / Line-Up", staffer:"Darryl",amount:20},
  {date:"Jun 2",client:"Daniel A.",       service:"Signature + Beard",  staffer:"RICKO", amount:50},
  {date:"Jun 2",client:"Jaziah Meade",    service:"Loc Retwist",        staffer:"Sara",  amount:80},
  {date:"Jun 5",client:"Davy G",          service:"Signature Haircut",  staffer:"RICKO", amount:45},
  {date:"Jun 5",client:"Kenny Ph",        service:"Signature Haircut",  staffer:"RICKO", amount:45},
  {date:"Jun 5",client:"Will Mathews",    service:"Signature + Beard",  staffer:"RICKO", amount:50},
  {date:"Jun 5",client:"Elikya",          service:"Men's Cut + Beard",  staffer:"RICKO", amount:45},
  {date:"Jun 5",client:"Peter Poulos",    service:"Hot Towel Shave",    staffer:"RICKO", amount:40},
  {date:"Jun 6",client:"Phednel Aurel",   service:"Hot Towel Shave",    staffer:"RICKO", amount:40},
  {date:"Jun 6",client:"Hadi Houmani",    service:"Signature Haircut",  staffer:"RICKO", amount:45},
];

const STAFF_COLORS=["#C9A84C","#5B9BE0","#4CAF7D","#9B7FD4","#E09040","#60C8A0","#E05252","#A0A0FF","#FF9070","#80D0A0","#D4A0FF","#FFB060","#80C0FF","#60D0D0"];

function parseAmt(v){return parseFloat(String(v||"").replace(/[^0-9.\-]/g,""))||0;}
function parsePct(v){return parseFloat(String(v||"").replace(/[^0-9.]/g,""))||0;}

function parseCSV(text){
  const {data}=Papa.parse(text,{skipEmptyLines:false});
  let hdr=-1,map={};
  for(let i=0;i<data.length;i++){
    const r=data[i].map(c=>String(c).trim().toLowerCase());
    const si=r.findIndex(c=>c==="staffs"||c==="staff");
    if(si!==-1){
      hdr=i;
      r.forEach((h,idx)=>{
        if(h==="staffs"||h==="staff")                             map.staff=idx;
        else if(h==="revenue")                                    map.revenue=idx;
        else if(h==="pos")                                        map.pos=idx;
        else if(h.includes("commission %")||h==="comission %")    map.commPct=idx;
        else if(h.includes("% before")||h==="% before tip")      map.beforeTip=idx;
        else if(h==="deduction")                                  map.deduction=idx;
        else if(h==="tips")                                       map.tips=idx;
        else if(h==="net pay")                                    map.netPay=idx;
        else if(h.includes("profit")||h.includes("loss"))        map.profitLoss=idx;
      });
      break;
    }
  }
  if(hdr===-1)return null;
  const rows=[];
  for(let i=hdr+1;i<data.length;i++){
    const r=data[i];
    const name=map.staff!==undefined?String(r[map.staff]||"").trim():"";
    if(!name||name.toLowerCase()==="total")continue;
    rows.push({
      name,
      revenue:   parseAmt(r[map.revenue]),
      pos:       parseAmt(r[map.pos]),
      commPct:   parsePct(r[map.commPct]),
      beforeTip: parseAmt(r[map.beforeTip]),
      deduction: parseAmt(r[map.deduction]),
      tips:      parseAmt(r[map.tips]),
      netPay:    parseAmt(r[map.netPay]),
      profitLoss:parseAmt(r[map.profitLoss]),
    });
  }
  return rows.length?rows:null;
}

// ── UI ────────────────────────────────────────────────────────────────────────
function Card({children,style={},alert=false}){
  return <div style={{background:G.card,borderRadius:10,border:`1px solid ${alert?G.red+"55":G.border}`,padding:"14px 16px",...style}}>{children}</div>;
}
function KPI({label,value,sub,color,alert}){
  return(
    <Card alert={alert} style={{display:"flex",flexDirection:"column",gap:3}}>
      <span style={{fontSize:10,color:G.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>{label}</span>
      <span style={{fontSize:22,fontWeight:700,color:color||G.gold,lineHeight:1.1,letterSpacing:"-0.02em"}}>{value}</span>
      {sub&&<span style={{fontSize:11,color:alert?G.red:G.muted}}>{sub}</span>}
    </Card>
  );
}
function HBar({value,max,color=G.gold,h=5}){
  const pct=Math.min(100,Math.round(((value||0)/(max||1))*100));
  return <div style={{flex:1,height:h,background:G.border,borderRadius:3,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:3,transition:"width 0.5s"}}/></div>;
}
function ST({title,right}){
  return <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><span style={{fontWeight:700,fontSize:14,color:"#e0e0e0"}}>{title}</span>{right}</div>;
}
function Alert({icon,title,body,color=G.red}){
  return(
    <div style={{background:color+"18",border:`1px solid ${color}44`,borderRadius:10,padding:"12px 14px",display:"flex",gap:12,alignItems:"flex-start"}}>
      <span style={{fontSize:18,flexShrink:0}}>{icon}</span>
      <div>
        <div style={{fontWeight:700,fontSize:13,color}}>{title}</div>
        <div style={{fontSize:12,color:color+"cc",marginTop:3,lineHeight:1.5}}>{body}</div>
      </div>
    </div>
  );
}

// ── DROP ZONE ─────────────────────────────────────────────────────────────────
function DropZone({onData,weekLabel}){
  const [drag,setDrag]=useState(false);
  const [err,setErr]=useState("");
  const ref=useRef();
  const handle=useCallback(file=>{
    if(!file)return;
    const r=new FileReader();
    r.onload=e=>{
      const parsed=parseCSV(e.target.result);
      if(parsed){setErr("");onData(parsed,file.name);}
      else setErr("Couldn't read the file. Make sure you export the commissions sheet as CSV (File → Download → CSV).");
    };
    r.readAsText(file);
  },[onData]);
  return(
    <div>
      <div
        onDragOver={e=>{e.preventDefault();setDrag(true);}}
        onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);handle(e.dataTransfer.files[0]);}}
        onClick={()=>ref.current.click()}
        style={{border:`2px dashed ${drag?G.gold:G.border}`,borderRadius:12,padding:"32px 20px",textAlign:"center",cursor:"pointer",background:drag?G.gold+"0a":G.card2,transition:"all 0.2s"}}
      >
        <div style={{fontSize:32,marginBottom:10}}>📂</div>
        <div style={{fontWeight:700,fontSize:15,color:drag?G.gold:"#ccc"}}>Drop your weekly commission CSV here</div>
        <div style={{fontSize:12,color:G.muted,marginTop:5}}>Export from Google Sheets: File → Download → Comma Separated Values (.csv)</div>
        <div style={{marginTop:16,display:"inline-block",background:G.gold,color:"#111",fontWeight:700,fontSize:13,padding:"8px 22px",borderRadius:8}}>Choose File</div>
        {weekLabel&&<div style={{marginTop:10,fontSize:11,color:G.gold}}>Currently loaded: {weekLabel}</div>}
      </div>
      <input ref={ref} type="file" accept=".csv" style={{display:"none"}} onChange={e=>handle(e.target.files[0])}/>
      {err&&<div style={{color:G.red,fontSize:12,marginTop:8}}>{err}</div>}
    </div>
  );
}

// ── STAFF TAB ─────────────────────────────────────────────────────────────────
function StaffTab({weeklyData,weekLabel,onUpload}){
  const [sort,setSort]=useState("revenue");
  const [view,setView]=useState(weeklyData?"weekly":"upload");

  const sorted=weeklyData
    ?[...weeklyData].sort((a,b)=>b[sort]-a[sort])
    :BOOKSY_STAFF;
  const maxRev=weeklyData?Math.max(...weeklyData.map(s=>s.revenue),1):29675;
  const sum=k=>weeklyData?weeklyData.reduce((s,r)=>s+(r[k]||0),0):0;

  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {weeklyData&&<button onClick={()=>setView("weekly")} style={{background:view==="weekly"?G.gold:G.card,border:`1px solid ${view==="weekly"?G.gold:G.border}`,color:view==="weekly"?"#111":G.muted,borderRadius:7,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>Weekly · {weekLabel||"Uploaded"}</button>}
        <button onClick={()=>setView("booksy")} style={{background:view==="booksy"?G.gold:G.card,border:`1px solid ${view==="booksy"?G.gold:G.border}`,color:view==="booksy"?"#111":G.muted,borderRadius:7,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>Booksy YTD</button>
        <button onClick={()=>setView("upload")} style={{background:view==="upload"?G.blue:G.card,border:`1px solid ${view==="upload"?G.blue:G.border}`,color:view==="upload"?"#fff":G.muted,borderRadius:7,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Upload Sheet</button>
      </div>

      {view==="upload"&&<DropZone onData={(d,n)=>{onUpload(d,n);setView("weekly");}} weekLabel={weekLabel}/>}

      {view==="weekly"&&weeklyData&&<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:10}}>
          <KPI label="Week Revenue" value={`$${sum("revenue").toFixed(2)}`} sub="from your sheet"/>
          <KPI label="Total Tips"   value={`$${sum("tips").toFixed(2)}`}    sub="across all staff" color={G.green}/>
          <KPI label="Net Pay Out"  value={`$${sum("netPay").toFixed(2)}`}  sub="staff payouts"    color={G.blue}/>
          <KPI label="Your P/L"     value={`$${sum("profitLoss").toFixed(2)}`} sub="your cut" color={sum("profitLoss")>=0?G.gold:G.red} alert={sum("profitLoss")<0}/>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:G.muted,alignSelf:"center"}}>Sort by:</span>
          {[["revenue","Revenue"],["netPay","Net Pay"],["tips","Tips"],["profitLoss","P/L"]].map(([k,l])=>(
            <button key={k} onClick={()=>setSort(k)} style={{background:sort===k?G.gold:G.card,border:`1px solid ${sort===k?G.gold:G.border}`,color:sort===k?"#111":G.muted,borderRadius:6,padding:"4px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>{l}</button>
          ))}
        </div>
        {sorted.map((s,i)=>{
          const c=STAFF_COLORS[i%STAFF_COLORS.length];
          return(
            <Card key={s.name}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:36,height:36,borderRadius:8,background:c+"22",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:11,color:c}}>{s.name.slice(0,2).toUpperCase()}</div>
                  <div>
                    <div style={{fontWeight:700,fontSize:14}}>{s.name}</div>
                    <div style={{fontSize:11,color:G.muted}}>{s.commPct}% commission</div>
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontWeight:800,fontSize:17,color:c}}>${s.revenue.toFixed(2)}</div>
                  <div style={{fontSize:11,color:G.muted}}>revenue</div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
                {[
                  {label:"Before Tip", value:`$${s.beforeTip.toFixed(2)}`,  color:"#ccc"},
                  {label:"Tips",       value:`$${s.tips.toFixed(2)}`,       color:G.green},
                  {label:"Net Pay",    value:`$${s.netPay.toFixed(2)}`,     color:G.blue},
                  {label:"P/L",        value:`$${s.profitLoss.toFixed(2)}`, color:s.profitLoss>=0?G.gold:G.red},
                ].map(st=>(
                  <div key={st.label} style={{background:G.card2,borderRadius:6,padding:"6px 10px"}}>
                    <div style={{fontSize:9,color:G.muted,textTransform:"uppercase",letterSpacing:"0.05em"}}>{st.label}</div>
                    <div style={{fontSize:12,fontWeight:700,color:st.color,marginTop:2}}>{st.value}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10,color:G.muted,width:58}}>Revenue</span>
                <HBar value={s.revenue} max={maxRev} color={c}/>
              </div>
            </Card>
          );
        })}
        <Card style={{padding:0,overflow:"hidden"}}>
          <div style={{padding:"12px 14px",borderBottom:`1px solid ${G.border}`,fontWeight:700,fontSize:14}}>Full Weekly Table</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{borderBottom:`1px solid ${G.border}`}}>
                  {["Staff","Revenue","Comm%","Before Tip","Deduction","Tips","Net Pay","P/L"].map(h=>(
                    <th key={h} style={{padding:"8px 12px",color:G.muted,fontWeight:600,textAlign:h==="Staff"?"left":"right",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeklyData.map(s=>(
                  <tr key={s.name} style={{borderBottom:`1px solid ${G.border}`}}>
                    <td style={{padding:"10px 12px",fontWeight:600}}>{s.name}</td>
                    <td style={{padding:"10px 12px",textAlign:"right",color:G.gold,fontWeight:700}}>${s.revenue.toFixed(2)}</td>
                    <td style={{padding:"10px 12px",textAlign:"right",color:G.muted}}>{s.commPct}%</td>
                    <td style={{padding:"10px 12px",textAlign:"right"}}>${s.beforeTip.toFixed(2)}</td>
                    <td style={{padding:"10px 12px",textAlign:"right",color:G.muted}}>${s.deduction.toFixed(2)}</td>
                    <td style={{padding:"10px 12px",textAlign:"right",color:G.green}}>${s.tips.toFixed(2)}</td>
                    <td style={{padding:"10px 12px",textAlign:"right",color:G.blue,fontWeight:700}}>${s.netPay.toFixed(2)}</td>
                    <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700,color:s.profitLoss>=0?G.gold:G.red}}>${s.profitLoss.toFixed(2)}</td>
                  </tr>
                ))}
                <tr style={{background:G.card2,borderTop:`1px solid ${G.border}`}}>
                  <td style={{padding:"10px 12px",fontWeight:800,color:"#ccc"}}>TOTAL</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:G.gold,fontWeight:800}}>${sum("revenue").toFixed(2)}</td>
                  <td/>
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700}}>${sum("beforeTip").toFixed(2)}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:G.muted}}>${sum("deduction").toFixed(2)}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:G.green,fontWeight:700}}>${sum("tips").toFixed(2)}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:G.blue,fontWeight:800}}>${sum("netPay").toFixed(2)}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:800,color:sum("profitLoss")>=0?G.gold:G.red}}>${sum("profitLoss").toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </>}

      {view==="booksy"&&<>
        <Alert icon="⚡" title="RICKO is generating 48% of all revenue" color={G.orange}
          body="You drove $29,675 of $61,120 YTD. STEPH logs 204 hours at 15% occupancy. JOSH logs 211 hours at 11%. Both staffers have massive idle time."/>
        {BOOKSY_STAFF.map(s=>(
          <Card key={s.name}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:36,height:36,borderRadius:8,background:s.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:11,color:s.color}}>{s.name.slice(0,2).toUpperCase()}</div>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>{s.name}</div>
                  <div style={{fontSize:11,color:G.muted}}>{s.appts} appts · {s.occ}% occupancy</div>
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontWeight:800,fontSize:17,color:s.color}}>${s.revenue.toLocaleString()}</div>
                <div style={{fontSize:11,color:G.muted}}>${Math.round(s.revenue/s.appts)}/appt</div>
              </div>
            </div>
            <HBar value={s.revenue} max={29675} color={s.color}/>
            <div style={{fontSize:11,color:G.muted,marginTop:6}}>{Math.round((s.revenue/61120)*100)}% of YTD revenue</div>
          </Card>
        ))}
      </>}

      {view==="weekly"&&!weeklyData&&<DropZone onData={(d,n)=>{onUpload(d,n);}} weekLabel={null}/>}
    </div>
  );
}

// ── OTHER TABS ────────────────────────────────────────────────────────────────
function OverviewTab({setTab}){
  const maxRev=Math.max(...MONTHLY.map(m=>m.revenue));
  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <Alert icon="⚠️" title="3,000 clients slipping away" body="Out of 3,650 total clients, only 87 are active returning clients. A reactivation campaign is your biggest revenue opportunity right now."/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(125px,1fr))",gap:10}}>
        <KPI label="YTD Revenue"  value="$61,120" sub="Jan–May 2026"/>
        <KPI label="Peak Month"   value="$14,620" sub="March 2026" color={G.green}/>
        <KPI label="2026 Appts"   value="1,354"   sub="completed" color={G.blue}/>
        <KPI label="Total Clients"value="3,650"   sub="since 2019" color={G.purple}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(125px,1fr))",gap:10}}>
        <KPI label="Slipping Away"value="3,000" sub="need reactivation" color={G.red} alert/>
        <KPI label="No-Shows"     value="674"   sub="all time" color={G.red} alert/>
        <KPI label="Forecasted"   value="$550"  sub="Jun pre-booked" color={G.orange}/>
        <KPI label="All-Time Bkgs"value="15,996"sub="since 2019" color={G.muted}/>
      </div>
      <Card>
        <ST title="Monthly Revenue — 2026" right={<span style={{fontSize:11,color:G.gold,fontWeight:700}}>$61,120 YTD</span>}/>
        <div style={{display:"flex",gap:8,alignItems:"flex-end",height:130}}>
          {MONTHLY.map(m=>{
            const h=Math.round((m.revenue/maxRev)*108);
            return(
              <div key={m.month} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:G.muted}}>${(m.revenue/1000).toFixed(1)}k</span>
                <div style={{width:"100%",height:108,display:"flex",alignItems:"flex-end"}}>
                  <div style={{width:"100%",height:h,borderRadius:"4px 4px 0 0",background:m.partial?G.gold+"66":G.gold}}/>
                </div>
                <span style={{fontSize:11,fontWeight:m.partial?400:600,color:m.partial?G.muted:"#ddd"}}>{m.month}</span>
              </div>
            );
          })}
        </div>
        <div style={{fontSize:11,color:G.muted,marginTop:10,borderTop:`1px solid ${G.border}`,paddingTop:8}}>May is still in progress</div>
      </Card>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Card>
          <ST title="Revenue by Barber" right={<button onClick={()=>setTab("staff")} style={{background:"none",border:"none",color:G.gold,fontSize:11,cursor:"pointer",fontWeight:600}}>All →</button>}/>
          {BOOKSY_STAFF.slice(0,5).map(s=>(
            <div key={s.name} style={{display:"flex",alignItems:"center",gap:8,marginBottom:9}}>
              <span style={{fontSize:12,width:52,color:"#ccc",flexShrink:0}}>{s.name}</span>
              <HBar value={s.revenue} max={29675} color={s.color}/>
              <span style={{fontSize:11,color:s.color,minWidth:44,textAlign:"right",fontWeight:700}}>${(s.revenue/1000).toFixed(1)}k</span>
            </div>
          ))}
          <div style={{fontSize:11,color:G.orange,borderTop:`1px solid ${G.border}`,paddingTop:8,marginTop:4}}>⚡ RICKO = 48% of all revenue</div>
        </Card>
        <Card>
          <ST title="Top Services" right={<button onClick={()=>setTab("services")} style={{background:"none",border:"none",color:G.gold,fontSize:11,cursor:"pointer",fontWeight:600}}>All →</button>}/>
          {SERVICES.slice(0,5).map(s=>(
            <div key={s.name} style={{display:"flex",alignItems:"center",gap:8,marginBottom:9}}>
              <span style={{fontSize:11,width:90,color:"#ccc",flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
              <HBar value={s.revenue} max={18800} color={G.green}/>
              <span style={{fontSize:11,color:G.green,minWidth:44,textAlign:"right",fontWeight:700}}>${(s.revenue/1000).toFixed(1)}k</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function ServicesTab(){
  const [sort,setSort]=useState("revenue");
  const sorted=[...SERVICES].sort((a,b)=>sort==="cancelRate"?b.cancelRate-a.cancelRate:b[sort]-a[sort]);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <Alert icon="📉" title="Hair Wash & Blowout has a 50% cancellation rate" color={G.red}
        body="Starter Locs (35%), Single Two Strand Twist (34%), Cornrow Extensions (33%) are also critical. These hairstylist services are losing half their bookings."/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <span style={{fontSize:12,color:G.muted,alignSelf:"center"}}>Sort by:</span>
        {[["revenue","Revenue"],["count","Volume"],["cancelRate","Cancel Rate"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSort(k)} style={{background:sort===k?G.gold:G.card,border:`1px solid ${sort===k?G.gold:G.border}`,color:sort===k?"#111":G.muted,borderRadius:6,padding:"4px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>{l}</button>
        ))}
      </div>
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 70px 60px 70px",padding:"8px 14px",borderBottom:`1px solid ${G.border}`,fontSize:10,color:G.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>
          <span>Service</span><span style={{textAlign:"center"}}>Revenue</span><span style={{textAlign:"center"}}>Appts</span><span style={{textAlign:"center"}}>Cancel%</span>
        </div>
        {sorted.map((s,i)=>(
          <div key={s.name} style={{display:"grid",gridTemplateColumns:"1fr 70px 60px 70px",padding:"11px 14px",alignItems:"center",fontSize:13,borderBottom:i<sorted.length-1?`1px solid ${G.border}`:"none"}}>
            <div>
              <div style={{fontWeight:600}}>{s.name}</div>
              <div style={{marginTop:4}}><HBar value={s.revenue} max={18800} color={G.green} h={4}/></div>
            </div>
            <span style={{textAlign:"center",fontWeight:700,color:G.gold}}>${(s.revenue/1000).toFixed(1)}k</span>
            <span style={{textAlign:"center",color:G.blue}}>{s.count}</span>
            <span style={{textAlign:"center",fontWeight:700,color:s.cancelRate>=30?G.red:s.cancelRate>=15?G.orange:G.green}}>{s.cancelRate}%</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function ClientsTab(){
  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <Alert icon="🚨" title="3,000 clients slipping away — your biggest growth lever"
        body="You have 3,650 clients in your database but only 87 are actively returning. Even getting 10% to rebook would be massive. A Booksy reactivation campaign with a targeted offer is the move."/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10}}>
        <KPI label="Total Clients" value="3,650" sub="since 2019" color={G.blue}/>
        <KPI label="Slipping Away" value="3,000" sub="inactive" color={G.red} alert/>
        <KPI label="Returning"     value="87"    sub="loyal base" color={G.green}/>
        <KPI label="No-Shows"      value="674"   sub="all time" color={G.red} alert/>
      </div>
      <Card>
        <ST title="New vs Returning — 2026"/>
        <div style={{display:"flex",gap:12,marginBottom:12}}>
          <div style={{flex:1,background:G.blue+"18",borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontSize:11,color:G.muted}}>New Clients</div>
            <div style={{fontSize:22,fontWeight:800,color:G.blue}}>258</div>
            <div style={{fontSize:11,color:G.muted}}>44% of revenue</div>
          </div>
          <div style={{flex:1,background:G.green+"18",borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontSize:11,color:G.muted}}>Returning</div>
            <div style={{fontSize:22,fontWeight:800,color:G.green}}>325</div>
            <div style={{fontSize:11,color:G.muted}}>56% of revenue</div>
          </div>
        </div>
      </Card>
      <Card>
        <ST title="Client Segments"/>
        {SEGMENTS.map(seg=>(
          <div key={seg.label} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <span style={{fontSize:12,width:110,color:"#ccc",flexShrink:0}}>{seg.label}</span>
            <HBar value={seg.count} max={3000} color={seg.color}/>
            <span style={{fontSize:11,color:seg.color,minWidth:36,textAlign:"right",fontWeight:700}}>{seg.count}</span>
          </div>
        ))}
      </Card>
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{padding:"12px 14px",borderBottom:`1px solid ${G.border}`,fontWeight:700,fontSize:14}}>Top 10 Clients — All-Time</div>
        <div style={{display:"grid",gridTemplateColumns:"20px 1fr 50px 55px 65px",padding:"7px 14px",borderBottom:`1px solid ${G.border}`,fontSize:10,color:G.muted,textTransform:"uppercase"}}>
          <span>#</span><span>Client</span><span style={{textAlign:"center"}}>Appts</span><span style={{textAlign:"center"}}>NoShow</span><span style={{textAlign:"right"}}>Value</span>
        </div>
        {TOP_CLIENTS.map((c,i)=>(
          <div key={c.name} style={{display:"grid",gridTemplateColumns:"20px 1fr 50px 55px 65px",padding:"10px 14px",alignItems:"center",fontSize:13,borderBottom:i<TOP_CLIENTS.length-1?`1px solid ${G.border}`:"none"}}>
            <span style={{fontSize:10,color:G.muted}}>{i+1}</span>
            <span style={{fontWeight:600}}>{c.name}</span>
            <span style={{textAlign:"center",color:G.blue}}>{c.bookings}</span>
            <span style={{textAlign:"center",color:c.noShows>=8?G.red:G.muted}}>{c.noShows}</span>
            <span style={{textAlign:"right",fontWeight:800,color:G.gold}}>${c.value.toLocaleString()}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function UpcomingTab(){
  const total=UPCOMING.filter(u=>u.amount>0).reduce((s,u)=>s+u.amount,0);
  const dates=[...new Set(UPCOMING.map(u=>u.date))];
  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
        <KPI label="Forecasted"    value={`$${total}`} sub="pre-booked"/>
        <KPI label="Appointments"  value={UPCOMING.length} sub="Jun 2–6" color={G.blue}/>
        <KPI label="Complimentary" value={UPCOMING.filter(u=>u.amount===0).length} sub="no charge" color={G.muted}/>
      </div>
      <div style={{fontSize:11,color:G.muted}}>Walk-ins and same-day bookings will push the final number higher.</div>
      {dates.map(date=>{
        const appts=UPCOMING.filter(u=>u.date===date);
        const dayTotal=appts.filter(u=>u.amount>0).reduce((s,u)=>s+u.amount,0);
        return(
          <Card key={date}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
              <span style={{fontWeight:700,color:G.gold}}>{date}</span>
              <span style={{fontWeight:700,color:G.green}}>${dayTotal}</span>
            </div>
            {appts.map((t,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderTop:`1px solid ${G.border}`,fontSize:13}}>
                <div>
                  <span style={{fontWeight:500}}>{t.client}</span>
                  <span style={{fontSize:11,color:G.muted,marginLeft:8}}>{t.service}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:11,color:G.muted}}>{t.staffer}</span>
                  <span style={{fontWeight:700,color:t.amount>0?G.gold:G.muted}}>{t.amount>0?`$${t.amount}`:"Free"}</span>
                </div>
              </div>
            ))}
          </Card>
        );
      })}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
const TABS=[
  {id:"overview",label:"Overview"},
  {id:"staff",   label:"Staff"},
  {id:"services",label:"Services"},
  {id:"clients", label:"Clients"},
  {id:"upcoming",label:"Upcoming"},
];

export default function MasterDashboardPage(){
  const [tab,setTab]=useState("overview");
  const [weeklyData,setWeekly]=useState(null);
  const [weekLabel,setLabel]=useState(null);
  return(
    <div style={{background:G.dark,minHeight:"100vh",color:"#fff",fontFamily:"'DM Sans',system-ui,sans-serif",paddingBottom:48}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
      <div style={{background:"#0a0a0a",borderBottom:`1px solid ${G.border}`,padding:"12px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,borderRadius:7,background:G.gold,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:11,color:"#111"}}>RTB</div>
          <div>
            <div style={{fontWeight:800,fontSize:13}}>RTB Lounge</div>
            <div style={{fontSize:10,color:G.muted}}>306 Cumberland St · Ottawa</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:10,color:G.green,fontWeight:700}}>● Booksy Data</div>
          {weeklyData&&<div style={{fontSize:10,color:G.gold}}>+ Weekly Loaded</div>}
        </div>
      </div>
      <div style={{display:"flex",borderBottom:`1px solid ${G.border}`,overflowX:"auto",background:"#0a0a0a"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"none",border:"none",color:tab===t.id?G.gold:G.muted,fontWeight:tab===t.id?700:400,fontSize:12,padding:"10px 14px",cursor:"pointer",borderBottom:tab===t.id?`2px solid ${G.gold}`:"2px solid transparent",marginBottom:-1,whiteSpace:"nowrap"}}>
            {t.label}
            {t.id==="staff"&&weeklyData&&<span style={{marginLeft:5,background:G.gold,color:"#111",fontSize:9,fontWeight:800,padding:"1px 5px",borderRadius:3}}>LIVE</span>}
          </button>
        ))}
      </div>
      <div style={{padding:"14px 16px"}}>
        {tab==="overview" &&<OverviewTab setTab={setTab}/>}
        {tab==="staff"    &&<StaffTab weeklyData={weeklyData} weekLabel={weekLabel} onUpload={(d,n)=>{setWeekly(d);setLabel(n);}}/>}
        {tab==="services" &&<ServicesTab/>}
        {tab==="clients"  &&<ClientsTab/>}
        {tab==="upcoming" &&<UpcomingTab/>}
      </div>
    </div>
  );
}
