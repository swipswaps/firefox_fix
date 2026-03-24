import * as React from "react";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Activity, Terminal, Shield, AlertTriangle, RefreshCw, BarChart3, WifiOff, Cpu, HardDrive, Layers, Zap, Search, Pause, Play, ChevronsDown, TrendingUp, TrendingDown, Minus, X, Server } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import * as d3 from "d3";
import { Toaster, toast } from "sonner";

// Error Boundary Component
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class MyErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0A0A0B] text-white flex items-center justify-center p-6 font-mono">
          <div className="text-center space-y-6 max-w-md hardware-card p-12">
            <div className="scanline" />
            <AlertTriangle size={48} className="mx-auto text-red-500" />
            <h1 className="text-2xl font-black uppercase tracking-tighter">Critical System Fault</h1>
            <p className="opacity-50 text-xs uppercase tracking-widest leading-relaxed">
              A fatal exception has occurred in the UI layer. Kernel integrity remains intact. 
              Please re-initialize the interface.
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-[#F27D26] text-black font-black uppercase text-[10px] tracking-[0.3em] rounded-sm hover:brightness-110 transition-all"
            >
              Re-Initialize System
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Shared types ─────────────────────────────────────────────────────────────

interface ThreadInfo {
  pid: string;
  tid: string;
  cpu: number;
  memMB: number;
  status: string;
}

interface CycleData {
  timestamp: string | null;
  systemLoad: { one: number; five: number; fifteen: number };
  memUsedMB: number;
  memTotalMB: number;
  memPercent: number;
  threads: ThreadInfo[];
}

interface LoadPoint  { timestamp: string; one: number; five: number; fifteen: number }
interface MemPoint   { timestamp: string; percent: number; usedMB: number }
interface MetricPoint { timestamp: string; optimized: number; active: number; totalCpu: number; totalMem: number }

// ─── Thread Table ─────────────────────────────────────────────────────────────

function ThreadTable({ threads, cycleTs }: { threads: ThreadInfo[]; cycleTs: string | null }) {
  const sorted = useMemo(() => [...threads].sort((a, b) => b.cpu - a.cpu), [threads]);

  const statusCls = (s: string) => {
    if (s === 'THROTTLED') return 'text-orange-400 bg-orange-400/10 border border-orange-400/30';
    if (s === 'OPTIMIZED') return 'text-red-400 bg-red-400/10 border border-red-400/30';
    return 'text-green-400/80 bg-green-400/5 border border-green-400/20';
  };
  const cpuCls  = (c: number) => c > 15 ? 'text-orange-400 font-bold' : c > 5 ? 'text-yellow-400' : 'text-green-400';
  const cpuBar  = (c: number) => c > 15 ? 'bg-orange-400' : c > 5 ? 'bg-yellow-400' : 'bg-green-400/60';

  return (
    <div className="hardware-card overflow-hidden flex flex-col">
      <div className="px-4 py-2 border-b border-white/5 bg-white/[0.02] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Server size={12} className="text-[#8E9299]" />
          <span className="hardware-label">Thread Map</span>
          {cycleTs && <span className="hardware-label !text-[8px] opacity-30">{cycleTs}</span>}
        </div>
        <span className="hardware-label !text-[8px] opacity-30">{threads.length} threads</span>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: '280px' }}>
        <table className="w-full font-mono text-[10px] border-collapse">
          <thead className="sticky top-0 bg-[#151619] z-10">
            <tr className="border-b border-white/5 text-white/25 text-[8px] uppercase tracking-widest">
              <th className="text-left px-3 py-2 font-bold">Status</th>
              <th className="text-left px-3 py-2 font-bold">PID</th>
              <th className="text-left px-3 py-2 font-bold">TID</th>
              <th className="text-right px-3 py-2 font-bold">CPU%</th>
              <th className="text-right px-3 py-2 font-bold">MEM</th>
              <th className="px-3 py-2 font-bold w-28">Load</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-white/20 hardware-label !text-[9px]">No Firefox content threads detected</td></tr>
            ) : sorted.map((t, i) => (
              <tr key={`${t.pid}-${t.tid}-${i}`} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                <td className="px-3 py-1.5">
                  <span className={`px-1.5 py-0.5 rounded-sm text-[7px] font-bold uppercase tracking-wider ${statusCls(t.status)}`}>{t.status}</span>
                </td>
                <td className="px-3 py-1.5 text-white/50">{t.pid}</td>
                <td className="px-3 py-1.5 text-white/30">{t.tid === t.pid ? '(main)' : t.tid}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${cpuCls(t.cpu)}`}>{t.cpu.toFixed(1)}%</td>
                <td className="px-3 py-1.5 text-right text-white/40 tabular-nums">
                  {t.memMB >= 1024 ? (t.memMB / 1024).toFixed(1) + ' GB' : t.memMB + ' MB'}
                </td>
                <td className="px-3 py-1.5">
                  <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${cpuBar(t.cpu)}`}
                      style={{ width: `${Math.min(t.cpu * 1.4, 100)}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── D3 Chart Component ───────────────────────────────────────────────────────

// D3 Chart Component
function LiveMetricsChart({ data }: { data: MetricPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length < 2) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    const margin = { top: 10, right: 10, bottom: 20, left: 30 };

    svg.selectAll("*").remove();

    const x = d3.scaleTime()
      .domain(d3.extent(data, d => new Date(d.timestamp)) as [Date, Date])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => Math.max(d.optimized, d.active)) || 10])
      .nice()
      .range([height - margin.bottom, margin.top]);

    // Area for Optimized
    const areaOptimized = d3.area<any>()
      .x(d => x(new Date(d.timestamp)))
      .y0(height - margin.bottom)
      .y1(d => y(d.optimized))
      .curve(d3.curveMonotoneX);

    svg.append("path")
      .datum(data)
      .attr("fill", "rgba(242, 125, 38, 0.1)")
      .attr("d", areaOptimized);

    // Lines
    const lineOptimized = d3.line<any>()
      .x(d => x(new Date(d.timestamp)))
      .y(d => y(d.optimized))
      .curve(d3.curveMonotoneX);

    const lineActive = d3.line<any>()
      .x(d => x(new Date(d.timestamp)))
      .y(d => y(d.active))
      .curve(d3.curveMonotoneX);

    // Grid lines
    svg.append("g")
      .attr("class", "grid")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(5).tickSize(-height + margin.top + margin.bottom).tickFormat("" as any))
      .attr("stroke-opacity", 0.05)
      .attr("color", "#fff");

    svg.append("g")
      .attr("class", "grid")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-width + margin.left + margin.right).tickFormat("" as any))
      .attr("stroke-opacity", 0.05)
      .attr("color", "#fff");

    // Axes
    svg.append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(3).tickFormat(d3.timeFormat("%H:%M") as any))
      .attr("color", "rgba(255,255,255,0.1)")
      .attr("font-family", "JetBrains Mono")
      .attr("font-size", "8px");

    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(3))
      .attr("color", "rgba(255,255,255,0.1)")
      .attr("font-family", "JetBrains Mono")
      .attr("font-size", "8px");

    svg.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", "#F27D26")
      .attr("stroke-width", 1.5)
      .attr("d", lineOptimized);

    svg.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", "#4ade80")
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "4,2")
      .attr("d", lineActive);

  }, [data]);

  return <svg ref={svgRef} className="w-full h-full" />;
}

// System Load D3 chart (1m / 5m / 15m averages over time)
function SystemLoadChart({ data }: { data: LoadPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!svgRef.current || data.length < 2) return;
    const svg = d3.select(svgRef.current);
    const W = svgRef.current.clientWidth, H = svgRef.current.clientHeight;
    const m = { top: 6, right: 8, bottom: 18, left: 28 };
    svg.selectAll("*").remove();

    const x = d3.scaleTime().domain(d3.extent(data, d => new Date(d.timestamp)) as [Date,Date]).range([m.left, W - m.right]);
    const maxLoad = Math.max(d3.max(data, d => d.one) ?? 1, 1);
    const y = d3.scaleLinear().domain([0, maxLoad * 1.1]).nice().range([H - m.bottom, m.top]);

    const mkLine = (key: keyof LoadPoint) => d3.line<LoadPoint>().x(d => x(new Date(d.timestamp))).y(d => y(d[key] as number)).curve(d3.curveMonotoneX);

    svg.append("g").attr("transform", `translate(0,${H-m.bottom})`).call(d3.axisBottom(x).ticks(3).tickFormat(d3.timeFormat("%H:%M") as any)).attr("color","rgba(255,255,255,0.1)").attr("font-size","7px").attr("font-family","JetBrains Mono");
    svg.append("g").attr("transform", `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(3)).attr("color","rgba(255,255,255,0.1)").attr("font-size","7px").attr("font-family","JetBrains Mono");

    const strokes: Array<[keyof LoadPoint, string, string]> = [["one","#F27D26",""], ["five","#facc15","4,2"], ["fifteen","#4ade80","2,4"]];
    strokes.forEach(([k, stroke, dash]) => {
      svg.append("path").datum(data).attr("fill","none").attr("stroke",stroke).attr("stroke-width",1.5).attr("stroke-dasharray",dash).attr("d", mkLine(k));
    });
  }, [data]);
  return <svg ref={svgRef} className="w-full h-full" />;
}

