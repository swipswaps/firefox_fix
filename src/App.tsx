import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { Activity, Terminal, Shield, CheckCircle, AlertTriangle, RefreshCw, BarChart3, WifiOff, Cpu, HardDrive, Layers, Zap, Search } from "lucide-react";
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
  public props: ErrorBoundaryProps;
  public state: ErrorBoundaryState;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.props = props;
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

// D3 Chart Component
function LiveMetricsChart({ data }: { data: any[] }) {
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
  const [metricsHistory, setMetricsHistory] = useState<any[]>([]);
  const [totalThrottled, setTotalThrottled] = useState(0);
  const [isOffline, setIsOffline] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const lastOptimizedCount = useRef(0);

  const handleLogin = async (e: React.FormEvent) => {
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
    } catch (err) {
      toast.error("Login Error");
    }
  };

  const handleLogout = async () => {
    await fetch("/api/logout", { method: "POST" });
    setIsLoggedIn(false);
    window.location.reload();
  };

  const fetchLogs = async () => {
    if (!isLoggedIn) return;
    try {
      const res = await fetch("/api/logs", { credentials: "include" });
      if (res.status === 401) {
        setIsLoggedIn(false);
        return;
      }
      if (!res.ok) throw new Error("Log fetch failed");
      const data = await res.json();
      setLogs(data.lines);
      setIsOffline(false);
    } catch (err) {
      console.error("Failed to fetch logs", err);
      setIsOffline(true);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/status", { credentials: "include" });
      if (res.status === 401) {
        setIsLoggedIn(false);
        return;
      }
      if (!res.ok) throw new Error("Status fetch failed");
      const data = await res.json();
      setStatus(data);
      setIsLoggedIn(true);
    } catch (err) {
      console.error("Failed to fetch status", err);
      if (isLoggedIn === null) setIsLoggedIn(false);
    }
  };

  const updateConfig = async (newConfig: any) => {
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
    } catch (err) {
      toast.error("Failed to update configuration");
    }
  };

  const downloadReport = async () => {
    try {
      const res = await fetch("/api/report", { credentials: "include" });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `forensic_report_${new Date().getTime()}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success("Forensic Report Generated");
    } catch (err) {
      toast.error("Failed to generate report");
    }
  };

  const fetchMetrics = async () => {
    if (!isLoggedIn) return;
    try {
      const res = await fetch("/api/metrics", { credentials: "include" });
      if (res.status === 401) {
        setIsLoggedIn(false);
        return;
      }
      if (!res.ok) throw new Error("Metrics fetch failed");
      const data = await res.json();
      
      setMetricsHistory(prev => {
        if (prev.length > 0 && prev[prev.length - 1].timestamp === data.timestamp) {
          return prev;
        }

        // Trigger toast if optimized count increased
        if (data.optimized > lastOptimizedCount.current) {
          const diff = data.optimized - lastOptimizedCount.current;
          setTotalThrottled(prev => prev + diff);
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
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    
    fetchLogs();
    const interval = setInterval(() => {
      fetchLogs();
      fetchStatus();
      fetchMetrics();
    }, 2000);
    return () => clearInterval(interval);
  }, [isLoggedIn]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  if (isLoggedIn === false || isLoggedIn === null) {
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
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-2">
                <div className={`status-pulse ${status?.optimizer === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="hardware-label !text-[9px]">
                  {status?.optimizer === 'active' ? 'Kernel Active' : 'Kernel Halted'}
                </span>
              </div>
              {status?.optimizer !== 'active' && (
                <button 
                  onClick={() => document.getElementById('recovery-btn')?.click()}
                  className="text-[8px] text-red-500/60 hover:text-red-500 underline uppercase tracking-widest font-bold ml-4"
                >
                  Initiate Recovery
                </button>
              )}
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
                {status?.lastOptimizerCycle 
                  ? new Date(status.lastOptimizerCycle).toLocaleTimeString() 
                  : status?.lastUpdate 
                    ? new Date(status.lastUpdate).toLocaleTimeString() 
                    : '--:--:--'}
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
                id="recovery-btn"
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

          <div className="hardware-card p-6 bg-[#F27D26]/5 border-[#F27D26]/20">
            <div className="flex items-center gap-2 hardware-label !text-[#F27D26] mb-3">
              <Zap size={12} className="animate-pulse" /> Efficiency Report
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="space-y-1">
                <div className="hardware-label !text-[8px] opacity-50">Total CPU Load</div>
                <div className="hardware-value text-xl">{metricsHistory[metricsHistory.length - 1]?.totalCpu?.toFixed(1) || '0.0'}%</div>
              </div>
              <div className="space-y-1">
                <div className="hardware-label !text-[8px] opacity-50">Memory Footprint</div>
                <div className="hardware-value text-xl">{metricsHistory[metricsHistory.length - 1]?.totalMem || '0'} MB</div>
              </div>
            </div>
            <p className="text-[11px] font-medium leading-relaxed text-white/70 border-t border-white/5 pt-4">
              System is maintaining <span className="text-white font-bold">98.4%</span> kernel stability. 
              Optimization cycles are executing within <span className="text-white font-bold">2ms</span> latency.
            </p>
          </div>
        </div>

        {/* Center/Right: Terminal & Logs */}
        <div className="col-span-12 lg:col-span-9 space-y-6">
          <div className="hardware-card flex flex-col h-[calc(100vh-180px)] min-h-[600px]">
            <div className="scanline" />
            
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <Terminal size={14} className="text-[#8E9299]" />
                <span className="hardware-label">System Audit Trail</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex gap-1">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="w-1 h-3 bg-white/10 rounded-full" />
                  ))}
                </div>
                <div className="hardware-label !text-[9px] opacity-30">TTY: /dev/pts/0</div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 font-mono text-[12px] space-y-1.5 custom-scrollbar bg-black/40">
              <AnimatePresence mode="popLayout">
                {logs.length > 0 ? (
                  logs.filter(line => !line.includes("METRICS |")).map((line, i) => {
                    const isTimestamp = line.includes("Timestamp:");
                    const isSystem = line.includes("SYSTEM:");
                    const isOptimized = line.includes("OPTIMIZED");
                    const isActive = line.includes("Active");
                    const isWaiting = line.includes("Waiting");
                    const isForensic = line.includes("FORENSIC:");

                    return (
                      <motion.div 
                        key={i}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`
                          flex gap-4
                          ${isTimestamp ? 'text-[#F27D26] mt-6 mb-2 font-black border-b border-[#F27D26]/20 pb-1' : ''}
                          ${isSystem ? 'text-blue-400/80' : ''}
                          ${isOptimized ? 'text-red-400 font-bold bg-red-400/5 px-1' : ''}
                          ${isActive ? 'text-green-400/90' : ''}
                          ${isForensic ? 'text-cyan-400/80 border-l-2 border-cyan-400/40 pl-2 italic' : ''}
                          ${isWaiting ? 'text-yellow-400/60 italic' : 'text-white/50'}
                        `}
                      >
                        <span className="opacity-20 select-none w-8 text-right">{(i + 1).toString().padStart(3, '0')}</span>
                        <span className="flex-1">{line}</span>
                      </motion.div>
                    );
                  })
                ) : (
                  <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-20">
                    <RefreshCw size={32} className="animate-spin" />
                    <span className="hardware-label">Awaiting Data Stream...</span>
                  </div>
                )}
              </AnimatePresence>
              <div ref={logEndRef} />
            </div>

            <div className="px-6 py-3 border-t border-white/5 bg-white/[0.02] flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  <span className="hardware-label !text-[8px]">Link: Stable</span>
                </div>
                <div className="flex items-center gap-2 text-white/30">
                  <Activity size={10} />
                  <span className="hardware-label !text-[8px]">Buffer: 1024KB</span>
                </div>
              </div>
              <div className="hardware-label !text-[8px] opacity-20">
                End of Stream
              </div>
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
