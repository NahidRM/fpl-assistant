// Positions as FPL numbers them.
export const GK = 1;
export const DEF = 2;
export const MID = 3;
export const FWD = 4;

export const SHRINK_K = 400;          // minutes of league-average mixed in (spec 6.1)
export const SHRINK_K_MATCHES = 1;    // matches of prior for the minutes estimate (spec 6.2)
export const STARTER_MINUTES = 85;    // typical minutes for a player who starts
export const CS_CALIBRATION = 0.93;   // corrects the measured -9% clean-sheet bias (D26)

export const GOAL_POINTS  = { [GK]: 6, [DEF]: 6, [MID]: 5, [FWD]: 4 };
export const CS_POINTS    = { [GK]: 4, [DEF]: 4, [MID]: 1, [FWD]: 0 };

// null = position earns no DefCon points. Verified for goalkeepers (D28).
export const DEFCON_THRESHOLD = { [GK]: null, [DEF]: 10, [MID]: 12, [FWD]: 12 };

// Negative binomial dispersion, fitted from measured variance-to-mean (spec 13.7).
// Infinity falls back to Poisson: forwards measured 0.93, i.e. not overdispersed.
export const DEFCON_DISPERSION = { [GK]: Infinity, [DEF]: 5.79, [MID]: 10.21, [FWD]: Infinity };

export const COMPONENTS = ['attack', 'defence', 'minutes', 'fixture', 'form', 'setPieces'];

// Default slider weights, per spec 6.9. Each column sums to 100.
export const DEFAULT_WEIGHTS = {
  [GK]:  { attack: 0,  defence: 45, minutes: 20, fixture: 10, form: 25, setPieces: 0 },
  [DEF]: { attack: 10, defence: 30, minutes: 20, fixture: 10, form: 15, setPieces: 15 },
  [MID]: { attack: 35, defence: 5,  minutes: 20, fixture: 15, form: 15, setPieces: 10 },
  [FWD]: { attack: 40, defence: 0,  minutes: 20, fixture: 15, form: 15, setPieces: 10 },
};

export const SET_PIECE_WEIGHTS = [
  ['penalties_order', 1.0],
  ['direct_freekicks_order', 0.5],
  ['corners_order', 0.3],
];

export const POSITION_NAMES = { [GK]: 'Goalkeepers', [DEF]: 'Defenders', [MID]: 'Midfielders', [FWD]: 'Forwards' };
export const FIXTURE_HORIZONS = [3, 5, 8];
export const DEFAULT_HORIZON = 5;
export const NOISY_UNTIL_GAMEWEEK = 6;   // sample-size banner threshold (spec 7)
