import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, Play, Pause, CheckCircle2, Circle, Activity } from "lucide-react";

const processes = [
  {
    id: "OP10A", phase: "Raw Material", phaseColor: "emerald",
    title: "Reception of Raw Material", subtitle: "ADC-12 Ingot Form",
    desc: "ADC-12 aluminium alloy received in ingot form. Visual inspection and incoming quality check performed.",
    icon: "📦", tools: ["Inspection Table", "Weight Scale"],
  },
  {
    id: "OP10B", phase: "Raw Material", phaseColor: "emerald",
    title: "Contingency Plan", subtitle: "ADC-12 Molten Form",
    desc: "Alternate reception route — ADC-12 received in molten form as backup supply.",
    icon: "🔄", tools: ["Molten Transfer Ladle"],
  },
  {
    id: "OP20A", phase: "Melting & Prep", phaseColor: "orange",
    title: "Melting of Alloy", subtitle: "ADC-12 Furnace",
    desc: "ADC-12 ingots are charged into the furnace and melted to liquid state.",
    icon: "🔥", tools: ["Melting Furnace"],
  },
  {
    id: "OP20B", phase: "Melting & Prep", phaseColor: "orange",
    title: "Degassing & Metal Treatment", subtitle: "Molten Metal",
    desc: "Molten metal is degassed and chemically treated to remove hydrogen and impurities for quality casting.",
    icon: "⚗️", tools: ["Degassing Unit", "Flux Treatment"],
  },
  {
    id: "OP20C", phase: "Melting & Prep", phaseColor: "orange",
    title: "Holding Material", subtitle: "For Casting",
    desc: "Treated molten metal is held in a holding furnace at controlled temperature until required.",
    icon: "🫙", tools: ["Holding Furnace", "Thermocouple"],
  },
  {
    id: "OP30", phase: "Casting", phaseColor: "red",
    title: "Die Casting", subtitle: "High Pressure",
    desc: "ADC-12 molten metal injected into precision dies under high pressure to form raw casting.",
    icon: "🏭", tools: ["HPDC Machine", "Die Mold"],
  },
  {
    id: "OP40A", phase: "Post-Cast Fettling", phaseColor: "purple",
    title: "Overflow Breaking", subtitle: "Gate & Runner Cutting",
    desc: "Excess material — overflows, gates, and runners — broken and cut from the raw casting.",
    icon: "✂️", tools: ["Trimming Press", "Cutting Tool"],
  },
  {
    id: "OP40B", phase: "Post-Cast Fettling", phaseColor: "purple",
    title: "Masking & Shot Blasting", subtitle: "Fettling Process",
    desc: "Casting is masked, shot blasted to clean surfaces, and final fettling (trimming/deburring) performed.",
    icon: "💨", tools: ["Shot Blasting Machine", "Masking Tape"],
  },
  {
    id: "OP50", phase: "Inspection & Marking", phaseColor: "blue",
    title: "Casting PDI", subtitle: "Final Table Inspection",
    desc: "Pre-dispatch inspection on table — visual quality check of all cast parts before machining begins.",
    icon: "🔍", tools: ["Inspection Table", "Visual Gauges"],
  },
  {
    id: "OP50A1", phase: "Inspection & Marking", phaseColor: "blue",
    title: "QR Code Laser Marking", subtitle: "Customer Traceability",
    desc: "Unique customer QR code is laser-marked on each part for full traceability throughout supply chain.",
    icon: "📲", tools: ["Laser Marking Machine"],
  },
  {
    id: "OP50A", phase: "Machining", phaseColor: "indigo",
    title: "Milling, Drilling & Reaming", subtitle: "VMC + Hydraulic Fixture",
    desc: "Vertical Machining Centre with hydraulic clamping. Milling Ø63, Drill Ø7, Reamer Ø8 (+0.099/+0.077).",
    icon: "⚙️", tools: ["VMC", "Milling Ø63", "Drill Ø7", "Reamer Ø8"],
  },
  {
    id: "OP50B", phase: "Machining", phaseColor: "indigo",
    title: "Spot Facing, Drilling & Tapping", subtitle: "VMC + Hydraulic Fixture",
    desc: "Spot Face Cutter Ø36, Tap M14×1.5 machined on VMC with hydraulic clamping fixture.",
    icon: "🔩", tools: ["VMC", "Spot Face Ø36", "Tap M14×1.5"],
  },
  {
    id: "OP50C", phase: "Machining", phaseColor: "indigo",
    title: "Milling, Drilling & Tapping", subtitle: "VMC + Hydraulic Fixture",
    desc: "Milling Cutter Ø50 and Tap M8×1.25 operations performed on VMC.",
    icon: "🔧", tools: ["VMC", "Milling Ø50", "Tap M8×1.25"],
  },
  {
    id: "OP60A", phase: "Machining", phaseColor: "indigo",
    title: "Spot Facing, Drilling & Tapping", subtitle: "VMC + Hydraulic Fixture",
    desc: "Spot Face Ø77.2, Tap 3/4-16 UNF, Drill Ø7, End Mill Ø12 on VMC.",
    icon: "⚙️", tools: ["Spot Face Ø77.2", "Tap 3/4-16 UNF", "Drill Ø7", "End Mill Ø12"],
  },
  {
    id: "OP60B", phase: "Machining", phaseColor: "indigo",
    title: "Milling & Drilling", subtitle: "VMC + Hydraulic Fixture",
    desc: "Milling Cutter Ø50 and Drill Ø12 operations on Vertical Machining Centre.",
    icon: "🔩", tools: ["VMC", "Milling Ø50", "Drill Ø12"],
  },
  {
    id: "OP60C", phase: "Machining", phaseColor: "indigo",
    title: "Milling, Drilling & Tapping", subtitle: "VMC + Hydraulic Fixture",
    desc: "Milling Cutter Ø50 and Tap M8×1.25 final machining operations.",
    icon: "🔧", tools: ["VMC", "Milling Ø50", "Tap M8×1.25"],
  },
  {
    id: "OP60D", phase: "Machining", phaseColor: "indigo",
    title: "Deburring & Cleaning", subtitle: "Manual",
    desc: "Manual removal of all burrs from machined surfaces and thorough cleaning before inspection.",
    icon: "🧹", tools: ["Deburring Tools", "Cleaning Brush"],
  },
  {
    id: "OP70", phase: "Inspection & Testing", phaseColor: "teal",
    title: "Pre-Inspection", subtitle: "Inspection Table",
    desc: "Manual visual and dimensional pre-inspection on table before electronic gauging.",
    icon: "📋", tools: ["Inspection Table", "Calipers", "Visual Check"],
  },
  {
    id: "OP80", phase: "Inspection & Testing", phaseColor: "teal",
    title: "Auto Gauging", subtitle: "Electronic Gauge",
    desc: "All critical dimensions verified automatically using precision electronic gauging equipment.",
    icon: "📏", tools: ["Electronic Gauge", "Auto Gauging Station"],
  },
  {
    id: "OP90", phase: "Inspection & Testing", phaseColor: "teal",
    title: "Leak Testing", subtitle: "Leak Testing Machine",
    desc: "Part pressure-tested to confirm sealing integrity — zero leakage tolerance.",
    icon: "💧", tools: ["Leak Testing Machine", "Pressure Gauge"],
  },
  {
    id: "OP100", phase: "Inspection & Testing", phaseColor: "teal",
    title: "Ultrasonic Washing", subtitle: "Washing Machine",
    desc: "Ultrasonic washing machine removes all machining chips, oils, and contaminants.",
    icon: "🌊", tools: ["Ultrasonic Washing Machine"],
  },
  {
    id: "OP110", phase: "Final Release", phaseColor: "green",
    title: "Final Inspection", subtitle: "Inspection Table",
    desc: "Complete manual final inspection — dimensional, visual, and functional check before dispatch.",
    icon: "✅", tools: ["Inspection Table", "Final Gauges"],
  },
  {
    id: "OP120", phase: "Final Release", phaseColor: "green",
    title: "Packaging & Dispatch", subtitle: "Manual",
    desc: "Parts manually packed per customer specification and dispatched to customer location.",
    icon: "🚚", tools: ["Packing Materials", "Dispatch Station"],
  },
];

