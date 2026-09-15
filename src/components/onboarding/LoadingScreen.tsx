export function LoadingScreen({ progress = 25, label = 'Opening your memory box…' }: { progress?: number; label?: string }) {
  return (
    <div className="startup-loading" role="status" aria-live="polite">
      <span className="startup-eyebrow">A little space for what matters</span>
      <h1>cork<span>.</span></h1>
      <p className="hand">keep your memories close</p>
      <div className="startup-meter" role="progressbar" aria-label="Loading Cork" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div style={{ width: `${progress}%` }} />
      </div>
      <span className="startup-label">{label} <span>{progress}%</span></span>
    </div>
  );
}
