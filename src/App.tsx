import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { Activity, Terminal, Shield, CheckCircle, AlertTriangle, RefreshCw, BarChart3, WifiOff } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import * as d3 from "d3";

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
        <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-6">
          <div className="text-center space-y-4 max-w-md">
            <AlertTriangle size={48} className="mx-auto text-red-500" />
            <h1 className="text-2xl font-bold uppercase tracking-tighter">System Fault Detected</h1>
            <p className="opacity-50 text-sm">A critical error occurred in the UI. Please refresh the page to re-initialize the system.</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-white text-black font-bold uppercase text-xs tracking-widest rounded-full hover:bg-opacity-80 transition-all"
            >
              Restart Interface
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
    const margin = { top: 20, right: 20, bottom: 30, left: 40 };

    svg.selectAll("*").remove();

    const x = d3.scaleTime()
      .domain(d3.extent(data, d => new Date(d.timestamp)) as [Date, Date])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => Math.max(d.optimized, d.active)) || 10])
      .nice()
      .range([height - margin.bottom, margin.top]);

    const lineOptimized = d3.line<any>()
      .x(d => x(new Date(d.timestamp)))
      .y(d => y(d.optimized))
      .curve(d3.curveMonotoneX);

    const lineActive = d3.line<any>()
      .x(d => x(new Date(d.timestamp)))
      .y(d => y(d.active))
      .curve(d3.curveMonotoneX);

    svg.append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d3.timeFormat("%H:%M:%S") as any))
      .attr("color", "rgba(255,255,255,0.2)");

    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5))
      .attr("color", "rgba(255,255,255,0.2)");

    svg.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", "#F27D26")
      .attr("stroke-width", 2)
      .attr("d", lineOptimized);

    svg.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", "#4ade80")
      .attr("stroke-width", 2)
      .attr("d", lineActive);

  }, [data]);

  return <svg ref={svgRef} className="w-full h-full" />;
}

export default function AppWrapper() {
  return (
    <MyErrorBoundary>
      <App />
    </MyErrorBoundary>
  );
}

