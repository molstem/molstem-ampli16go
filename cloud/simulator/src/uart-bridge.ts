import { EventEmitter } from 'events';

/**
 * Simulates the STM32 application's SCPI-style serial responder as seen
 * through the cloud device socket (docs/serial-api.md).
 *
 * Text lines received from the WebSocket are treated as requests; every
 * non-empty request yields exactly one "\n"-terminated reply line, emitted as
 * a 'data' event. Nothing is ever sent unsolicited.
 *
 * Only the CLOUD transport scope is implemented: `HW?`, `LCD?` and `INP:*`
 * answer `ERR 100` exactly like a real cloud-connected device would.
 */

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

const MAX_LINE_BYTES = 256;
const MAX_NAME_LEN = 32;
const MAX_COMMENT_LEN = 64;

type Phase =
  | 'LID_PREHEAT'
  | 'INTRO_DENATURING'
  | 'DENATURING'
  | 'ANNEALING'
  | 'EXTENSION'
  | 'FINAL_EXTENSION'
  | 'COMPLETED'
  | 'ABORTING';

interface StageDef {
  temp: number;
  time: number;
}

interface StageLimits {
  minTemp: number;
  maxTemp: number;
  minTime: number;
  maxTime: number;
}

/** Same limits as the LCD editor (firmware/App/molstem/v2/pcr.cpp). */
const STAGE_LIMITS: Record<StageKey, StageLimits> = {
  intro: { minTemp: 20, maxTemp: 100, minTime: 10, maxTime: 600 },
  den: { minTemp: 20, maxTemp: 100, minTime: 1, maxTime: 60 },
  ann: { minTemp: 20, maxTemp: 100, minTime: 5, maxTime: 60 },
  ext: { minTemp: 20, maxTemp: 100, minTime: 1, maxTime: 300 },
  fin: { minTemp: 20, maxTemp: 100, minTime: 10, maxTime: 300 },
};
const MIN_CYCLES = 1;
const MAX_CYCLES = 50;

type StageKey = 'intro' | 'den' | 'ann' | 'ext' | 'fin';
const STAGE_ORDER: StageKey[] = ['intro', 'den', 'ann', 'ext', 'fin'];
const STAGE_PHASE: Record<StageKey, Phase> = {
  intro: 'INTRO_DENATURING',
  den: 'DENATURING',
  ann: 'ANNEALING',
  ext: 'EXTENSION',
  fin: 'FINAL_EXTENSION',
};
const STAGE_LABEL: Record<StageKey, string> = {
  intro: 'intro denaturing',
  den: 'denaturing',
  ann: 'annealing',
  ext: 'extension',
  fin: 'final extension',
};

export interface ProtocolDefinition {
  name: string;
  comment: string;
  cycles: number;
  stages: Record<StageKey, StageDef>;
}

const DEFAULT_PROTOCOL: ProtocolDefinition = {
  name: '',
  comment: '',
  cycles: 5,
  stages: {
    intro: { temp: 95, time: 10 },
    den: { temp: 95, time: 10 },
    ann: { temp: 60, time: 10 },
    ext: { temp: 72, time: 10 },
    fin: { temp: 72, time: 10 },
  },
};

// ---------------------------------------------------------------------------
// Tokenizer (mirrors the firmware rules in docs/serial-api.md, "Framing")
// ---------------------------------------------------------------------------

export interface ParsedRequest {
  header: string; // upper-cased
  args: string[];
}

/**
 * Split `<HEADER>[ <arg>[,<arg>...]]` into header + arguments.
 *  - header ends at the first space
 *  - arguments are comma separated
 *  - a "quoted" argument may contain commas and spaces; "" is a literal quote
 *  - unquoted arguments are trimmed
 * Returns null when the quoting is malformed.
 */
