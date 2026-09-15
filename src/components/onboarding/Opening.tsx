import { useEffect, useRef, useState } from 'react';
import { LoadingScreen } from './LoadingScreen';
import { useMedia } from '../../lib/useMedia';
import { OPENING } from '../../scene/openingTiming';

const DESCRIPTIONS = [
  'Through your eyes: an old corkboard catches your attention beside a pile of rubbish. You stop and look down.',
  'You crouch, curl your fingers around the wooden rails, and lift the board. You carry it home.',
  'In your kitchen, you lift the board onto the wall above the empty counter. Your hands let go and you step back.',
];

export function Opening({ onComplete }: { onComplete: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const fade = useRef<HTMLDivElement>(null);
  const revealTimer = useRef(0);
  const completed = useRef(onComplete); completed.current = onComplete;
  const [loaded, setLoaded] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const sceneRef = useRef<ReturnType<typeof import('../../scene/opening')['createOpening']>>();
  const [fallback, setFallback] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [controls, setControls] = useState(false);
  const [paused, setPaused] = useState(false);
  const pauseRef = useRef(paused); pauseRef.current = paused;
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const still = reduced || fallback;
  const chapter = seconds < OPENING.pickup ? 0 : seconds < OPENING.home ? 1 : 2;
  const complete = seconds >= OPENING.duration;
  const position = useRef(seconds); position.current = seconds;

  useEffect(() => { dialog.current?.focus(); }, []);
  useEffect(() => () => window.clearTimeout(revealTimer.current), []);
  useEffect(() => {
    if (!complete) return;
    const timer = window.setTimeout(() => completed.current(), 180);
    return () => window.clearTimeout(timer);
  }, [complete]);
  useEffect(() => { if (reduced) sceneRef.current?.render(seconds); }, [seconds, reduced]);
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let reveal = 0;
    let scene: ReturnType<typeof import('../../scene/opening')['createOpening']> | undefined;
    const setup = async () => {
      try {
        const { createOpening } = await import('../../scene/opening');
        if (cancelled || !host.current) return;
        scene = createOpening(host.current);
        sceneRef.current = scene;
        scene.render(position.current);
        setPrepared(true);
        // Let the loading bar finish before beginning the first camera move.
        reveal = window.setTimeout(() => {
          if (cancelled) return;
          setLoaded(true);
          let elapsed = position.current;
          let previous = performance.now();
          let reported = -1;
          const tick = (now: number) => {
            const delta = Math.min((now - previous) / 1000, 0.1); previous = now;
            if (!document.hidden && !pauseRef.current) {
              elapsed = Math.min(OPENING.duration, elapsed + delta);
              scene?.render(elapsed);
              if (fade.current) {
                const opening = Math.max(0, 1 - elapsed / 0.8);
                const cut = Math.max(0, 1 - Math.abs(elapsed - OPENING.home) / 0.8);
                const ending = Math.max(0, (elapsed - (OPENING.duration - 0.8)) / 0.8);
                fade.current.style.opacity = String(Math.max(opening, cut, ending));
              }
              if (Math.floor(elapsed * 4) !== reported) {
                reported = Math.floor(elapsed * 4); setSeconds(elapsed);
              }
            }
            if (elapsed < OPENING.duration) frame = requestAnimationFrame(tick);
          };
          if (!reduced) frame = requestAnimationFrame(tick);
        }, 220);
      } catch {
        if (!cancelled) { scene?.dispose(); scene = undefined; sceneRef.current = undefined; setFallback(true); setLoaded(true); }
      }
    };
    void setup();
    return () => { cancelled = true; window.clearTimeout(reveal); cancelAnimationFrame(frame); scene?.dispose(); sceneRef.current = undefined; };
  }, [reduced]);

  const revealControls = () => {
    setControls(true); window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(() => setControls(false), 1600);
  };
  const advance = () => setSeconds(chapter === 0 ? 12 : chapter === 1 ? 23 : OPENING.duration);
  return (
    <section ref={dialog} tabIndex={-1} className={`opening opening-cinema${controls || still || paused ? ' controls-visible' : ''}`}
      role="dialog" aria-modal="true" aria-label="The story of your corkboard" aria-describedby="opening-description"
      onPointerMove={revealControls} onPointerDown={revealControls}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onComplete(); }
        if (event.key === ' ' && event.target === dialog.current && !still) { event.preventDefault(); setPaused((value) => !value); }
        if (event.key === 'Tab') {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
          const first = buttons[0]; const last = buttons[buttons.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <div ref={host} className="opening-scene" aria-hidden="true" />
      {fallback && <div className="opening-fallback" aria-hidden="true"><div className="opening-fallback-board" /></div>}
      <div className="opening-vignette" aria-hidden="true" />
      <div ref={fade} className="opening-transition" aria-hidden="true" style={{ opacity: still ? 0 : 1 }} />
      <div className="opening-letterbox opening-letterbox-top" aria-hidden="true" />
      <div className="opening-letterbox opening-letterbox-bottom" aria-hidden="true" />
      {!loaded && <LoadingScreen progress={prepared ? 100 : 90} label={prepared ? 'Everything is in place.' : 'Setting the scene…'} />}
      <p id="opening-description" className="sr-only" aria-live="polite">{DESCRIPTIONS[chapter]} Press Escape to skip. {still ? 'Use Next scene to continue.' : 'Press Space to pause or resume.'}</p>
      {loaded && <div className="opening-controls">
        {still ? <button onClick={advance}>{chapter === 2 ? 'Continue' : 'Next scene'}</button> : <button onClick={() => setPaused((value) => !value)}>{paused ? 'Resume' : 'Pause'}</button>}
        <button onClick={onComplete}>Skip intro</button>
      </div>}
    </section>
  );
}
