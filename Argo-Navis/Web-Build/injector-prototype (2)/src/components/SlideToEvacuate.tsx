import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsRight } from 'lucide-react';
import { hapticConfirm, hapticTap, hapticTick } from '../utils/haptics';

interface SlideToEvacuateProps {
  onConfirm: () => void;
}

export function SlideToEvacuate({ onConfirm }: SlideToEvacuateProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const activeTouchIdRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const offsetRef = useRef(0);
  const maxSlideRef = useRef(190);
  const lastDetentRef = useRef(0);
  const completedRef = useRef(false);

  const [offsetPx, setOffsetPx] = useState(0);
  const [maxSlidePx, setMaxSlidePx] = useState(190);
  const [isDragging, setIsDragging] = useState(false);
  const [completed, setCompleted] = useState(false);

  const thumbSize = 52;
  const padding = 4;

  const measureMaxSlide = useCallback(() => {
    const track = trackRef.current;
    if (!track) return maxSlideRef.current;
    const style = window.getComputedStyle(track);
    const borderX =
      (Number.parseFloat(style.borderLeftWidth) || 0) +
      (Number.parseFloat(style.borderRightWidth) || 0);
    const innerWidth = track.clientWidth || track.getBoundingClientRect().width - borderX;
    const max = Math.max(1, Math.round(innerWidth - thumbSize - padding * 2));
    maxSlideRef.current = max;
    setMaxSlidePx(max);
    return max;
  }, []);

  const triggerConfirm = useCallback(
    (max: number) => {
      if (completedRef.current) return;
      completedRef.current = true;
      draggingRef.current = false;
      activePointerIdRef.current = null;
      activeTouchIdRef.current = null;
      offsetRef.current = max;
      setIsDragging(false);
      setCompleted(true);
      setOffsetPx(max);
      hapticConfirm();
      onConfirm();
    },
    [onConfirm],
  );

  const updateDragPosition = useCallback(
    (clientX: number) => {
      if (!draggingRef.current || completedRef.current) return;
      const max = maxSlideRef.current;
      const next = Math.min(max, Math.max(0, clientX - startXRef.current));
      offsetRef.current = next;
      setOffsetPx(next);

      const detent = Math.floor((next / Math.max(1, max)) * 4);
      if (detent > lastDetentRef.current && detent < 4) {
        lastDetentRef.current = detent;
        hapticTick();
      }

      if (next >= max * 0.85) {
        triggerConfirm(max);
      }
    },
    [triggerConfirm],
  );

  const finishDrag = useCallback(() => {
    if (!draggingRef.current || completedRef.current) return;
    draggingRef.current = false;
    activePointerIdRef.current = null;
    activeTouchIdRef.current = null;
    setIsDragging(false);

    if (offsetRef.current >= maxSlideRef.current * 0.78) {
      triggerConfirm(maxSlideRef.current);
    } else {
      offsetRef.current = 0;
      setOffsetPx(0);
    }
  }, [triggerConfirm]);

  useEffect(() => {
    measureMaxSlide();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureMaxSlide());
    ro.observe(track);
    return () => ro.disconnect();
  }, [measureMaxSlide]);

  // Attach window-level move/up/cancel listeners while dragging so slight vertical finger drift never drops the drag
  useEffect(() => {
    const onWindowPointerMove = (ev: PointerEvent) => {
      if (!draggingRef.current || activePointerIdRef.current !== ev.pointerId) return;
      updateDragPosition(ev.clientX);
    };
    const onWindowPointerUp = (ev: PointerEvent) => {
      if (!draggingRef.current || activePointerIdRef.current !== ev.pointerId) return;
      activePointerIdRef.current = null;
      finishDrag();
    };
    const onWindowPointerCancel = (ev: PointerEvent) => {
      if (!draggingRef.current || activePointerIdRef.current !== ev.pointerId) return;
      activePointerIdRef.current = null;
      // On mobile browsers, pointercancel can fire during touch gestures; keep touch tracking alive if active
      if (activeTouchIdRef.current === null) {
        finishDrag();
      }
    };
    const onWindowTouchMove = (ev: TouchEvent) => {
      if (!draggingRef.current || activeTouchIdRef.current === null) return;
      const touch = Array.from(ev.touches).find((t) => t.identifier === activeTouchIdRef.current);
      if (!touch) return;
      if (ev.cancelable) ev.preventDefault();
      updateDragPosition(touch.clientX);
    };
    const onWindowTouchEnd = (ev: TouchEvent) => {
      if (!draggingRef.current || activeTouchIdRef.current === null) return;
      const stillActive = Array.from(ev.touches).some(
        (t) => t.identifier === activeTouchIdRef.current,
      );
      if (!stillActive) {
        activeTouchIdRef.current = null;
        finishDrag();
      }
    };

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerCancel);
    window.addEventListener('touchmove', onWindowTouchMove, { passive: false });
    window.addEventListener('touchend', onWindowTouchEnd);
    window.addEventListener('touchcancel', onWindowTouchEnd);

    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerCancel);
      window.removeEventListener('touchmove', onWindowTouchMove);
      window.removeEventListener('touchend', onWindowTouchEnd);
      window.removeEventListener('touchcancel', onWindowTouchEnd);
    };
  }, [updateDragPosition, finishDrag]);

  const startDrag = (clientX: number) => {
    if (completedRef.current) return;
    if (!draggingRef.current) {
      measureMaxSlide();
      draggingRef.current = true;
      lastDetentRef.current = 0;
      startXRef.current = clientX - offsetRef.current;
      setIsDragging(true);
      hapticTap();
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (completedRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType !== 'touch') {
      activeTouchIdRef.current = null;
    }
    activePointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Window listeners handle tracking if capture is unsupported
    }
    startDrag(e.clientX);
  };

  // Fallback for mobile browsers where touchstart fires before/without pointer capture
  const handleTouchStart = (e: React.TouchEvent<HTMLButtonElement>) => {
    if (completedRef.current) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    activeTouchIdRef.current = touch.identifier;
    startDrag(touch.clientX);
  };

  const progress = Math.min(1, Math.max(0, offsetPx / Math.max(1, maxSlidePx)));

  return (
    <div
      ref={trackRef}
      data-testid="slide-to-evacuate-track"
      className="relative flex h-[62px] w-full touch-none select-none items-center overflow-hidden rounded-full border-2 border-white/85 bg-black/40 p-[4px] overscroll-x-contain"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none w-full pl-12 pr-2 text-center text-[10px] sm:text-xs font-extrabold tracking-[0.1em] sm:tracking-[0.14em] text-white whitespace-nowrap transition-opacity duration-150"
        style={{ opacity: Math.max(0.15, 1 - progress * 0.9) }}
      >
        SLIDE TO EVACUATE &gt;&gt;&gt;
      </span>

      <button
        type="button"
        aria-label="Slide to evacuate"
        onPointerDown={handlePointerDown}
        onTouchStart={handleTouchStart}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
            e.preventDefault();
            triggerConfirm(measureMaxSlide());
          }
        }}
        style={{
          transform: `translate3d(${offsetPx}px, 0, 0)`,
          transition: isDragging ? 'none' : 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className="absolute left-[4px] flex h-[52px] w-[52px] touch-none select-none cursor-grab items-center justify-center rounded-full bg-white text-[#B71C1C] shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:cursor-grabbing"
      >
        <ChevronsRight className="h-6 w-6 stroke-[2.75]" aria-hidden="true" />
      </button>
    </div>
  );
}