const colorConfig = {
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-500", badge: "bg-emerald-500/20", glow: "shadow-emerald-500/20" },
  orange: { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-500", badge: "bg-orange-500/20", glow: "shadow-orange-500/20" },
  red: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-500", badge: "bg-red-500/20", glow: "shadow-red-500/20" },
  purple: { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-500", badge: "bg-purple-500/20", glow: "shadow-purple-500/20" },
  blue: { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-500", badge: "bg-blue-500/20", glow: "shadow-blue-500/20" },
  indigo: { bg: "bg-indigo-500/10", border: "border-indigo-500/30", text: "text-indigo-500", badge: "bg-indigo-500/20", glow: "shadow-indigo-500/20" },
  teal: { bg: "bg-teal-500/10", border: "border-teal-500/30", text: "text-teal-500", badge: "bg-teal-500/20", glow: "shadow-teal-500/20" },
  green: { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-500", badge: "bg-green-500/20", glow: "shadow-green-500/20" },
};

const OperationCard = ({ operation, index, isActive, isCompleted, onClick }) => {
  const colors = colorConfig[operation.phaseColor];
  
  return (
    <button
      onClick={onClick}
      className={`relative text-left rounded-xl border-2 p-4 transition-all duration-300 ${
        isActive 
          ? `${colors.bg} ${colors.border} ${colors.glow} shadow-lg scale-[1.02]`
          : isCompleted
          ? `${colors.bg} border-border/50 opacity-75 hover:opacity-100`
          : "bg-bg-hover border-border hover:border-primary/50 hover:scale-[1.01]"
      }`}
    >
      {isActive && (
        <div className={`absolute -top-2 -right-2 ${colors.badge} ${colors.text} rounded-full p-1`}>
          <Activity size={14} />
        </div>
      )}
      
      <div className="flex items-start gap-3 mb-2">
        <span className="text-3xl">{operation.icon}</span>
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-bold uppercase mb-1 ${isActive ? colors.text : isCompleted ? "text-success" : "text-text-muted"}`}>
            {operation.id}
          </div>
          <div className={`text-sm font-bold truncate ${isActive ? colors.text : "text-text-main"}`}>
            {operation.title}
          </div>
        </div>
        {isCompleted && !isActive && (
          <CheckCircle2 size={18} className="text-success shrink-0" />
        )}
        {!isCompleted && !isActive && (
          <Circle size={18} className="text-text-muted/30 shrink-0" />
        )}
      </div>
      
      <div className={`text-xs ${isActive ? colors.text : "text-text-muted"} truncate`}>
        {operation.subtitle}
      </div>
    </button>
  );
};

const PhaseBadge = ({ phase, color }) => {
  const colors = colorConfig[color];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text} border ${colors.border}`}>
      {phase}
    </span>
  );
};

export default function PartProcessflow() {
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(2000);
  const intervalRef = useRef(null);
  const stepRefs = useRef([]);

  const total = processes.length;
  const currentOp = processes[activeStep];
  const currentColors = colorConfig[currentOp.phaseColor];
  const progress = Math.round((completedSteps.size / total) * 100);

  const goToStep = useCallback((idx) => {
    setIsPlaying(false);
    setActiveStep(idx);
    setCompletedSteps(prev => {
      const next = new Set(prev);
      for (let i = 0; i <= idx; i++) next.add(i);
      return next;
    });
    stepRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const playNext = useCallback(() => {
    setActiveStep(prev => {
      if (prev + 1 >= total) {
        setIsPlaying(false);
        return prev;
      }
      setCompletedSteps(c => new Set([...c, prev]));
      stepRefs.current[prev + 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
      return prev + 1;
    });
  }, [total]);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(playNext, speed);
    }
    return () => clearInterval(intervalRef.current);
  }, [isPlaying, speed, playNext]);

  const handlePlayPause = () => {
    if (activeStep >= total - 1) {
      setActiveStep(0);
      setCompletedSteps(new Set());
    }
    setIsPlaying(prev => !prev);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setActiveStep(0);
    setCompletedSteps(new Set());
    stepRefs.current[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-bg-dark via-bg-main to-bg-dark p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-bg-card to-bg-hover border border-border rounded-2xl p-6 shadow-xl">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary/20 rounded-xl border border-primary/30">
              <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-text-main">Manufacturing Process Flow</h1>
              <p className="text-text-muted mt-1">ADC-12 Die Cast Component · Complete Production Journey</p>
            </div>
          </div>
        </div>

        {/* Controls Panel */}
        <div className="bg-bg-card border border-border rounded-2xl p-5 shadow-lg">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Progress Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-text-muted">Overall Progress</span>
                <span className="font-bold text-primary">{progress}%</span>
              </div>
              <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-full transition-all duration-500" 
                  style={{ width: `${progress}%` }} 
                />
              </div>
              <div className="text-xs text-text-muted">
                {completedSteps.size} of {total} operations completed
              </div>
            </div>

            {/* Speed Control */}
            <div>
              <label className="block text-xs font-bold text-text-muted uppercase mb-2">Playback Speed</label>
              <select
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg-dark text-text-main text-sm focus:outline-none focus:border-primary/50"
                value={speed}
                onChange={e => setSpeed(Number(e.target.value))}
              >
                <option value={3000}>0.5x (Slow)</option>
                <option value={2000}>1x (Normal)</option>
                <option value={1000}>2x (Fast)</option>
                <option value={500}>4x (Very Fast)</option>
              </select>
            </div>

            {/* Playback Controls */}
            <div className="flex gap-2">
              <button
                onClick={handleReset}
                className="flex-1 px-4 py-2 rounded-lg border border-border bg-bg-dark text-text-main hover:bg-bg-hover transition-all text-sm font-bold flex items-center justify-center gap-2"
              >
                <RotateCcw size={16} /> Reset
              </button>
              <button
                onClick={handlePlayPause}
                className={`flex-1 px-4 py-2 rounded-lg border transition-all text-sm font-bold flex items-center justify-center gap-2 ${
                  isPlaying 
                    ? "bg-warning/20 border-warning text-warning hover:bg-warning/30" 
                    : "bg-primary/20 border-primary text-primary hover:bg-primary/30"
                }`}
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                {isPlaying ? "Pause" : "Play"}
              </button>
            </div>

            {/* Current Operation */}
            <div className={`rounded-lg p-3 border ${currentColors.border} ${currentColors.bg}`}>
              <div className="text-xs font-bold text-text-muted uppercase mb-1">Current Operation</div>
              <div className={`text-base font-bold ${currentColors.text}`}>{currentOp.id}</div>
              <div className="text-xs text-text-muted truncate">{currentOp.title}</div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar Navigation */}
          <div className="lg:col-span-1">
            <div className="bg-bg-card border border-border rounded-2xl p-4 shadow-lg sticky top-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
              <div className="text-xs font-bold text-text-muted uppercase mb-3 sticky top-0 bg-bg-card py-2">
                Operation List
              </div>
              <div className="space-y-1.5">
                {processes.map((p, i) => {
                  const isCompleted = completedSteps.has(i);
                  const isActive = activeStep === i;
                  const colors = colorConfig[p.phaseColor];
                  
                  return (
                    <button
                      key={p.id}
                      ref={el => stepRefs.current[i] = el}
                      onClick={() => goToStep(i)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-all text-xs flex items-center gap-2 group ${
                        isActive 
                          ? `${colors.bg} ${colors.border} border shadow-sm`
                          : isCompleted 
                          ? "opacity-60 hover:opacity-100" 
                          : "hover:bg-bg-hover"
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        isActive ? colors.text : isCompleted ? "bg-success" : "bg-text-muted/40"
                      }`} />
                      <span className={`font-mono font-bold ${isActive ? colors.text : "text-text-muted"}`}>
                        {p.id}
                      </span>
                      <span className="flex-1 truncate text-text-muted group-hover:text-text-main">
                        {p.title}
                      </span>
                      {isCompleted && <CheckCircle2 size={12} className="text-success shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-3 space-y-6">
            {/* Active Operation Detail */}
            <div className={`rounded-2xl border-2 p-6 shadow-xl transition-all ${currentColors.border} ${currentColors.bg}`}>
              <div className="flex items-start justify-between mb-4 gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <PhaseBadge phase={currentOp.phase} color={currentOp.phaseColor} />
                    <span className={`text-xs font-mono font-bold ${currentColors.text}`}>{currentOp.id}</span>
                  </div>
                  <h2 className="text-2xl font-bold text-text-main mb-2">{currentOp.title}</h2>
                  <p className="text-text-muted">{currentOp.subtitle}</p>
                </div>
                <div className="text-6xl">{currentOp.icon}</div>
              </div>
              
              <p className="text-text-muted leading-relaxed mb-4">{currentOp.desc}</p>
              
              <div className="flex flex-wrap gap-2 mb-4">
                {currentOp.tools.map(tool => (
                  <span key={tool} className={`text-xs px-3 py-1 rounded-full border ${currentColors.border} ${currentColors.bg} ${currentColors.text} font-medium`}>
                    🛠️ {tool}
                  </span>
                ))}
              </div>
              
              <div className="flex items-center justify-between text-sm pt-3 border-t border-border/50">
                <span className="text-text-muted">
                  Step <span className={`font-bold ${currentColors.text}`}>{activeStep + 1}</span> of {total}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => goToStep(Math.max(0, activeStep - 1))}
                    disabled={activeStep === 0}
                    className="px-3 py-1 rounded-lg border border-border bg-bg-dark text-text-muted hover:text-text-main disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => goToStep(Math.min(total - 1, activeStep + 1))}
                    disabled={activeStep === total - 1}
                    className="px-3 py-1 rounded-lg border border-border bg-bg-dark text-text-muted hover:text-text-main disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Process Timeline Visualization */}
            <div className="bg-bg-card border border-border rounded-2xl p-5 shadow-lg">
              <div className="text-xs font-bold text-text-muted uppercase mb-3">Process Timeline</div>
              <div className="flex items-center gap-1 overflow-x-auto pb-3">
                {processes.map((p, i) => {
                  const isCompleted = completedSteps.has(i);
                  const isActive = activeStep === i;
                  const colors = colorConfig[p.phaseColor];
                  
                  return (
                    <div key={p.id} className="flex items-center shrink-0">
                      <button
                        onClick={() => goToStep(i)}
                        className={`relative w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold transition-all cursor-pointer ${
                          isActive 
                            ? `${colors.bg} ${colors.border} border-2 scale-110 shadow-lg`
                            : isCompleted 
                            ? "bg-success text-white"
                            : "bg-bg-hover border border-border text-text-muted"
                        }`}
                      >
                        {isCompleted ? <CheckCircle2 size={16} /> : i + 1}
                      </button>
                      {i < total - 1 && (
                        <div className={`w-6 h-0.5 mx-0.5 transition-all ${isCompleted ? "bg-success" : "bg-border"}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* All Operations Grid */}
            <div>
              <h3 className="text-sm font-bold text-text-muted uppercase mb-3 flex items-center gap-2">
                <span>📋</span> Complete Operation List
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {processes.map((operation, idx) => (
                  <OperationCard
                    key={operation.id}
                    operation={operation}
                    index={idx}
                    isActive={activeStep === idx}
                    isCompleted={completedSteps.has(idx)}
                    onClick={() => goToStep(idx)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}