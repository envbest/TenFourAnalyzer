export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type ActionKind = 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'return';
/** All amounts are integer hundredths of a big blind. */
export interface Player { seat: number; name: string; position: string; cards: string[]; start: number | null; uid?: string }
export interface Action { street: Street; seat: number; kind: ActionKind; amount: number; to?: number; allIn?: boolean }
export interface Hand {
  id: string; sourceId: string | null; tableId: string; mode: 'normal' | 'expert' | 'private';
  startedAt: number; updatedAt: number; heroSeat: number | null; button: number | null;
  players: Player[]; board: string[]; actions: Action[]; payouts: {seat:number;amount:number}[];
  rake: number | null; smallBlind: number | null; bigBlind: number | null;
  status: 'recording' | 'incomplete' | 'complete'; issues: string[]; warnings: string[];
  rawLines: string[]; profit: number | null; demo?: boolean;
  revealedAt?: number;
  historyCompletedAt?: number;
  connection?: string;
  /** Last directly observed stacks before settlement resets the table. */
  observedStacks?: {seat:number;amount:number|null}[];
}
export interface Capture { id: string; event: string; payload: unknown; at: number; connection: string; sequence?: number }
export interface Annotation { id: string; bookmark: boolean; note: string }
export interface RecorderStatus { lastSeen: number; lastSaved: number; error: string | null; enabled: boolean; events: number }
export const money = (x:number) => (x / 100).toLocaleString('en-US', {maximumFractionDigits:2});
export function units(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 1e8) return null;
  const n=Math.round(x*100); return Math.abs(x*100-n)<0.00001 ? n : null;
}
export const cards = (x:unknown):string[] => Array.isArray(x) ? x.filter((c):c is string=>typeof c==='string' && /^[2-9TJQKA][cdhs]$/.test(c)) : [];