function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [metricsHistory, setMetricsHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    try {
      const res = await fetch("/api/logs");
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
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error("Status fetch failed");
      const data = await res.json();
      setStatus(data);
      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch status", err);
    }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch("/api/metrics");
      if (!res.ok) throw new Error("Metrics fetch failed");
      const data = await res.json();
      setMetricsHistory(prev => {
        // Prevent duplicate timestamps if polling is faster than data updates
        if (prev.length > 0 && prev[prev.length - 1].timestamp === data.timestamp) {
          return prev;
        }
        return [...prev.slice(-19), data];
      });
    } catch (err) {
      console.error("Failed to fetch metrics", err);
    }
  };

  useEffect(() => {
    fetchLogs();
    fetchStatus();
    fetchMetrics();
    const interval = setInterval(() => {
      fetchLogs();
      fetchStatus();
      fetchMetrics();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans p-6 md:p-12">
      {/* Header */}
      <header className="max-w-7xl mx-auto mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[#F27D26] uppercase tracking-widest text-xs font-bold">
            <Shield size={14} />
            System Utility
          </div>
          <h1 className="text-6xl md:text-8xl font-black uppercase leading-[0.85] tracking-tighter">
            Firefox<br />Optimizer
          </h1>
        </div>
        
        <div className="flex flex-col items-start md:items-end gap-2">
          <AnimatePresence>
            {isOffline && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex items-center gap-2 text-red-500 text-[10px] font-bold uppercase tracking-widest mb-2"
              >
                <WifiOff size={12} />
                Connection Lost
                <button 
                  onClick={() => window.location.reload()}
                  className="ml-1 p-1 hover:bg-red-500/20 rounded-full transition-colors"
                  title="Reconnect"
                >
                  <RefreshCw size={10} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex items-center gap-3 bg-white/5 border border-white/10 px-4 py-2 rounded-full">
            <div className={`w-2 h-2 rounded-full animate-pulse ${status?.optimizer === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm font-mono uppercase tracking-wider opacity-70">
              {status?.optimizer === 'active' ? 'System Active' : 'System Offline'}
            </span>
          </div>
          <p className="text-xs font-mono opacity-40 uppercase tracking-widest">
            Last Sync: {status?.lastUpdate ? new Date(status.lastUpdate).toLocaleTimeString() : '---'}
          </p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Stats Column */}
        <div className="space-y-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 border border-white/10 p-8 rounded-3xl"
          >
            <div className="flex items-center gap-3 mb-6 opacity-50 uppercase tracking-widest text-xs font-bold">
              <Activity size={16} />
              Performance Metrics
            </div>
            <div className="space-y-6">
              <div>
                <div className="text-xs opacity-40 uppercase mb-1">CPU Threshold</div>
                <div className="text-4xl font-black tracking-tighter">5.0%</div>
              </div>
              <div>
                <div className="text-xs opacity-40 uppercase mb-1">Nice Priority</div>
                <div className="text-4xl font-black tracking-tighter">+5</div>
              </div>
              <div>
                <div className="text-xs opacity-40 uppercase mb-1">I/O Class</div>
                <div className="text-4xl font-black tracking-tighter">Best-Effort</div>
              </div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white/5 border border-white/10 p-8 rounded-3xl h-[300px] flex flex-col"
          >
            <div className="flex items-center gap-3 mb-6 opacity-50 uppercase tracking-widest text-xs font-bold">
              <BarChart3 size={16} />
              Activity History
            </div>
            <div className="flex-1 min-h-0">
              <LiveMetricsChart data={metricsHistory} />
            </div>
            <div className="mt-4 flex gap-4 text-[10px] uppercase tracking-widest font-bold">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#F27D26]" />
                <span className="opacity-50 text-white">Optimized</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#4ade80]" />
                <span className="opacity-50 text-white">Active Threads</span>
              </div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-[#F27D26] text-black p-8 rounded-3xl"
          >
            <div className="flex items-center gap-3 mb-4 uppercase tracking-widest text-xs font-bold">
              <CheckCircle size={16} />
              Optimization Status
            </div>
            <p className="text-lg font-medium leading-tight mb-6">
              The system is currently monitoring all Firefox content processes and applying real-time priority adjustments.
            </p>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
              <RefreshCw size={14} className="animate-spin" />
              Real-time monitoring enabled
            </div>
          </motion.div>
        </div>

        {/* Terminal Column */}
        <div className="lg:col-span-2">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-black border border-white/10 rounded-3xl overflow-hidden flex flex-col h-[600px]"
          >
            <div className="bg-white/5 px-6 py-4 border-bottom border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3 uppercase tracking-widest text-xs font-bold opacity-50">
                <Terminal size={16} />
                Live Audit Trail
              </div>
              <div className="flex gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-500/20" />
                <div className="w-2 h-2 rounded-full bg-yellow-500/20" />
                <div className="w-2 h-2 rounded-full bg-green-500/20" />
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 font-mono text-sm space-y-1 custom-scrollbar">
              <AnimatePresence mode="popLayout">
                {logs.length > 0 ? (
                  logs.map((line, i) => {
                    const isTimestamp = line.includes("Timestamp:");
                    const isSystem = line.includes("SYSTEM:");
                    const isOptimized = line.includes("OPTIMIZED");
                    const isActive = line.includes("Active");
                    const isWaiting = line.includes("Waiting");

                    return (
                      <motion.div 
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`
                          ${isTimestamp ? 'text-[#F27D26] mt-4 font-bold' : ''}
                          ${isSystem ? 'text-blue-400 opacity-80' : ''}
                          ${isOptimized ? 'text-red-400 font-bold' : ''}
                          ${isActive ? 'text-green-400' : ''}
                          ${isWaiting ? 'text-yellow-400 italic opacity-60' : 'text-white/60'}
                        `}
                      >
                        {line}
                      </motion.div>
                    );
                  })
                ) : (
                  <div className="text-white/20 uppercase tracking-widest text-xs text-center mt-20">
                    No log data available
                  </div>
                )}
              </AnimatePresence>
              <div ref={logEndRef} />
            </div>
          </motion.div>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto mt-12 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between gap-4 opacity-30 text-[10px] uppercase tracking-[0.2em]">
        <div>© 2026 Firefox Process Optimizer</div>
        <div className="flex gap-6">
          <span>PRF-Compliant</span>
          <span>Kernel-Level Priority Adjustment</span>
          <span>Real-time Audit Trail</span>
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
