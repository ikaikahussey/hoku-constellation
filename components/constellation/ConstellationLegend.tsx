export function ConstellationLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-white/40">
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full bg-gold" />
        <span>Person</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full bg-ocean" />
        <span>Organization</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-4 h-px bg-gold/40" />
        <span>Active connection</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-4 h-px bg-white/10" />
        <span>Former connection</span>
      </div>
    </div>
  )
}
