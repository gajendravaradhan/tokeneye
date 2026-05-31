import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createApiHandlerFromPath } from "./api.ts";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function getMimeType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

const INLINE_DASHBOARD = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tokeneye Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"><\/script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;min-height:100vh}
header{background:#161b22;border-bottom:1px solid #30363d;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
header h1{font-size:20px;color:#58a6ff}
.filters{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.filters select,.filters button{padding:6px 12px;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;font-size:13px}
.filters button{background:#238636;border-color:#238636;cursor:pointer}
.filters button:hover{background:#2ea043}
main{padding:24px;max-width:1400px;margin:0 auto}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:32px}
.stat-card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.stat-card .label{font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px}
.stat-card .value{font-size:24px;font-weight:600;color:#58a6ff}
.stat-card .sub{font-size:12px;color:#8b949e;margin-top:4px}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(450px,1fr));gap:24px}
.chart-box{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.chart-box h3{font-size:14px;margin-bottom:12px;color:#8b949e}
canvas{width:100%!important;max-height:300px}
.tables{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:24px;margin-top:24px}
.table-box{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;overflow-x:auto}
.table-box h3{font-size:14px;margin-bottom:12px;color:#8b949e}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d}
th{color:#8b949e;font-weight:500}
.error{background:#1a1215;border:1px solid #da3633;border-radius:8px;padding:16px;color:#f85149;display:none;margin-bottom:16px}
.loading{text-align:center;padding:48px;color:#8b949e}
</style>
</head>
<body>
<header>
<h1>Tokeneye</h1>
<div class="filters">
<select id="dateRange">
<option value="session">Session</option>
<option value="hour">Hour</option>
<option value="day" selected>Day</option>
<option value="week">Week</option>
<option value="month">Month</option>
<option value="all">All</option>
</select>
<select id="statusFilter"><option value="all">All Status</option><option value="success">Success</option><option value="error">Error</option></select>
<button onclick="refresh()">Refresh</button>
</div>
</header>
<main>
<div id="error" class="error"></div>
<div id="loading" class="loading">Loading...</div>
<div id="content" style="display:none">
<div class="stats" id="stats"></div>
<div class="charts">
<div class="chart-box"><h3>Token Usage Timeline</h3><canvas id="timelineChart"></canvas></div>
<div class="chart-box"><h3>Hourly Heatmap</h3><canvas id="heatmapChart"></canvas></div>
</div>
<div class="charts">
<div class="chart-box"><h3>Model Breakdown</h3><canvas id="modelChart"></canvas></div>
<div class="chart-box"><h3>Top Consumers</h3><canvas id="consumerChart"></canvas></div>
</div>
<div class="tables">
<div class="table-box"><h3>Model Details</h3><table id="modelTable"></table></div>
<div class="table-box"><h3>Agent Breakdown</h3><table id="agentTable"></table></div>
</div>
</div>
</main>
<script>
function fmt(n){return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':n.toFixed(0)}
function fmt$(n){return '$'+n.toFixed(2)}
function fmtMs(n){return Math.round(n)+'ms'}
function fmtPct(n){return n.toFixed(1)+'%'}

var _charts=[];

async function refresh(){
  document.getElementById('loading').style.display='block';
  document.getElementById('content').style.display='none';
  document.getElementById('error').style.display='none';
  try{
    var params=new URLSearchParams({
      dateRange:document.getElementById('dateRange').value,
      status:document.getElementById('statusFilter').value
    });
    var res=await fetch('/api/full?'+params);
    if(!res.ok)throw new Error(res.status+' '+res.statusText);
    var data=await res.json();
    _charts.forEach(function(c){c.destroy()});
    _charts=[];
    render(data);
    document.getElementById('loading').style.display='none';
    document.getElementById('content').style.display='block';
  }catch(e){
    document.getElementById('loading').style.display='none';
    document.getElementById('error').textContent=e.message;
    document.getElementById('error').style.display='block';
  }
}

function render(d){
  document.getElementById('stats').innerHTML=
    '<div class="stat-card"><div class="label">Requests</div><div class="value">'+fmt(d.overview.totalRequests)+'</div></div>'+
    '<div class="stat-card"><div class="label">Total Tokens</div><div class="value">'+fmt(d.overview.totalTokens)+'</div><div class="sub">Prompt: '+fmt(d.overview.totalPromptTokens)+' | Completion: '+fmt(d.overview.totalCompletionTokens)+'</div></div>'+
    '<div class="stat-card"><div class="label">Cost</div><div class="value">'+fmt$(d.overview.totalCost)+'</div></div>'+
    '<div class="stat-card"><div class="label">Avg Latency</div><div class="value">'+fmtMs(d.overview.avgLatencyMs)+'</div></div>'+
    '<div class="stat-card"><div class="label">Success Rate</div><div class="value">'+fmtPct(d.overview.successRate)+'</div></div>'+
    '<div class="stat-card"><div class="label">Active Models</div><div class="value">'+d.overview.activeModels+'</div><div class="sub">Subs: '+d.overview.activeSubscriptions+'</div></div>';

  var tl=d.timeline||[];
  _charts.push(new Chart(document.getElementById('timelineChart'),{type:'line',options:{responsive:true,plugins:{legend:{display:false}}},data:{labels:tl.map(function(p){return p.timestamp}),datasets:[
    {label:'Tokens',data:tl.map(function(p){return p.tokens}),borderColor:'#58a6ff',backgroundColor:'transparent',tension:0.2},
    {label:'Cost',data:tl.map(function(p){return p.cost}),borderColor:'#3fb950',backgroundColor:'transparent',tension:0.2,yAxisID:'y1'}
  ]}}));

  var hm=d.heatmap||[];
  var dayOrder=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  var hours=Array.from({length:24},function(_,i){return i});
  var hmData=hours.map(function(h){
    return dayOrder.map(function(day){
      var found=hm.find(function(x){return x.hour===h&&x.day===day});
      return found?found.tokens:0;
    });
  });
  _charts.push(new Chart(document.getElementById('heatmapChart'),{type:'bar',options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{stacked:true}}},data:{labels:hours,datasets:dayOrder.map(function(day,i){return{label:day,data:hmData.map(function(r){return r[i]}),backgroundColor:['#58a6ff','#3fb950','#d2991d','#db6d28','#a371f7','#f85149','#8b949e'][i]}})}}));

  var md=d.modelBreakdown||[];
  _charts.push(new Chart(document.getElementById('modelChart'),{type:'doughnut',options:{responsive:true},data:{labels:md.map(function(m){return m.model}),datasets:[{data:md.map(function(m){return m.totalTokens}),backgroundColor:['#58a6ff','#3fb950','#d2991d','#db6d28','#a371f7','#f85149','#8b949e','#79c0ff','#56d364']}]}}));

  var tc=d.topConsumers||[];
  _charts.push(new Chart(document.getElementById('consumerChart'),{type:'bar',options:{responsive:true,indexAxis:'y',plugins:{legend:{display:false}}},data:{labels:tc.map(function(c){return c.name}),datasets:[{label:'Tokens',data:tc.map(function(c){return c.tokens}),backgroundColor:tc.map(function(c){return c.trend==='up'?'#da3633':c.trend==='down'?'#3fb950':'#8b949e'})}]}}));

  var mt=document.getElementById('modelTable');
  mt.innerHTML='<tr><th>Model</th><th>Requests</th><th>Tokens</th><th>Cost</th><th>Latency</th><th>Share</th></tr>';
  (d.modelBreakdown||[]).slice(0,10).forEach(function(m){
    mt.insertAdjacentHTML('beforeend','<tr><td>'+m.model+'</td><td>'+fmt(m.requests)+'</td><td>'+fmt(m.totalTokens)+'</td><td>'+fmt$(m.cost)+'</td><td>'+fmtMs(m.avgLatencyMs)+'</td><td>'+fmtPct(m.percentage)+'</td></tr>');
  });

  var at=document.getElementById('agentTable');
  at.innerHTML='<tr><th>Agent</th><th>Requests</th><th>Tokens</th><th>Cost</th><th>Top Model</th></tr>';
  (d.agentBreakdown||[]).slice(0,10).forEach(function(a){
    at.insertAdjacentHTML('beforeend','<tr><td>'+a.agent+'</td><td>'+fmt(a.requests)+'</td><td>'+fmt(a.totalTokens)+'</td><td>'+fmt$(a.cost)+'</td><td>'+a.topModel+'</td></tr>');
  });
}

refresh();
setInterval(refresh,30000);
<\/script>
</body>
</html>`;

function serveStaticFile(filePath: string): Response {
  if (!existsSync(filePath)) return new Response("Not found", { status: 404 });

  const content = readFileSync(filePath);
  const mimeType = getMimeType(filePath);

  return new Response(content, {
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function serveDashboard(
  dbPath?: string,
  port?: number,
): Promise<{ apiHandler: (req: Request) => Response }> {
  const listenPort = port ?? 8788;
  const frontendDist = resolve(process.cwd(), "frontend", "dist");
  const hasBuild = existsSync(frontendDist) && existsSync(join(frontendDist, "index.html"));

  const apiHandler = await createApiHandlerFromPath(dbPath);

  Bun.serve({
    port: listenPort,
    fetch(req): Response {
      const url = new URL(req.url);
      const pathname = url.pathname;

      if (pathname.startsWith("/api/")) {
        return apiHandler(req);
      }

      if (hasBuild) {
        const filePath = join(frontendDist, pathname === "/" ? "index.html" : pathname);

        if (existsSync(filePath) && !filePath.endsWith("/")) {
          return serveStaticFile(filePath);
        }

        return serveStaticFile(join(frontendDist, "index.html"));
      }

      return new Response(INLINE_DASHBOARD, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });

  return { apiHandler };
}
