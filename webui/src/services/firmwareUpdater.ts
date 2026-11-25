/**
 * Firmware upload over the bootloader SCPI commands (docs/serial-api.md).
 *
 * The `.fwu` file is sent verbatim, 512 bytes per `BOOT:DATA <hex>` line,
 * pipelined in groups of 8 with at most 16 lines in flight. The bootloader
 * answers every line with `OK <bytes_total>`; after the last one `BOOT:STAT?`
 * reports DONE and the device resets itself.
 */

import { scpiClient, ScpiError, parseErr } from './scpiClient';
import { bytesToHex } from './hexConverter';

export const FWU_CHUNK_SIZE = 512;
/** Lines per Web Serial write. */
const GROUP_SIZE = 32;
/**
 * Lines sent ahead of the oldest unanswered reply. The bootloader NAKs the USB
 * endpoint while it flashes and answers lines in order, so a deep window only
 * keeps its input queue full; a timeout on any line still aborts the upload.
 */
const MAX_IN_FLIGHT = 256;

/** Byte offset of the second ESP32 slice (cookie + 0xA000); its erase takes seconds. */
const ESP_SLICE_BOUNDARY = 10 + 0xa000;
const SLOW_TIMEOUT_MS = 60_000;
const FAST_TIMEOUT_MS = 5_000;
const STAT_POLL_MS = 500;

export interface UploadProgress {
  bytesAcked: number;
  totalBytes: number;
}

export interface BootStatus {
  state: 'WAIT' | 'ESP' | 'STM' | 'DONE' | 'ERROR' | string;
  percent: number;
  bytesTotal: number;
  message: string;
}

export class FirmwareUploadError extends Error {
  readonly code: number | null;
  readonly msg: string;
  constructor(code: number | null, msg: string) {
    super(code !== null ? `ERR ${code}${msg ? `: ${msg}` : ''}` : msg);
    this.name = 'FirmwareUploadError';
    this.code = code;
    this.msg = msg;
  }
}

/** Timeout for the line covering [offset, offset + length). */
export function lineTimeoutMs(offset: number, length: number): number {
  if (offset === 0) return SLOW_TIMEOUT_MS; // first line: ESP32 slice erase
  const lo = ESP_SLICE_BOUNDARY - FWU_CHUNK_SIZE;
  const hi = ESP_SLICE_BOUNDARY + FWU_CHUNK_SIZE;
  const end = offset + length;
  if (end > lo && offset <= hi) return SLOW_TIMEOUT_MS; // second ESP32 slice erase
  return FAST_TIMEOUT_MS;
}

export function parseBootStatus(line: string): BootStatus | null {
  const m = line.match(/^([A-Z]+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*"((?:[^"]|"")*)")?/i);
  if (!m) return null;
  return {
    state: m[1].toUpperCase(),
    percent: parseInt(m[2], 10),
    bytesTotal: parseInt(m[3], 10),
    message: (m[4] ?? '').replace(/""/g, '"'),
  };
}

const parseOkBytes = (reply: string): number | null => {
  const m = reply.match(/^OK\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
};

const toUploadError = (error: unknown): FirmwareUploadError => {
  if (error instanceof FirmwareUploadError) return error;
  if (error instanceof ScpiError) return new FirmwareUploadError(error.code, error.msg);
  return new FirmwareUploadError(null, error instanceof Error ? error.message : String(error));
};

/**
 * Stream the image to the bootloader. Resolves once every line has been
 * acknowledged; rejects with FirmwareUploadError on the first `ERR`/timeout
 * (remaining in-flight lines are ignored).
 */
export async function uploadFirmware(
  image: Uint8Array,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const totalBytes = image.length;
  const chunkCount = Math.ceil(totalBytes / FWU_CHUNK_SIZE);
  if (chunkCount === 0) throw new FirmwareUploadError(null, 'Empty firmware file');

  let nextChunk = 0;
  let inFlight = 0;
  let bytesAcked = 0;
  let failure: FirmwareUploadError | null = null;
  const groups: Promise<void>[] = [];

  // Wakes the sender whenever a reply arrives (in-flight count changed).
  let wake: (() => void) | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const waitForReply = () => new Promise<void>((resolve) => { wake = resolve; });

  const sendGroup = () => {
    const lines: string[] = [];
    const timeouts: number[] = [];
    const first = nextChunk;
    while (nextChunk < chunkCount && lines.length < GROUP_SIZE) {
      const offset = nextChunk * FWU_CHUNK_SIZE;
      const chunk = image.subarray(offset, Math.min(offset + FWU_CHUNK_SIZE, totalBytes));
      lines.push(`BOOT:DATA ${bytesToHex(chunk)}`);
      timeouts.push(lineTimeoutMs(offset, chunk.length));
      nextChunk++;
    }
    inFlight += lines.length;

    const promises = scpiClient.sendBatch(lines, timeouts);
    const group = Promise.all(
      promises.map((p, i) =>
        p
          .then((reply) => {
            if (failure) return;
            const n = parseOkBytes(reply);
            if (n === null) {
              const err = parseErr(reply);
              failure =
                failure ??
                (err
                  ? new FirmwareUploadError(err.code, err.msg)
                  : new FirmwareUploadError(null, `Unexpected reply to line ${first + i + 1}: ${reply}`));
              return;
            }
            bytesAcked = Math.max(bytesAcked, n);
            onProgress({ bytesAcked, totalBytes });
          })
          .catch((error: unknown) => {
            failure = failure ?? toUploadError(error);
          })
          .finally(() => {
            inFlight--;
            notify();
          })
      )
    ).then(() => undefined);
    groups.push(group);
  };

  while (nextChunk < chunkCount) {
    if (failure) break;
    if (signal?.aborted) {
      failure = new FirmwareUploadError(null, 'Upload cancelled');
      break;
    }
    if (inFlight + GROUP_SIZE > MAX_IN_FLIGHT) {
      await waitForReply();
      continue;
    }
    sendGroup();
  }

  await Promise.all(groups);
  if (failure) throw failure;
  onProgress({ bytesAcked: Math.max(bytesAcked, totalBytes), totalBytes });
}

/**
 * Poll `BOOT:STAT?` until the bootloader reports DONE (or ERROR / the link drops).
 */
export async function waitForDone(
  onStatus: (s: BootStatus) => void,
  signal?: AbortSignal
): Promise<BootStatus> {
  for (;;) {
    if (signal?.aborted) throw new FirmwareUploadError(null, 'Cancelled');
    let reply: string;
    try {
      reply = await scpiClient.query('BOOT:STAT?', FAST_TIMEOUT_MS);
    } catch (error) {
      // A timeout / disconnect right after DONE is the device rebooting.
      if (error instanceof ScpiError) throw toUploadError(error);
      throw new FirmwareUploadError(null, error instanceof Error ? error.message : String(error));
    }
    const status = parseBootStatus(reply);
    if (!status) throw new FirmwareUploadError(null, `Unexpected BOOT:STAT? reply: ${reply}`);
    onStatus(status);
    if (status.state === 'DONE') return status;
    if (status.state === 'ERROR') throw new FirmwareUploadError(null, status.message || 'Bootloader reported ERROR');
    await new Promise((r) => setTimeout(r, STAT_POLL_MS));
  }
}
