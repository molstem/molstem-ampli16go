import { useEffect, useRef, useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SendIcon from '@mui/icons-material/Send';
import { useSerialStore } from '../stores/serialStore';
import { scpiClient } from '../services/scpiClient';

type LineKind = 'tx' | 'rx' | 'unsolicited' | 'error' | 'poll-tx' | 'poll-rx';

interface ConsoleLine {
  id: number;
  timestamp: Date;
  data: string;
  kind: LineKind;
}

const MAX_LINES = 200;

/**
 * Escape non-printable characters for display (excluding \r which we ignore)
 */
const escapeNonPrintable = (str: string): string => {
  return str.split('').map(char => {
    const code = char.charCodeAt(0);

    // Printable ASCII characters (space to tilde)
    if (code >= 32 && code <= 126) {
      return char;
    }

    // Common escape sequences
    switch (code) {
      case 9: return '\\t';   // Tab
      case 10: return '\\n';  // Line feed (shown but handled separately)
      case 13: return '';     // Carriage return - ignore completely
      case 27: return '\\e';  // Escape
      default:
        // Show as hex for other non-printable characters
        return `\\x${code.toString(16).padStart(2, '0')}`;
    }
  }).join('');
};

const LINE_STYLE: Record<LineKind, { color: string; prefix: string; opacity?: number }> = {
  tx: { color: '#1e88e5', prefix: '> ' },
  rx: { color: '#0a0', prefix: '< ' },
  unsolicited: { color: '#e6a100', prefix: '! ' },
  error: { color: '#d32f2f', prefix: '< ' },
  'poll-tx': { color: '#1e88e5', prefix: '> ', opacity: 0.45 },
  'poll-rx': { color: '#0a0', prefix: '< ', opacity: 0.45 },
};

export const SerialIO: React.FC = () => {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [showPolling, setShowPolling] = useState(false);
  const [sending, setSending] = useState(false);
  const isConnected = useSerialStore((state) => state.isConnected);
  const logEndRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(1);
  // Lines we sent ourselves, so the traffic listener can skip echoing them.
  const ownLinesRef = useRef(new Set<string>());

  const appendLine = (data: string, kind: LineKind) => {
    const line: ConsoleLine = { id: nextIdRef.current++, timestamp: new Date(), data, kind };
    setLines((prev) => [...prev, line].slice(-MAX_LINES));
  };

  // Auto-scroll to bottom when new data arrives
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  // Lines that arrive with no request pending (should not happen; shown for diagnosis)
  useEffect(() => {
    if (!isConnected) return;
    return scpiClient.onUnsolicited((line) => appendLine(line, 'unsolicited'));
  }, [isConnected]);

  // Optionally mirror the poller traffic (dimmed)
  useEffect(() => {
    if (!isConnected || !showPolling) return;
    return scpiClient.onTraffic((direction, line, request) => {
      if (direction === 'tx' && ownLinesRef.current.has(line)) return; // shown by handleSend
      if (direction === 'rx') {
        if (request === undefined) return; // unsolicited, shown by the other listener
        if (ownLinesRef.current.has(request)) return; // reply to our own line
      }
      appendLine(line, direction === 'tx' ? 'poll-tx' : 'poll-rx');
    });
  }, [isConnected, showPolling]);

  const handleSend = async () => {
    const request = input.replace(/[\r\n]+/g, '').trim();
    if (!request || !isConnected || sending) return;

    setInput('');
    setHistory((prev) => [...prev.filter((h) => h !== request), request].slice(-50));
    setHistoryIndex(-1);
    setSending(true);
    ownLinesRef.current.add(request);
    appendLine(request, 'tx');
    try {
      const reply = await scpiClient.send(request, 5000);
      appendLine(reply, /^ERR\b/i.test(reply) ? 'error' : 'rx');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLine(`(no reply: ${message})`, 'error');
    } finally {
      ownLinesRef.current.delete(request);
      setSending(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleSend();
    } else if (event.key === 'ArrowUp' && history.length > 0) {
      event.preventDefault();
      const next = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setInput(history[next]);
    } else if (event.key === 'ArrowDown' && historyIndex >= 0) {
      event.preventDefault();
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(-1);
        setInput('');
      } else {
        setHistoryIndex(next);
        setInput(history[next]);
      }
    }
  };

  const handleClear = () => {
    setLines([]);
  };

  const formatTimestamp = (date: Date): string => {
    const time = date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const ms = date.getMilliseconds().toString().padStart(3, '0');
    return `${time}.${ms}`;
  };

  return (
    <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={showPolling}
              onChange={(e) => setShowPolling(e.target.checked)}
            />
          }
          label={<Typography variant="caption">Show polling traffic</Typography>}
        />
        <Button
          size="small"
          variant="outlined"
          color="secondary"
          onClick={handleClear}
          startIcon={<DeleteIcon />}
        >
          Clear
        </Button>
      </Box>

      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1a1a1a' : '#f5f5f5',
          border: (theme) => `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
          p: 1,
          fontFamily: 'monospace',
          fontSize: '0.8rem',
        }}
      >
        {!isConnected ? (
          <Typography color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Not connected. Send a command once a device is connected.
          </Typography>
        ) : lines.length === 0 ? (
          <Typography color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Type a command below (e.g. *IDN? or STAT?) and press Enter.
          </Typography>
        ) : (
          lines.map((line) => {
            const style = LINE_STYLE[line.kind];
            return (
              <Box
                key={line.id}
                sx={{
                  mb: 0.5,
                  wordBreak: 'break-all',
                  whiteSpace: 'pre-wrap',
                  opacity: style.opacity ?? 1,
                }}
              >
                <span style={{ color: '#666' }}>[{formatTimestamp(line.timestamp)}]</span>{' '}
                <span style={{ color: style.color }}>{style.prefix}{escapeNonPrintable(line.data)}</span>
              </Box>
            );
          })
        )}
        <div ref={logEndRef} />
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="SCPI command, e.g. *IDN?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isConnected}
          inputProps={{ style: { fontFamily: 'monospace' }, spellCheck: false }}
        />
        <Button
          variant="contained"
          size="small"
          onClick={() => void handleSend()}
          disabled={!isConnected || sending || !input.trim()}
          startIcon={<SendIcon />}
        >
          Send
        </Button>
      </Box>

      <Typography variant="caption" sx={{ mt: 1, color: 'text.secondary' }}>
        Requests are sent through the SCPI client (one reply per line, see docs/serial-api.md).
        \r is ignored; other non-printable chars are escaped (e.g., \t, \xHH). Up/Down recall history.
      </Typography>
    </Box>
  );
};
