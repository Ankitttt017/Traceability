import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, Play, Pause, RotateCcw } from "lucide-react";

const processes = [
  { id: "OP10A", title: "Raw Material Reception", desc: "ADC-12 aluminium alloy received in ingot form", icon: "📦" },
  { id: "OP20A", title: "Melting of Alloy", desc: "ADC-12 ingots charged into furnace", icon: "🔥" },
  { id: "OP20B", title: "Degassing & Treatment", desc: "Molten metal degassed and chemically treated", icon: "⚗️" },
  { id: "OP20C", title: "Holding Material", desc: "Treated metal held at controlled temperature", icon: "🫙" },
  { id: "OP30", title: "Die Casting", desc: "High pressure die casting of molten metal", icon: "🏭" },
  { id: "OP40A", title: "Overflow Breaking", desc: "Excess material removed from raw casting", icon: "✂️" },
  { id: "OP40B", title: "Shot Blasting", desc: "Surface cleaning and fettling", icon: "💨" },
  { id: "OP50", title: "Casting Inspection", desc: "Pre-dispatch visual quality check", icon: "🔍" },
  { id: "OP50A1", title: "QR Code Marking", desc: "Laser marking for traceability", icon: "📲" },
  { id: "OP50A", title: "Milling & Drilling", desc: "VMC operations with hydraulic fixture", icon: "⚙️" },
  { id: "OP50B", title: "Spot Facing & Tapping", desc: "Spot face and tap operations on VMC", icon: "🔩" },
  { id: "OP50C", title: "Milling & Tapping", desc: "Milling and tapping on VMC", icon: "🔧" },
  { id: "OP60A", title: "Spot Face & Drill", desc: "Multiple operations on VMC", icon: "⚙️" },
  { id: "OP60B", title: "Milling & Drilling", desc: "VMC operations", icon: "🔩" },
  { id: "OP60C", title: "Final Machining", desc: "Final VMC operations", icon: "🔧" },
  { id: "OP60D", title: "Deburring", desc: "Manual deburring and cleaning", icon: "🧹" },
  { id: "OP70", title: "Pre-Inspection", desc: "Manual visual inspection", icon: "📋" },
  { id: "OP80", title: "Auto Gauging", desc: "Electronic precision gauging", icon: "📏" },
  { id: "OP90", title: "Leak Testing", desc: "Pressure testing for sealing", icon: "💧" },
  { id: "OP100", title: "Ultrasonic Washing", desc: "Remove chips and contaminants", icon: "🌊" },
  { id: "OP110", title: "Final Inspection", desc: "Complete final quality check", icon: "✅" },
  { id: "OP120", title: "Packaging & Dispatch", desc: "Pack and dispatch to customer", icon: "🚚" },
];

