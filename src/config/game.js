const TAKRAW_VERSION = '0.12.9';

/** Normalized athlete bonuses; both the simulation and club UI read this formula. */
function takrawAthleteEffects(stats = {}, definition = TAKRAW_CONFIG.athletes) {
  return Object.fromEntries(Object.entries(definition.bonus).map(([key, maximum]) =>
    [key, Math.max(0, Math.min(1, ((stats[key] ?? definition.base) - definition.base) /
      (definition.max - definition.base))) * maximum]));
}

const TAKRAW_CONFIG = Object.freeze({
  product: 'BLOOM TAKRAW',
  version: TAKRAW_VERSION,
  status: 'Candidate',
  simulation: { tickRate: 60, substeps: 2, aiRate: 15 },
  network: { namespace: 'bloom-takraw', seed: 7 },
  court: { halfLength: 6.7, halfWidth: 3.05, netHeight: 1.52 },
  // Team 0 coordinates; team 1 mirrors X/Z: receive, central set, front attack.
  formation: {
    receiver: { x: -4.7, z: 0.7 },
    setter: { x: -3.2, z: -1.25 },
    attacker: { x: -2.0, z: 1.3 },
  },
  rules: { contacts: 3, points: 15, deuce: 14, cap: 17, sets: 2, ready: 1.25, point: 2 },
  athletes: { base: 50, max: 100, bonus: {
    mobility: 0.10, jump: 0.02, power: 0.08, flexibility: 0.10,
    setting: 0.04, defense: 0.20, recovery: 0.15,
  } },
  physics: { groundToss: { receiveApex: 2.4, attackApex: 4.2 } },
  training: { ready: 1.1, retry: 2.2, timeout: 7,
    feed: { height: 2.4, rise: 1.5, offset: 0.65, lateral: 0.10 },
    guide: { preholdLead: 0.34, kickWindow: 0.08 },
  },
  ai: { receiveHeight: 0.75, kickHold: 0.34, jumpHold: 0.25,
    receive: { claimLead: 0.75, commitLead: 0.10, claimSlack: 0.25, coverDistance: 1.25, hysteresis: 0.16, braking: 0.18 },
    toss: { receiveOffset: 0.8, incomingOffset: 0.8, airContactHeight: 3.6,
      ground: { lead: 0.30, followThrough: 0.15, window: 0.45 },
      lowAttack: { minHeight: 2.65, maxHeight: 3.0, contactLead: 0.64, kickDelay: 0.16 },
      attack: { offset: 0.65, lateral: 0.10, positionRadius: 0.55, minLead: 0.16, maxLead: 0.65,
        checkLead: 0.60, kickDelay: 0.08, minHeight: 3.1, maxHeight: 3.7,
        preparation: { brakeLead: 0.30, driftRadius: 0.35, apexMargin: 0.30 } },
    },
  },
  visual: {
    receiveGuide: { groundHeight: 0.07, contactRadius: 0.10, contactMinPixels: 16, actorWidth: 0.38,
      colors: { ai: 0x9ad3e5, human: 0xd8f2ae }, opacity: { active: 0.8, waiting: 0.4 } },
    attackGuide: { maxLead: 1.6, groundHeight: 0.065, contactRadius: 0.10, contactMinPixels: 16,
      foot: { length: 0.28, width: 0.10, spacing: 0.22 },
      colors: { approach: 0xc0e2d8, ready: 0xfff0ba }, opacity: { approach: 0.50, ready: 0.94 } },
    camera: { fov: 48, distance: 9.5, elevation: 4.6, focusHeight: 1.6, focusAhead: 2.2,
      follow: 7, ballWeight: 0.28, maxLateral: 2.3, maxDistance: 20, frameMargin: 0.78,
      topInset: 120, narrowTopInset: 188, narrowWidth: 700, near: 0.1, far: 100,
      orbit: { sensitivity: 0.006, minPitch: 0.14, maxPitch: 1.13 } },
    colors: { ground: 0xece7d9, court: 0x467b6f, courtInset: 0x598c7d, line: 0xf6f0d9, home: 0x39b5b0, away: 0xeb785f, ball: 0xffcd61 },
  },
});

export { TAKRAW_VERSION, TAKRAW_CONFIG, takrawAthleteEffects };