// Memory % trend D3 chart
function MemTrendChart({ data }: { data: MemPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!svgRef.current || data.length < 2) return;
    const svg = d3.select(svgRef.current);
    const W = svgRef.current.clientWidth, H = svgRef.current.clientHeight;
    const m = { top: 6, right: 8, bottom: 18, left: 28 };
    svg.selectAll("*").remove();

    const x = d3.scaleTime().domain(d3.extent(data, d => new Date(d.timestamp)) as [Date,Date]).range([m.left, W - m.right]);
    const y = d3.scaleLinear().domain([0, 100]).range([H - m.bottom, m.top]);

    const area = d3.area<MemPoint>().x(d => x(new Date(d.timestamp))).y0(H - m.bottom).y1(d => y(d.percent)).curve(d3.curveMonotoneX);
    const line = d3.line<MemPoint>().x(d => x(new Date(d.timestamp))).y(d => y(d.percent)).curve(d3.curveMonotoneX);

    svg.append("g").attr("transform", `translate(0,${H-m.bottom})`).call(d3.axisBottom(x).ticks(3).tickFormat(d3.timeFormat("%H:%M") as any)).attr("color","rgba(255,255,255,0.1)").attr("font-size","7px").attr("font-family","JetBrains Mono");
    svg.append("g").attr("transform", `translate(${m.left},0)`).call(d3.axisLeft(y).ticks(3).tickFormat(v => `${v}%`)).attr("color","rgba(255,255,255,0.1)").attr("font-size","7px").attr("font-family","JetBrains Mono");

    // Colour red when > 85%, orange > 70%
    const lastPct = data[data.length - 1]?.percent ?? 0;
    const colour = lastPct > 85 ? '#ef4444' : lastPct > 70 ? '#F27D26' : '#4ade80';
    svg.append("path").datum(data).attr("fill", colour + "18").attr("d", area);
    svg.append("path").datum(data).attr("fill","none").attr("stroke",colour).attr("stroke-width",1.5).attr("d",line);
  }, [data]);
  return <svg ref={svgRef} className="w-full h-full" />;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AppWrapper() {
  return (
    <MyErrorBoundary>
      <Toaster theme="dark" position="bottom-right" />
      <App />
    </MyErrorBoundary>
  );
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [metricsHistory, setMetricsHistory] = useState<MetricPoint[]>([]);
  const [totalThrottled, setTotalThrottled] = useState(0);
  const [isOffline, setIsOffline] = useState(false);
  const [displayedLogs, setDisplayedLogs] = useState<string[]>([]);
  const [logFilter, setLogFilter] = useState<'all'|'throttled'|'optimized'|'system'>('all');
  const [logSearch, setLogSearch] = useState('');
  const [logPaused, setLogPaused] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  // Structured per-cycle data
  const [cycleData, setCycleData] = useState<CycleData | null>(null);
  const [loadHistory, setLoadHistory] = useState<LoadPoint[]>([]);
  const [memHistory, setMemHistory] = useState<MemPoint[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);
  const lastOptimizedCount = useRef(0);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "include",
      });
      if (res.ok) {
        setIsLoggedIn(true);
        toast.success("Access Granted", { description: "Kernel link established." });
      } else {
        toast.error("Access Denied", { description: "Invalid system credentials." });
      }
    } catch {
      toast.error("Login Error");
    }
  }, [password]);

  const handleLogout = useCallback(async () => {
    await fetch("/api/logout", { method: "POST" });
    setIsLoggedIn(false);
    window.location.reload();
  }, []);

  const fetchLogs = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const res = await fetch("/api/logs", { credentials: "include" });
      if (res.status === 401) { setIsLoggedIn(false); return; }
      if (!res.ok) throw new Error("Log fetch failed");
      const data = await res.json();
      setLogs(data.lines);
      setIsOffline(false);
    } catch (err) {
      console.error("Failed to fetch logs", err);
      setIsOffline(true);
    }
  }, [isLoggedIn]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { credentials: "include" });
      if (res.status === 401) { setIsLoggedIn(false); return; }
      if (!res.ok) throw new Error("Status fetch failed");
      const data = await res.json();
      setStatus(data);
      setIsLoggedIn(true);
    } catch (err) {
      console.error("Failed to fetch status", err);
      if (isLoggedIn === null) setIsLoggedIn(false);
    }
  }, [isLoggedIn]);

  const updateConfig = useCallback(async (newConfig: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newConfig),
        credentials: "include",
      });
      const data = await res.json();
      toast.success("Configuration Updated", { description: data.status });
      fetchStatus();
    } catch {
      toast.error("Failed to update configuration");
    }
  }, [fetchStatus]);

  const downloadReport = useCallback(async () => {
    try {
      const res = await fetch("/api/report", { credentials: "include" });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `forensic_report_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success("Forensic Report Generated");
    } catch {
      toast.error("Failed to generate report");
    }
  }, []);

  const fetchMetrics = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const res = await fetch("/api/metrics", { credentials: "include" });
      if (res.status === 401) { setIsLoggedIn(false); return; }
      if (!res.ok) throw new Error("Metrics fetch failed");
      const data = await res.json();

      setMetricsHistory(prev => {
        if (prev.length > 0 && prev[prev.length - 1].timestamp === data.timestamp) return prev;
        if (data.optimized > lastOptimizedCount.current) {
          const diff = data.optimized - lastOptimizedCount.current;
          setTotalThrottled(t => t + diff);
          toast.success(`Optimization Event`, {
            description: `Throttled ${diff} heavy Firefox thread(s).`,
            icon: <Zap size={14} className="text-[#F27D26]" />,
          });
        }
        lastOptimizedCount.current = data.optimized;
        return [...prev.slice(-29), data];
      });
    } catch (err) {
      console.error("Failed to fetch metrics", err);
    }
  }, [isLoggedIn]);

  const fetchThreads = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const res = await fetch("/api/threads", { credentials: "include" });
      if (res.status === 401) { setIsLoggedIn(false); return; }
      if (!res.ok) return;
      const data: CycleData = await res.json();
      setCycleData(data);
      if (data.timestamp) {
        const ts = data.timestamp;
        setLoadHistory(prev => {
          const last = prev[prev.length - 1];
          if (last?.timestamp === ts) return prev;
          return [...prev.slice(-59), { timestamp: ts, one: data.systemLoad.one, five: data.systemLoad.five, fifteen: data.systemLoad.fifteen }];
        });
        setMemHistory(prev => {
          const last = prev[prev.length - 1];
          if (last?.timestamp === ts) return prev;
          return [...prev.slice(-59), { timestamp: ts, percent: data.memPercent, usedMB: data.memUsedMB }];
        });
      }
    } catch (err) {
      console.error("Failed to fetch threads", err);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    fetchStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    fetchLogs();
    fetchThreads();
    const interval = setInterval(() => {
      fetchLogs();
      fetchStatus();
      fetchMetrics();
      fetchThreads();
    }, 2000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  // Freeze displayed log when paused; catch up immediately on resume
  useEffect(() => {
    if (!logPaused) setDisplayedLogs(logs);
  }, [logs, logPaused]);

  // Track whether user is near the bottom of the log container
  useEffect(() => {
    const el = logContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      isAtBottom.current = dist < 120;
      setShowJumpToBottom(dist > 240);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [isLoggedIn]);

  // Auto-scroll: direct scrollTop assignment (no smooth animation) to prevent jitter every 2s
  useEffect(() => {
    const el = logContainerRef.current;
    if (el && isAtBottom.current && !logPaused) {
      el.scrollTop = el.scrollHeight;
    }
  }, [displayedLogs, logPaused]);

  const latestMetrics = useMemo(() => metricsHistory[metricsHistory.length - 1], [metricsHistory]);
  const prevMetrics   = useMemo(() => metricsHistory[metricsHistory.length - 2], [metricsHistory]);
  const cpuTrend      = useMemo(() =>
    latestMetrics && prevMetrics ? latestMetrics.totalCpu - prevMetrics.totalCpu : 0,
    [latestMetrics, prevMetrics]);

  const filteredLogs = useMemo(() =>
    displayedLogs
      .filter(line => !line.includes("METRICS |"))
      .filter(line => {
        if (logFilter === 'throttled') return line.includes("THROTTLED");
        if (logFilter === 'optimized') return line.includes("OPTIMIZED") || line.includes("THROTTLED");
        if (logFilter === 'system')    return line.includes("SYSTEM:") || line.includes("Timestamp:")
                                          || line.includes("Cycle complete") || line.includes("Starting Firefox");
        return true;
      })
      .filter(line => !logSearch || line.toLowerCase().includes(logSearch.toLowerCase())),
    [displayedLogs, logFilter, logSearch]);

  // Loading state while session check is in flight
  if (isLoggedIn === null) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 opacity-40">
          <RefreshCw size={28} className="animate-spin text-[#F27D26]" />
          <span className="hardware-label !text-[9px]">Establishing Link…</span>
        </div>
      </div>
    );
  }

  if (isLoggedIn === false) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] text-white flex items-center justify-center p-6 font-sans selection:bg-[#F27D26] selection:text-black">
        <div className="fixed inset-0 grid-pattern opacity-20 pointer-events-none" />
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md hardware-card p-12 space-y-8 relative overflow-hidden"
        >
          <div className="scanline" />
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-black uppercase tracking-tighter leading-none">
              Firefox<br />
              <span className="text-[#F27D26]">Optimizer</span>
            </h1>
            <p className="hardware-label !text-[10px] opacity-40 uppercase tracking-widest">
              Restricted Kernel Access
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="hardware-label !text-[10px] opacity-60">System Password</label>
              <input 
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-sm p-4 font-mono text-center tracking-[0.5em] focus:outline-none focus:border-[#F27D26]/50 transition-colors"
                placeholder="••••••••"
              />
            </div>
            <button 
              type="submit"
              className="w-full py-4 bg-[#F27D26] text-black font-black uppercase text-[12px] tracking-[0.3em] rounded-sm hover:brightness-110 transition-all flex items-center justify-center gap-2"
            >
              <Shield size={16} /> Establish Link
            </button>
          </form>

          <div className="pt-8 border-t border-white/5 flex justify-center gap-4 opacity-20">
            <div className="w-1.5 h-1.5 rounded-full bg-white" />
            <div className="w-1.5 h-1.5 rounded-full bg-white" />
            <div className="w-1.5 h-1.5 rounded-full bg-white" />
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white font-sans selection:bg-[#F27D26] selection:text-black">
      <div className="fixed inset-0 grid-pattern opacity-20 pointer-events-none" />
      
      {/* Top Navigation / Status Bar */}
      <nav className="border-b border-white/5 bg-[#0A0A0B]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-[#F27D26]" />
              <span className="font-mono text-[11px] font-black uppercase tracking-[0.3em]">FX-OPT-v2.5</span>
            </div>
            <div className="h-4 w-[1px] bg-white/10" />
            <div className="flex items-center gap-2">
              <div className={`status-pulse ${status?.optimizer === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="hardware-label !text-[9px]">
                {status?.optimizer === 'active' ? 'Kernel Active' : 'Kernel Halted'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <AnimatePresence>
              {isOffline && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-2 text-red-500 font-mono text-[9px] font-bold uppercase tracking-widest"
                >
                  <WifiOff size={12} />
                  Link Severed
                </motion.div>
              )}
            </AnimatePresence>
            <div className="hardware-label !text-[9px] opacity-40">
              {status?.lastUpdate ? new Date(status.lastUpdate).toLocaleTimeString() : '00:00:00'}
            </div>
            <button 
              onClick={handleLogout}
              className="hardware-label !text-[9px] hover:text-red-500 transition-colors uppercase tracking-widest opacity-40 hover:opacity-100"
            >
              Log Out
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-[1600px] mx-auto p-6 md:p-8 grid grid-cols-12 gap-6">
        
        {/* Left Sidebar: System Identity */}
        <div className="col-span-12 lg:col-span-3 space-y-6">
          <div className="space-y-1">
            <h1 className="text-5xl font-black uppercase tracking-tighter leading-[0.8] mb-2">
              Firefox<br />
              <span className="text-[#F27D26]">Optimizer</span>
            </h1>
            <p className="hardware-label !text-[10px] opacity-50 max-w-[200px]">
              Real-time kernel-level priority adjustment for multi-threaded content processes.
            </p>
          </div>

          <div className="hardware-card p-4 bg-white/[0.02] border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 hardware-label !text-[8px]">
                <Shield size={10} className="text-[#F27D26]" /> Sudo Status
              </div>
              <div className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest ${status?.sudoStatus === 'acquired' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                {status?.sudoStatus || 'Checking...'}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 hardware-label !text-[8px]">
                <Zap size={10} className="text-[#F27D26]" /> Total Throttled
              </div>
              <div className="text-[10px] font-mono font-bold text-[#F27D26]">
                {totalThrottled}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 hardware-label !text-[8px]">
                <RefreshCw size={10} className="text-[#F27D26]" /> Last Cycle
              </div>
              <div className="text-[8px] font-mono opacity-40">
                {status?.lastUpdate ? new Date(status.lastUpdate).toLocaleTimeString() : '--:--:--'}
              </div>
            </div>
          </div>

          <div className="hardware-card p-6 space-y-8">
            <div className="scanline" />
            
            <div className="space-y-6">
              <div className="group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 hardware-label">
                    <Cpu size={12} /> CPU Threshold
                  </div>
                  <div className="text-[10px] font-mono opacity-30">AUTO</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="hardware-value text-3xl group-hover:text-[#F27D26] transition-colors">
                    {status?.config?.optimizeThreshold?.toFixed(1) || '5.0'}%
                  </div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="50" 
                    step="0.5"
                    value={status?.config?.optimizeThreshold || 5.0}
                    onChange={(e) => updateConfig({ optimizeThreshold: e.target.value })}
                    className="flex-1 accent-[#F27D26] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>

              <div className="group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 hardware-label">
                    <Layers size={12} /> Nice Priority
                  </div>
                  <div className="text-[10px] font-mono opacity-30">STATIC</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="hardware-value text-3xl group-hover:text-[#F27D26] transition-colors">
                    +{status?.config?.reniceVal || '5'}
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="19" 
                    step="1"
                    value={status?.config?.reniceVal || 5}
                    onChange={(e) => updateConfig({ reniceVal: e.target.value })}
                    className="flex-1 accent-[#F27D26] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>

              <div className="group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 hardware-label">
                    <Activity size={12} /> Interval (s)
                  </div>
                  <div className="text-[10px] font-mono opacity-30">POLL</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="hardware-value text-3xl group-hover:text-[#F27D26] transition-colors">
                    {status?.config?.monitorInterval || '2'}s
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="10" 
                    step="1"
                    value={status?.config?.monitorInterval || 2}
                    onChange={(e) => updateConfig({ monitorInterval: e.target.value })}
                    className="flex-1 accent-[#F27D26] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-white/5">
              <div className="flex items-center gap-3 hardware-label mb-4">
                <BarChart3 size={12} /> Activity Delta
              </div>
              <div className="h-[120px] w-full">
                <LiveMetricsChart data={metricsHistory} />
              </div>
              <div className="mt-4 flex justify-between hardware-label !text-[8px] opacity-40">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#F27D26]" /> Optimized
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#4ade80] border border-white/20 border-dashed" /> Active
                </div>
              </div>
            </div>
          </div>

          <div className="hardware-card p-6 space-y-6">
            <div className="flex items-center gap-2 hardware-label mb-2">
              <Shield size={12} /> System Control
            </div>
            
            <div className="space-y-4">
              <button 
                onClick={downloadReport}
                className="w-full p-3 rounded border border-blue-500/30 bg-blue-500/5 text-blue-500 hover:bg-blue-500/10 transition-all flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider"
              >
                <BarChart3 size={14} /> Generate Report
              </button>

              <button 
                onClick={async () => {
                  const res = await fetch('/api/forensic/toggle', { 
                    method: 'POST',
                    credentials: 'include'
                  });
                  const data = await res.json();
                  toast.info(`Forensic Mode ${data.forensicMode ? 'Enabled' : 'Disabled'}`, {
                    description: data.forensicMode ? 'Deep thread analysis active.' : 'Standard monitoring active.'
                  });
                  fetchStatus();
                }}
                className={`w-full p-3 rounded border flex items-center justify-between transition-all ${status?.forensicMode ? 'bg-[#F27D26]/20 border-[#F27D26] text-[#F27D26]' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}
              >
                <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider">
                  <Search size={14} /> Forensic Audit
                </div>
                <div className={`w-2 h-2 rounded-full ${status?.forensicMode ? 'bg-[#F27D26] animate-pulse' : 'bg-white/20'}`} />
              </button>

              <button 
                onClick={async () => {
                  toast.loading('Initiating system recovery...', { id: 'recovery' });
                  try {
                    const res = await fetch('/api/recover', { credentials: 'include' });
                    const data = await res.json();
                    toast.success('Recovery Successful', { 
                      id: 'recovery',
                      description: data.status 
                    });
                    setTimeout(() => window.location.reload(), 2000);
                  } catch (err) {
                    toast.error('Recovery Failed', { id: 'recovery' });
                  }
                }}
                className="w-full p-3 rounded border border-red-500/30 bg-red-500/5 text-red-500 hover:bg-red-500/10 transition-all flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider"
              >
                <RefreshCw size={14} /> Emergency Recovery
              </button>
            </div>
          </div>

          <div className="hardware-card p-6 bg-[#F27D26]/5 border-[#F27D26]/20 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 hardware-label !text-[#F27D26]">
                <Zap size={12} className="animate-pulse" /> Live Metrics
              </div>
              {/* CPU trend indicator */}
              <div className={`flex items-center gap-1 text-[9px] font-mono font-bold ${
                cpuTrend > 1 ? 'text-red-400' : cpuTrend < -1 ? 'text-green-400' : 'text-white/30'
              }`}>
                {cpuTrend > 1 ? <TrendingUp size={11} /> : cpuTrend < -1 ? <TrendingDown size={11} /> : <Minus size={11} />}
                {cpuTrend > 0 ? '+' : ''}{cpuTrend.toFixed(1)}%
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-0.5">
                <div className="hardware-label !text-[8px] opacity-50">Total CPU Load</div>
                <div className="hardware-value text-2xl">{latestMetrics?.totalCpu?.toFixed(1) ?? '0.0'}%</div>
              </div>
              <div className="space-y-0.5">
                <div className="hardware-label !text-[8px] opacity-50">RSS Footprint</div>
                <div className="hardware-value text-2xl">
                  {latestMetrics ? (latestMetrics.totalMem >= 1024
                    ? (latestMetrics.totalMem / 1024).toFixed(1) + ' GB'
                    : latestMetrics.totalMem + ' MB')
                  : '0 MB'}
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="hardware-label !text-[8px] opacity-50">Active Threads</div>
                <div className="hardware-value text-2xl text-green-400">{latestMetrics?.active ?? '—'}</div>
              </div>
              <div className="space-y-0.5">
                <div className="hardware-label !text-[8px] opacity-50">Throttled This Cycle</div>
                <div className="hardware-value text-2xl text-orange-400">{latestMetrics?.optimized ?? '—'}</div>
              </div>
            </div>

            <div className="border-t border-white/5 pt-3 space-y-1.5">
              <div className="hardware-label !text-[8px] opacity-40">Session totals</div>
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-white/40">Throttle events</span>
                <span className="text-orange-400 font-bold">{totalThrottled}</span>
              </div>
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-white/40">Samples collected</span>
                <span className="text-white/60">{metricsHistory.length}</span>
              </div>
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-white/40">Peak CPU</span>
                <span className="text-white/60">
                  {metricsHistory.length > 0
                    ? Math.max(...metricsHistory.map(m => m.totalCpu)).toFixed(1) + '%'
                    : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Center/Right: Visualization + Logs */}
        <div className="col-span-12 lg:col-span-9 space-y-4">

          {/* ── Stats Bar ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "1-min Load", icon: <Activity size={11}/>, value: cycleData?.systemLoad.one?.toFixed(2) ?? '—', sub: `5m ${cycleData?.systemLoad.five?.toFixed(1)??'—'} · 15m ${cycleData?.systemLoad.fifteen?.toFixed(1)??'—'}`, danger: (cycleData?.systemLoad.one ?? 0) > 8 },
              { label: "Memory", icon: <HardDrive size={11}/>, value: cycleData ? `${cycleData.memPercent.toFixed(1)}%` : '—', sub: cycleData ? `${cycleData.memUsedMB} MB / ${cycleData.memTotalMB} MB` : '—', danger: (cycleData?.memPercent ?? 0) > 85 },
              { label: "Active Threads", icon: <Cpu size={11}/>, value: String(cycleData?.threads.length ?? '—'), sub: `PIDs: ${cycleData ? [...new Set(cycleData.threads.map(t=>t.pid))].length : '—'}`, danger: false },
              { label: "Throttled/Opt", icon: <Zap size={11}/>, value: String(cycleData?.threads.filter(t=>t.status!=='Active').length ?? '—'), sub: `Peak CPU: ${cycleData && cycleData.threads.length ? Math.max(...cycleData.threads.map(t=>t.cpu)).toFixed(1)+'%' : '—'}`, danger: (cycleData?.threads.filter(t=>t.status==='THROTTLED').length ?? 0) > 0 },
            ].map(({ label, icon, value, sub, danger }) => (
              <div key={label} className={`hardware-card p-4 ${danger ? 'border-orange-500/30' : ''}`}>
                <div className="flex items-center gap-1.5 hardware-label !text-[8px] opacity-50 mb-1.5">{icon}{label}</div>
                <div className={`hardware-value text-2xl ${danger ? 'text-orange-400' : 'text-white'}`}>{value}</div>
                <div className="hardware-label !text-[8px] opacity-30 mt-1 truncate">{sub}</div>
              </div>
            ))}
          </div>

          {/* ── Thread Table + Charts ── */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <ThreadTable threads={cycleData?.threads ?? []} cycleTs={cycleData?.timestamp ?? null} />
            </div>
            <div className="space-y-4">
              <div className="hardware-card p-4">
                <div className="hardware-label !text-[8px] mb-2 flex items-center gap-1.5 opacity-60"><Activity size={10}/>System Load (1m · 5m · 15m)</div>
                <div className="h-[120px]"><SystemLoadChart data={loadHistory} /></div>
                <div className="mt-2 flex gap-3 hardware-label !text-[7px] opacity-30">
                  <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-[#F27D26] inline-block"/>1m</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-yellow-400 inline-block" style={{borderTop:'2px dashed'}}/>5m</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-green-400 inline-block"/>15m</span>
                </div>
              </div>
              <div className="hardware-card p-4">
                <div className="hardware-label !text-[8px] mb-2 flex items-center gap-1.5 opacity-60"><HardDrive size={10}/>Memory Usage %</div>
                <div className="h-[120px]"><MemTrendChart data={memHistory} /></div>
              </div>
            </div>
          </div>

          {/* ── Log Panel ── */}
          <div className="hardware-card flex flex-col" style={{ height: 'calc(100vh - 560px)', minHeight: '360px' }}>
            <div className="scanline" />

            {/* Log panel header */}
            <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Terminal size={14} className="text-[#8E9299]" />
                  <span className="hardware-label">System Audit Trail</span>
                  <span className="hardware-label !text-[8px] opacity-30">{filteredLogs.length} lines</span>
                </div>
                <div className="flex items-center gap-2">
                  {logPaused && (
                    <span className="hardware-label !text-[8px] text-yellow-400 animate-pulse">PAUSED</span>
                  )}
                  <button
                    onClick={() => setLogPaused(p => !p)}
                    title={logPaused ? "Resume live feed" : "Pause log updates"}
                    className={`p-1.5 rounded transition-colors ${logPaused ? 'text-yellow-400 bg-yellow-400/10' : 'text-white/30 hover:text-white/70'}`}
                  >
                    {logPaused ? <Play size={12} /> : <Pause size={12} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {(['all','throttled','optimized','system'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setLogFilter(f)}
                    className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider transition-colors ${
                      logFilter === f
                        ? f === 'throttled' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40'
                        : f === 'optimized' ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                        : f === 'system'    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                        : 'bg-white/10 text-white border border-white/20'
                        : 'text-white/30 hover:text-white/60 border border-transparent'
                    }`}
                  >
                    {f}
                  </button>
                ))}
                <div className="flex-1 flex items-center gap-1.5 bg-white/5 border border-white/10 rounded px-2 py-0.5 min-w-[120px] max-w-[220px]">
                  <Search size={10} className="text-white/30 shrink-0" />
                  <input
                    type="text"
                    value={logSearch}
                    onChange={e => setLogSearch(e.target.value)}
                    placeholder="filter text…"
                    className="bg-transparent text-[10px] font-mono text-white/70 placeholder:text-white/20 outline-none w-full"
                  />
                  {logSearch && (
                    <button onClick={() => setLogSearch('')} title="Clear search" className="text-white/30 hover:text-white/70 shrink-0">
                      <X size={10} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Log body — plain divs (no AnimatePresence) to prevent 100-line re-animation every 2s */}
            <div
              ref={logContainerRef}
              className="relative flex-1 overflow-y-auto p-6 font-mono text-[12px] space-y-1 custom-scrollbar bg-black/40"
            >
              {filteredLogs.length > 0 ? (
                filteredLogs.map((line, i) => {
                  const isTimestamp = line.includes("Timestamp:");
                  const isSystem    = line.includes("SYSTEM:");
                  const isThrottled = line.includes("THROTTLED");
                  const isOptimized = !isThrottled && line.includes("OPTIMIZED");
                  const isActive    = !isThrottled && !isOptimized && line.includes("Active");
                  const isWaiting   = line.includes("Waiting");
                  const isForensic  = line.includes("FORENSIC:");
                  const isCycle     = line.includes("Cycle complete");

                  return (
                    <div
                      key={i}
                      className={[
                        'flex gap-3',
                        isTimestamp ? 'text-[#F27D26] mt-5 mb-1 font-black border-b border-[#F27D26]/20 pb-1' : '',
                        isSystem    ? 'text-blue-400/80' : '',
                        isThrottled ? 'text-orange-400 font-bold bg-orange-400/8 px-1 rounded' : '',
                        isOptimized ? 'text-red-400 font-bold bg-red-400/5 px-1 rounded' : '',
                        isActive    ? 'text-green-400/90' : '',
                        isForensic  ? 'text-cyan-400/80 border-l-2 border-cyan-400/40 pl-2 italic' : '',
                        isCycle     ? 'text-white/80 font-bold' : '',
                        isWaiting   ? 'text-yellow-400/60 italic' : '',
                        !isTimestamp && !isSystem && !isThrottled && !isOptimized && !isActive && !isForensic && !isCycle && !isWaiting
                          ? 'text-white/40' : '',
                      ].join(' ')}
                    >
                      <span className="opacity-20 select-none w-7 text-right shrink-0">{(i + 1).toString().padStart(3, '0')}</span>
                      <span className="flex-1 break-all">{line}</span>
                    </div>
                  );
                })
              ) : (
                <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-20">
                  <RefreshCw size={32} className="animate-spin" />
                  <span className="hardware-label">
                    {logSearch ? 'No matches' : 'Awaiting Data Stream…'}
                  </span>
                </div>
              )}
              <div ref={logEndRef} />

              {/* Jump-to-live button */}
              {showJumpToBottom && (
                <button
                  onClick={() => {
                    setLogPaused(false);
                    isAtBottom.current = true;
                    setShowJumpToBottom(false);
                    const el = logContainerRef.current;
                    if (el) el.scrollTop = el.scrollHeight;
                  }}
                  className="sticky bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F27D26] text-black text-[10px] font-bold font-mono uppercase tracking-wider shadow-lg hover:brightness-110 transition-all"
                >
                  <ChevronsDown size={12} /> Jump to Live
                </button>
              )}
            </div>

            <div className="px-6 py-2.5 border-t border-white/5 bg-white/[0.02] flex items-center justify-between">
              <div className="flex items-center gap-5">
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${isOffline ? 'bg-red-500' : 'bg-green-500 animate-pulse'}`} />
                  <span className="hardware-label !text-[8px]">{isOffline ? 'Link Severed' : 'Link: Stable'}</span>
                </div>
                <span className="hardware-label !text-[8px] opacity-30">{displayedLogs.length} total lines</span>
              </div>
              <span className="hardware-label !text-[8px] opacity-20">
                {logPaused ? 'feed paused' : 'live'}
              </span>
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-[1600px] mx-auto px-8 py-12 border-t border-white/5 flex flex-col md:flex-row justify-between gap-8">
        <div className="space-y-4 max-w-sm">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-[#F27D26] opacity-50" />
            <span className="hardware-label !text-[11px]">Firefox Process Optimizer</span>
          </div>
          <p className="text-[10px] uppercase tracking-widest leading-relaxed opacity-30">
            A specialized utility for managing multi-threaded browser workloads. 
            Designed for performance-critical environments and kernel-level transparency.
          </p>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-3 gap-12">
          <div className="space-y-3">
            <div className="hardware-label !text-[9px]">Compliance</div>
            <ul className="space-y-1 text-[9px] uppercase tracking-widest opacity-30">
              <li>PRF-Standard</li>
              <li>Kernel v6.x</li>
              <li>POSIX-Shell</li>
            </ul>
          </div>
          <div className="space-y-3">
            <div className="hardware-label !text-[9px]">Interface</div>
            <ul className="space-y-1 text-[9px] uppercase tracking-widest opacity-30">
              <li>D3-Engine</li>
              <li>React-19</li>
              <li>Lucide-Core</li>
            </ul>
          </div>
          <div className="space-y-3">
            <div className="hardware-label !text-[9px]">Status</div>
            <ul className="space-y-1 text-[9px] uppercase tracking-widest opacity-30">
              <li>Encrypted</li>
              <li>Sandboxed</li>
              <li>Verified</li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