export function parseRequest(line: string): ParsedRequest | null {
  const trimmed = line.trim();
  const space = trimmed.indexOf(' ');
  const header = (space < 0 ? trimmed : trimmed.substring(0, space)).toUpperCase();
  const rest = space < 0 ? '' : trimmed.substring(space + 1);

  if (rest.trim() === '') {
    return { header, args: [] };
  }

  const args: string[] = [];
  let i = 0;
  const n = rest.length;

  while (i <= n) {
    // Skip leading whitespace of the argument
    while (i < n && (rest[i] === ' ' || rest[i] === '\t')) i++;

    if (i < n && rest[i] === '"') {
      // Quoted argument
      i++;
      let value = '';
      let closed = false;
      while (i < n) {
        const c = rest[i];
        if (c === '"') {
          if (i + 1 < n && rest[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        value += c;
        i++;
      }
      if (!closed) return null;
      // Skip trailing whitespace up to the delimiter
      while (i < n && (rest[i] === ' ' || rest[i] === '\t')) i++;
      if (i < n && rest[i] !== ',') return null; // junk after closing quote
      args.push(value);
      i++; // consume ',' (or step past end)
    } else {
      // Unquoted argument: up to the next comma
      let end = rest.indexOf(',', i);
      if (end < 0) end = n;
      args.push(rest.substring(i, end).trim());
      i = end + 1;
    }
  }

  return { header, args };
}

/** Quote a string per the protocol rules (embedded quotes doubled). */
function quote(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function err(code: number, message: string): string {
  return `ERR ${code},${quote(message)}`;
}

function fmtTemp(t: number): string {
  return t.toFixed(1);
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

interface RunState {
  protocol: ProtocolDefinition;
  phase: Phase;
  cycle: number; // 1-based
  stageIndex: number; // index into STAGE_ORDER
  stageRemaining: number; // seconds left once the target is reached
  atTarget: boolean;
  elapsed: number; // seconds since PROT:STAR
  total: number; // planned run length in seconds (excluding ramps)
  peltierTarget: number | null;
  lidTarget: number | null;
  completedAt: number | null; // tick count when COMPLETED entered
}

export class UartBridge extends EventEmitter {
  private serial: string;
  private lineBuffer = '';
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  // Thermal model
  private ambient = 25.0;
  private peltierTemp = 25.0;
  private lidTemp = 25.0;

  private protocol: ProtocolDefinition = structuredClone(DEFAULT_PROTOCOL);
  private run: RunState | null = null;

  constructor(serial = 'SIMULATOR') {
    super();
    this.serial = serial;
  }

  /** Begin the 1 Hz simulation tick. */
  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), 1000);
    console.log('[UartBridge] Started simulation');
  }

  /** Stop the simulation tick (state is preserved). */
  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
      console.log('[UartBridge] Stopped simulation');
    }
  }

  get isRunning(): boolean {
    return this.run !== null;
  }

  /**
   * Handle raw bytes received from the WebSocket. Lines are split on "\n"
   * ("\r" ignored); each non-empty line produces exactly one reply line.
   */
  receiveFromWebSocket(data: Buffer): void {
    this.lineBuffer += data.toString('utf-8');

    let nl: number;
    while ((nl = this.lineBuffer.indexOf('\n')) >= 0) {
      const line = this.lineBuffer.substring(0, nl);
      this.lineBuffer = this.lineBuffer.substring(nl + 1);
      this.handleLine(line);
    }

    // A frame without a trailing newline is still a complete request over the
    // socket transport (the ESP32 delivers whole lines), so flush it too.
    if (this.lineBuffer.length > 0) {
      const line = this.lineBuffer;
      this.lineBuffer = '';
      this.handleLine(line);
    }
  }

  private handleLine(rawLine: string): void {
    const line = rawLine.replace(/\r/g, '');
    if (line.trim() === '') return; // empty requests produce no reply

    console.log(`[UartBridge] RX ${line}`);
    const reply = this.processLine(line);
    console.log(`[UartBridge] TX ${reply}`);
    this.emit('data', Buffer.from(reply + '\n', 'utf-8'));
  }

  /** Process one request line and return the reply line (no terminator). */
  processLine(line: string): string {
    if (Buffer.byteLength(line, 'utf-8') > MAX_LINE_BYTES) {
      return err(101, 'line too long');
    }

    const req = parseRequest(line);
    if (!req) {
      return err(103, 'bad argument value');
    }

    const { header, args } = req;

    switch (header) {
      case '*IDN?':
        return `molstem,thermocycler,${this.serial},simulator`;

      case '*RST':
        this.resetState();
        return 'OK';

      case 'STAT?':
        return this.run ? 'RUNNING' : 'IDLE';

      case 'PROT:STAR':
        return this.cmdProtocolStart(args);

      case 'PROT:STOP':
        if (!this.run) return err(201, 'not running');
        this.abortRun();
        return 'OK';

      case 'PROT:CYCL?':
        if (!this.run) return err(201, 'not running');
        return this.formatCycle(this.run);

      case 'PROT:DEF?':
        return this.formatDefinition(this.protocol);

      // USB / LOCAL only commands: not available on the cloud transport.
      case 'HW?':
      case 'LCD?':
      case 'INP:UP':
      case 'INP:DOWN':
      case 'INP:PRESS':
        return err(100, 'unknown command');

      default:
        return err(100, 'unknown command');
    }
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  private cmdProtocolStart(args: string[]): string {
    // "<name>","<comment>",cycles,introT,introS,denT,denS,annT,annS,extT,extS,finT,finS
    if (args.length !== 13) {
      return err(102, 'bad argument count');
    }
    if (this.run) {
      return err(200, 'not idle');
    }

    const name = args[0];
    const comment = args[1];
    if (name.length > MAX_NAME_LEN || comment.length > MAX_COMMENT_LEN) {
      return err(104, 'name/comment too long');
    }

    const nums: number[] = [];
    for (let i = 2; i < 13; i++) {
      const s = args[i];
      if (s === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
        return err(103, 'bad argument value');
      }
      nums.push(Number(s));
    }

    const cycles = nums[0];
    if (!Number.isInteger(cycles)) {
      return err(103, 'bad argument value');
    }
    if (cycles < MIN_CYCLES || cycles > MAX_CYCLES) {
      return err(104, 'cycles out of range');
    }

    const stages = {} as Record<StageKey, StageDef>;
    STAGE_ORDER.forEach((key, idx) => {
      stages[key] = { temp: nums[1 + idx * 2], time: nums[2 + idx * 2] };
    });

    for (const key of STAGE_ORDER) {
      const lim = STAGE_LIMITS[key];
      const st = stages[key];
      if (!Number.isInteger(st.time)) {
        return err(103, 'bad argument value');
      }
      if (st.temp < lim.minTemp || st.temp > lim.maxTemp) {
        return err(104, `${STAGE_LABEL[key]} temp out of range`);
      }
      if (st.time < lim.minTime || st.time > lim.maxTime) {
        return err(104, `${STAGE_LABEL[key]} time out of range`);
      }
    }

    this.protocol = { name, comment, cycles, stages };
    this.beginRun(this.protocol);
    return 'OK';
  }

  private formatCycle(run: RunState): string {
    // <phase>,<cycle>,<total_cycles>,<remaining>,<peltierT>,<peltierTarget>,
    // <lidT>,<lidTarget>,<elapsed_s>,<total_s>
    let remaining: string;
    if (run.phase === 'LID_PREHEAT') {
      remaining = 'HEATING_LID';
    } else if (run.phase === 'COMPLETED' || run.phase === 'ABORTING') {
      remaining = '0';
    } else if (!run.atTarget && run.peltierTarget !== null) {
      remaining = this.peltierTemp < run.peltierTarget ? 'HEATING' : 'COOLING';
    } else {
      remaining = String(Math.max(0, Math.ceil(run.stageRemaining)));
    }

    const fields = [
      run.phase,
      String(run.cycle),
      String(run.protocol.cycles),
      remaining,
      fmtTemp(this.peltierTemp),
      run.peltierTarget === null ? 'NONE' : fmtTemp(run.peltierTarget),
      fmtTemp(this.lidTemp),
      run.lidTarget === null ? 'NONE' : fmtTemp(run.lidTarget),
      String(Math.floor(run.elapsed)),
      String(run.total),
    ];
    return fields.join(',');
  }

  private formatDefinition(p: ProtocolDefinition): string {
    const parts = [quote(p.name), quote(p.comment), String(p.cycles)];
    for (const key of STAGE_ORDER) {
      parts.push(fmtTemp(p.stages[key].temp), String(p.stages[key].time));
    }
    return parts.join(',');
  }

  // -------------------------------------------------------------------------
  // Run simulation
  // -------------------------------------------------------------------------

  private static planTotal(p: ProtocolDefinition): number {
    const s = p.stages;
    return (
      s.intro.time + p.cycles * (s.den.time + s.ann.time + s.ext.time) + s.fin.time
    );
  }

  private beginRun(protocol: ProtocolDefinition): void {
    this.run = {
      protocol,
      phase: 'LID_PREHEAT',
      cycle: 1,
      stageIndex: 0,
      stageRemaining: 0,
      atTarget: false,
      elapsed: 0,
      total: UartBridge.planTotal(protocol),
      peltierTarget: null,
      lidTarget: 105.0,
      completedAt: null,
    };
    console.log(
      `[UartBridge] Protocol started: "${protocol.name}" ${protocol.cycles} cycles, ${this.run.total}s`
    );
  }

  private abortRun(): void {
    if (!this.run) return;
    console.log('[UartBridge] Protocol aborted');
    // The real device answers OK and returns to the home screen, so the very
    // next STAT? already reports IDLE; temperatures relax toward ambient.
    this.run = null;
  }

  private resetState(): void {
    this.run = null;
    this.protocol = structuredClone(DEFAULT_PROTOCOL);
    this.lineBuffer = '';
  }

  private enterStage(run: RunState, stageIndex: number): void {
    const key = STAGE_ORDER[stageIndex];
    run.stageIndex = stageIndex;
    run.phase = STAGE_PHASE[key];
    run.peltierTarget = run.protocol.stages[key].temp;
    run.stageRemaining = run.protocol.stages[key].time;
    run.atTarget = Math.abs(this.peltierTemp - run.peltierTarget) <= 1.0;
  }

  /** 1 Hz thermal + sequencing tick. */
  private tick(): void {
    const run = this.run;

    // Targets: while idle everything relaxes toward ambient.
    const peltierTarget = run?.peltierTarget ?? this.ambient;
    const lidTarget = run?.lidTarget ?? this.ambient;

    // Simple first-order dynamics (time constant ~5 s peltier, ~20 s lid)
    // plus a little measurement noise.
    this.peltierTemp += (peltierTarget - this.peltierTemp) * 0.2;
    this.lidTemp += (lidTarget - this.lidTemp) * 0.05;
    this.peltierTemp += (Math.random() - 0.5) * 0.1;
    this.lidTemp += (Math.random() - 0.5) * 0.1;

    if (!run) return;

    run.elapsed += 1;

    switch (run.phase) {
      case 'LID_PREHEAT': {
        if (run.lidTarget !== null && this.lidTemp >= run.lidTarget - 2.0) {
          this.enterStage(run, 0);
        }
        break;
      }

      case 'INTRO_DENATURING':
      case 'DENATURING':
      case 'ANNEALING':
      case 'EXTENSION':
      case 'FINAL_EXTENSION': {
        if (run.peltierTarget === null) break;
        if (!run.atTarget) {
          if (Math.abs(this.peltierTemp - run.peltierTarget) <= 1.0) {
            run.atTarget = true;
          }
          break;
        }
        run.stageRemaining -= 1;
        if (run.stageRemaining > 0) break;
        this.advanceStage(run);
        break;
      }

      case 'COMPLETED': {
        // Linger a few seconds so pollers can observe completion, then go IDLE.
        if (run.completedAt === null) run.completedAt = run.elapsed;
        if (run.elapsed - run.completedAt >= 3) {
          console.log('[UartBridge] Protocol completed');
          this.run = null;
        }
        break;
      }

      case 'ABORTING':
        this.run = null;
        break;
    }
  }

  private advanceStage(run: RunState): void {
    const key = STAGE_ORDER[run.stageIndex];
    switch (key) {
      case 'intro':
        this.enterStage(run, 1); // denaturing
        break;
      case 'den':
        this.enterStage(run, 2); // annealing
        break;
      case 'ann':
        this.enterStage(run, 3); // extension
        break;
      case 'ext':
        if (run.cycle < run.protocol.cycles) {
          run.cycle += 1;
          this.enterStage(run, 1); // back to denaturing
        } else {
          this.enterStage(run, 4); // final extension
        }
        break;
      case 'fin':
        run.phase = 'COMPLETED';
        run.peltierTarget = null;
        run.lidTarget = null;
        run.stageRemaining = 0;
        run.completedAt = run.elapsed;
        break;
    }
  }
}
