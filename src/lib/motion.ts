export const MOTION = {
  duration: {
    micro: 0.1,    // 100ms - micro-feedback, checkmarks, toggles
    fast: 0.12,    // 120ms - tab enters, press feedback
    base: 0.18,    // 180ms - dialogs, popovers enter
    exit: 0.12,    // 120ms - exits (60-70% of enter)
    drawer: 0.22,  // 220ms - slide-over drawers
  },
  ease: [0.16, 1, 0.3, 1] as const,
  spring: {
    snappy: { type: 'spring', stiffness: 500, damping: 35 } as const,
    drawer: { type: 'spring', stiffness: 380, damping: 32, mass: 0.8 } as const,
    pill: { type: 'spring', stiffness: 450, damping: 32, mass: 0.8 } as const,
    switch: { type: 'spring', stiffness: 600, damping: 35 } as const,
  },
};
