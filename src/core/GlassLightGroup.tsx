import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { probeMembersBackdropLight, probeMembersBackdropLightSteps, unionRect, type VisibleRect, type BackdropProbe } from './backdropProbe';
import { invalidateProbe, subscribeProbe, type ProbeTarget } from './backdropProbeScheduler';
import { INITIAL_GROUP_LIGHT_STATE, stepGroupLight, type GroupLightState } from './groupLight';
import { observeResize } from './observeResize';

/**
 * Stable registration channel. Kept apart from the light value so a mode flip
 * does not re-run every member's registration effect (which would briefly
 * empty the group).
 */
export const GlassLightGroupRegisterContext = createContext<
  ((el: HTMLElement) => () => void) | null
>(null);

/** Current group decision; null while unreadable (caller falls back to scheme). */
export const GlassLightGroupLightContext = createContext<boolean | null>(null);

export interface GlassLightGroupProps {
  children?: ReactNode;
}

function rectOf(el: HTMLElement): VisibleRect {
  const box = el.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

/**
 * Binds several `overLight='auto'` glass elements into one recognition group.
 * The group probes the region its members cover and applies a single Light/
 * Dark decision to all of them, so they never flicker against each other.
 * On top of the per-probe hysteresis, a new decision must hold for 200 ms
 * before it commits, which suppresses whole-group flapping at the luminance
 * threshold.
 *
 * Renders no DOM: it can wrap any set of siblings or descendants without
 * changing layout or CSS sibling selectors. An element with an explicit
 * `overLight={true|false}` still wins and opts itself out of the group.
 */
export function GlassLightGroup({ children }: GlassLightGroupProps) {
  const membersRef = useRef(new Set<HTMLElement>());
  const membersVersionRef = useRef(0);
  const stateRef = useRef<GroupLightState>(INITIAL_GROUP_LIGHT_STATE);
  const settleTimerRef = useRef(0);
  const [light, setLight] = useState<boolean | null>(null);

  const targetRef = useRef<ProbeTarget | null>(null);
  if (!targetRef.current) {
    const applyProbe = (probe: BackdropProbe | null) => {
      if (!probe) return;
      if (probe.averageLuminance === null) {
        stateRef.current = INITIAL_GROUP_LIGHT_STATE;
        setLight(null);
        return;
      }
      const step = stepGroupLight(stateRef.current, probe.averageLuminance, performance.now());
      stateRef.current = step.state;
      if (step.changed) setLight(step.state.committed);
      if (step.refireInMs !== null) {
        if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = 0;
          invalidateProbe(targetRef.current as ProbeTarget);
        }, step.refireInMs);
      }
    };
    targetRef.current = {
      get el() {
        for (const member of membersRef.current) {
          if (member.isConnected) return member;
        }
        return null;
      },
      region() {
        const rects: VisibleRect[] = [];
        for (const member of membersRef.current) {
          if (member.isConnected) rects.push(rectOf(member));
        }
        return unionRect(rects);
      },
      run() {
        if (typeof document !== 'undefined' && document.hidden) return;
        const members = [...membersRef.current].filter((member) => member.isConnected);
        if (!members.length) return;
        applyProbe(probeMembersBackdropLight(members));
      },
      *createTask() {
        if (document.hidden) return;
        const members = [...membersRef.current].filter(member => member.isConnected);
        if (!members.length) return;
        const version = membersVersionRef.current;
        const steps = probeMembersBackdropLightSteps(members);
        let step = steps.next();
        while (!step.done) {
          yield;
          if (version !== membersVersionRef.current || document.hidden) { steps.return(null); return; }
          step = steps.next();
        }
        if (!document.hidden) applyProbe(step.value);
      },
    };
  }

  useEffect(() => {
    const target = targetRef.current as ProbeTarget;
    const unsubscribe = subscribeProbe(target);
    return () => {
      unsubscribe();
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = 0;
    };
  }, []);

  const register = useCallback((el: HTMLElement) => {
    const members = membersRef.current;
    members.add(el);
    membersVersionRef.current++;
    const unobserve = observeResize(el, () => invalidateProbe(targetRef.current as ProbeTarget));
    invalidateProbe(targetRef.current as ProbeTarget);
    return () => {
      members.delete(el);
      membersVersionRef.current++;
      unobserve();
      if (!members.size) {
        stateRef.current = INITIAL_GROUP_LIGHT_STATE;
        setLight(null);
      }
      invalidateProbe(targetRef.current as ProbeTarget);
    };
  }, []);

  return (
    <GlassLightGroupRegisterContext.Provider value={register}>
      <GlassLightGroupLightContext.Provider value={light}>
        {children}
      </GlassLightGroupLightContext.Provider>
    </GlassLightGroupRegisterContext.Provider>
  );
}
