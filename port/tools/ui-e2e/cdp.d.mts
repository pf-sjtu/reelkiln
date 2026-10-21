export interface CdpTarget { id: string; type: string; url: string; webSocketDebuggerUrl: string }
export function listTargets(port: number, host?: string): Promise<CdpTarget[]>;
export function waitForPageTarget(port: number, o?: { timeoutMs?: number; match?: (t: CdpTarget) => boolean }): Promise<CdpTarget>;
export class Cdp {
  constructor(ws: any, log?: (o: any) => void);
  static connect(wsUrl: string, log?: (o: any) => void): Promise<Cdp>;
  static fromSocket(ws: any, log?: (o: any) => void): Cdp;
  closed?: boolean;
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  on(method: string, fn: (params: any) => void): () => void;
  eval(expression: string, o?: { awaitPromise?: boolean }): Promise<any>;
  close(): void;
}
export function mouseClick(cdp: Cdp, x: number, y: number, o?: { button?: string; clickCount?: number }): Promise<void>;
export function mouseMove(cdp: Cdp, x: number, y: number): Promise<void>;
export function typeText(cdp: Cdp, text: string): Promise<void>;
export function pressKey(cdp: Cdp, key: string, o?: { code?: string; keyCode?: number; modifiers?: number; text?: string }): Promise<void>;
export function dropFiles(cdp: Cdp, x: number, y: number, files: string[]): Promise<void>;
export function screenshot(cdp: Cdp): Promise<Buffer>;