export default function PartProcessflow() {
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(2000);
  const intervalRef = useRef(null);
  const containerRef = useRef(null);
  const activeCardRef = useRef(null);

  const total = processes.length;
  const currentOp = processes[activeStep];

  const goToStep = useCallback((idx) => {
    setIsPlaying(false);
    setActiveStep(idx);
    setCompletedSteps(prev => {
      const next = new Set(prev);
      for (let i = 0; i <= idx; i++) next.add(i);
      return next;
    });
  }, []);

  const playNext = useCallback(() => {
    setActiveStep(prev => {
      if (prev + 1 >= total) {
        setIsPlaying(false);
        return prev;
      }
      setCompletedSteps(c => new Set([...c, prev]));
      return prev + 1;
    });
  }, [total]);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(playNext, speed);
    }
    return () => clearInterval(intervalRef.current);
  }, [isPlaying, speed, playNext]);

  useEffect(() => {
    // Better scroll handling - centers the active card properly
    if (activeCardRef.current) {
      activeCardRef.current.scrollIntoView({ 
        behavior: "smooth", 
        block: "center", 
        inline: "center" 
      });
    }
  }, [activeStep]);

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
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 p-4">
      <div className="max-w-full mx-auto px-2">
        {/* Header */}
        <div className="db-header-card mb-4">
          <div className="db-header-gradient-bar" />
          <div className="db-header-inner py-3">
            <div className="db-header-title-group">
              <div className="db-header-icon-box">
                <svg className="w-5 h-5 text-current" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div>
                <h1 className="db-header-title text-text-main text-xl">Part Process Flow</h1>
                <p className="db-header-subtitle text-sm"> OIL PAN K-12 — Production Journey</p>
              </div>
            </div>
          </div>
        </div>

        {/* Controls - Compact */}
        <div className="flex items-center justify-center gap-3 mb-5 bg-white rounded-xl p-3 shadow-md border border-gray-100">
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-white text-gray-700 rounded-lg hover:bg-gray-50 transition-all flex items-center gap-2 border border-gray-200 font-medium text-sm shadow-sm"
          >
            <RotateCcw size={14} /> Reset
          </button>
          <button
            onClick={handlePlayPause}
            className={`px-5 py-2 rounded-lg transition-all flex items-center gap-2 font-semibold text-sm shadow-sm ${
              isPlaying 
                ? "bg-amber-500 text-white hover:bg-amber-600 shadow-amber-500/20" 
                : "bg-blue-600 text-white hover:bg-blue-700 shadow-blue-500/20"
            }`}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            {isPlaying ? "Pause" : "Auto Play"}
          </button>
          <select
            className="px-3 py-2 bg-white text-gray-700 rounded-lg border border-gray-200 font-medium text-sm shadow-sm cursor-pointer hover:border-gray-300 transition-all"
            value={speed}
            onChange={e => setSpeed(Number(e.target.value))}
          >
            <option value={3000}>🐢 Slow</option>
            <option value={2000}>🐇 Normal</option>
            <option value={1000}>🚀 Fast</option>
            <option value={500}>⚡ Very Fast</option>
          </select>
          <div className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg font-mono font-bold text-sm border border-blue-100">
            {activeStep + 1} / {total}
          </div>
        </div>

        {/* Process Flow Visualization */}
        <div className="bg-white rounded-xl p-5 shadow-lg border border-gray-100">
          <div 
            ref={containerRef}
            className="flex items-center gap-0 overflow-x-auto pb-4 px-6 scrollbar-thin scrollbar-thumb-gray-300"
            style={{ scrollbarWidth: 'thin' }}
          >
            {/* Start Point */}
            <div className="flex flex-col items-center shrink-0">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-sm font-bold text-white shadow-md shadow-green-500/20">
                START
              </div>
              <div className="text-[10px] text-gray-500 mt-1 font-medium">Begin</div>
            </div>

            {/* Arrow after Start */}
            <Arrow isActive={activeStep >= 0} />

            {/* Process Cards - Adjusted size to prevent cutoff */}
            {processes.map((process, idx) => (
              <div key={process.id} className="flex items-center shrink-0">
                <div ref={activeStep === idx ? activeCardRef : null}>
                  <button
                    onClick={() => goToStep(idx)}
                    className={`relative w-40 h-auto min-h-[140px] rounded-xl p-3 transition-all duration-300 cursor-pointer border-2 group ${
                      activeStep === idx
                        ? "border-blue-500 bg-gradient-to-br from-blue-50 to-white shadow-xl shadow-blue-500/30 scale-105 z-20"
                        : completedSteps.has(idx)
                        ? "border-emerald-400/60 bg-gradient-to-br from-emerald-50/80 to-white shadow-md"
                        : "border-gray-200 bg-white hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5"
                    }`}
                  >
                    {/* Active indicator */}
                    {activeStep === idx && (
                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full animate-pulse shadow-lg flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      </div>
                    )}
                    
                    {/* Step number badge */}
                    <div className={`absolute top-2 left-2 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                      activeStep === idx 
                        ? "bg-blue-500 text-white" 
                        : completedSteps.has(idx)
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-gray-100 text-gray-500"
                    }`}>
                      {idx + 1}
                    </div>
                    
                    <div className="text-2xl mb-1.5 mt-4 text-center">{process.icon}</div>
                    <div className="text-[10px] font-mono text-blue-600 font-bold mb-0.5 text-center">{process.id}</div>
                    <div className="text-xs font-bold text-gray-800 leading-tight text-center line-clamp-1">{process.title}</div>
                    <div className="text-[10px] text-gray-500 mt-1 line-clamp-2 text-center leading-tight px-1">{process.desc}</div>
                    
                    {/* Completion checkmark */}
                    {completedSteps.has(idx) && activeStep !== idx && (
                      <div className="absolute bottom-2 right-2 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center shadow-sm">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                    
                    {/* Hover effect glow */}
                    <div className={`absolute inset-0 rounded-xl transition-opacity duration-300 pointer-events-none ${
                      activeStep === idx ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`} style={{ boxShadow: 'inset 0 0 0 2px rgba(59,130,246,0.2)' }} />
                  </button>
                </div>

                {/* Arrow after each card */}
                {idx < total - 1 && (
                  <Arrow isActive={completedSteps.has(idx)} isNext={activeStep === idx + 1} />
                )}
              </div>
            ))}

            {/* Arrow before End */}
            <Arrow isActive={completedSteps.size === total} />

            {/* End Point */}
            <div className="flex flex-col items-center shrink-0 ml-1">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-md transition-all ${
                completedSteps.size === total 
                  ? "bg-gradient-to-br from-green-500 to-emerald-600 shadow-green-500/20 scale-105" 
                  : "bg-gray-300 shadow-gray-300/20"
              }`}>
                {completedSteps.size === total ? "✓" : "END"}
              </div>
              <div className="text-[10px] text-gray-500 mt-1 font-medium">Complete</div>
            </div>
          </div>
        </div>

        {/* Current Step Details Card */}
        <div className="mt-5 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100 shadow-sm">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-3xl">{currentOp.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded">{currentOp.id}</span>
                <span className="text-sm font-bold text-gray-800">{currentOp.title}</span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">{currentOp.desc}</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500">Step {activeStep + 1} of {total}</div>
              <div className="w-32 h-1.5 bg-gray-200 rounded-full mt-1 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300" style={{ width: `${((activeStep + 1) / total) * 100}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Arrows */}
        <div className="flex justify-center gap-3 mt-5">
          <button
            onClick={() => goToStep(Math.max(0, activeStep - 1))}
            disabled={activeStep === 0}
            className="px-4 py-2 bg-white text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-gray-200 shadow-sm font-medium text-sm flex items-center gap-1.5"
          >
            <ChevronLeft size={16} /> Previous
          </button>
          <button
            onClick={() => goToStep(Math.min(total - 1, activeStep + 1))}
            disabled={activeStep === total - 1}
            className="px-4 py-2 bg-white text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-gray-200 shadow-sm font-medium text-sm flex items-center gap-1.5"
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Enhanced Arrow Component with Animation
const Arrow = ({ isActive, isNext }) => {
  return (
    <div className="flex items-center shrink-0 mx-1">
      <div className="relative">
        <div className={`w-10 h-0.5 transition-all duration-500 rounded-full ${
          isActive ? "bg-gradient-to-r from-emerald-400 to-emerald-500" : "bg-gray-300"
        }`} />
        <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 
          border-t-[4px] border-t-transparent 
          border-b-[4px] border-b-transparent 
          border-l-[6px] transition-all duration-500 ${
          isActive ? "border-l-emerald-500" : "border-l-gray-300"
        }`} />
        {isNext && (
          <div className="absolute -inset-1">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 bg-blue-400/20 rounded-full animate-ping" />
          </div>
        )}
      </div>
    </div>
  );
};