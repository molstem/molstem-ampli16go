import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useSerialStore } from '../stores/serialStore';
import { useTelemetryStore, type HwPoint } from '../stores/telemetryStore';

/**
 * Data comes from the `HW?` poll (USB only, 5 Hz) via the telemetry store.
 * Over the local WebSocket and cloud links `HW?` is not available and this
 * panel shows a notice instead.
 */
type DebugDataPoint = HwPoint;

const num = (v: number | null): number => (v === null ? NaN : v);

// Helper functions to convert data to uPlot format with 60s window padding
const WINDOW_DURATION_MS = 60000; // 60 seconds in milliseconds

const convertTempDataToUplot = (data: DebugDataPoint[]): uPlot.AlignedData => {
  const timestamps: number[] = [];
  const peltierTempFiltered: (number | null)[] = [];
  const peltierTempTarget: (number | null)[] = [];
  const lidTempFiltered: (number | null)[] = [];
  const lidTempTarget: (number | null)[] = [];

  if (data.length === 0) {
    return [[], [], [], [], []];
  }

  const firstTimestamp = data[0].t;
  const lastTimestamp = data[data.length - 1].t;
  const dataSpan = lastTimestamp - firstTimestamp;

  // Add actual data, treating -1 (disabled) as null for target values
  for (const point of data) {
    timestamps.push(point.t);
    peltierTempFiltered.push(point.peltierTemp);
    peltierTempTarget.push(point.peltierTempTarget === -1 ? null : point.peltierTempTarget);
    lidTempFiltered.push(point.lidTemp);
    lidTempTarget.push(point.lidTempTarget === -1 ? null : point.lidTempTarget);
  }

  // If the data span is less than 60 seconds, add one padding point at 60s mark
  if (dataSpan < WINDOW_DURATION_MS) {
    timestamps.push(firstTimestamp + WINDOW_DURATION_MS);
    peltierTempFiltered.push(null);
    peltierTempTarget.push(null);
    lidTempFiltered.push(null);
    lidTempTarget.push(null);
  }

  return [timestamps, peltierTempFiltered, peltierTempTarget, lidTempFiltered, lidTempTarget];
};

const convertTempErrorDataToUplot = (data: DebugDataPoint[]): uPlot.AlignedData => {
  const timestamps: number[] = [];
  const tempError: (number | null)[] = [];

  if (data.length === 0) {
    return [[], []];
  }

  const firstTimestamp = data[0].t;
  const lastTimestamp = data[data.length - 1].t;
  const dataSpan = lastTimestamp - firstTimestamp;

  // Add actual data - error = target - current (null if target is disabled)
  for (const point of data) {
    timestamps.push(point.t);
    if (point.peltierTempTarget === null || point.peltierTemp === null || point.peltierTempTarget === -1) {
      tempError.push(null);
    } else {
      tempError.push(point.peltierTempTarget - point.peltierTemp);
    }
  }

  // If the data span is less than 60 seconds, add one padding point at 60s mark
  if (dataSpan < WINDOW_DURATION_MS) {
    timestamps.push(firstTimestamp + WINDOW_DURATION_MS);
    tempError.push(null);
  }

  return [timestamps, tempError];
};

const convertCurrentDataToUplot = (data: DebugDataPoint[]): uPlot.AlignedData => {
  const timestamps: number[] = [];
  const peltierCurrentFiltered: (number | null)[] = [];
  const peltierCurrentTarget: (number | null)[] = [];
  const lidCurrentFiltered: (number | null)[] = [];

  if (data.length === 0) {
    return [[], [], [], []];
  }

  const firstTimestamp = data[0].t;
  const lastTimestamp = data[data.length - 1].t;
  const dataSpan = lastTimestamp - firstTimestamp;

  // Add actual data, treating -1 (disabled) as null for target values
  for (const point of data) {
    timestamps.push(point.t);
    peltierCurrentFiltered.push(point.peltierCurrent);
    peltierCurrentTarget.push(point.peltierCurrentTarget === -1 ? null : point.peltierCurrentTarget);
    lidCurrentFiltered.push(point.lidCurrent);
  }

  // If the data span is less than 60 seconds, add one padding point at 60s mark
  if (dataSpan < WINDOW_DURATION_MS) {
    timestamps.push(firstTimestamp + WINDOW_DURATION_MS);
    peltierCurrentFiltered.push(null);
    peltierCurrentTarget.push(null);
    lidCurrentFiltered.push(null);
  }

  return [timestamps, peltierCurrentFiltered, peltierCurrentTarget, lidCurrentFiltered];
};

const convertVoltageDataToUplot = (data: DebugDataPoint[]): uPlot.AlignedData => {
  const timestamps: number[] = [];
  const voltageTarget: (number | null)[] = [];
  const dutyCycle: (number | null)[] = [];

  if (data.length === 0) {
    return [[], [], []];
  }

  const firstTimestamp = data[0].t;
  const lastTimestamp = data[data.length - 1].t;
  const dataSpan = lastTimestamp - firstTimestamp;

  // Add actual data
  for (const point of data) {
    timestamps.push(point.t);
    voltageTarget.push(point.hbridgeVoltageTarget);
    dutyCycle.push(point.hbridgeDuty);
  }

  // If the data span is less than 60 seconds, add one padding point at 60s mark
  if (dataSpan < WINDOW_DURATION_MS) {
    timestamps.push(firstTimestamp + WINDOW_DURATION_MS);
    voltageTarget.push(null);
    dutyCycle.push(null);
  }

  return [timestamps, voltageTarget, dutyCycle];
};

const convertPidDataToUplot = (data: DebugDataPoint[]): uPlot.AlignedData => {
  const timestamps: number[] = [];
  const pidP: (number | null)[] = [];
  const pidI: (number | null)[] = [];
  const pidD: (number | null)[] = [];

  if (data.length === 0) {
    return [[], [], [], []];
  }

  const firstTimestamp = data[0].t;
  const lastTimestamp = data[data.length - 1].t;
  const dataSpan = lastTimestamp - firstTimestamp;

  // Add actual data
  for (const point of data) {
    timestamps.push(point.t);
    pidP.push(point.pidP);
    pidI.push(point.pidI);
    pidD.push(point.pidD);
  }

  // If the data span is less than 60 seconds, add one padding point at 60s mark
  if (dataSpan < WINDOW_DURATION_MS) {
    timestamps.push(firstTimestamp + WINDOW_DURATION_MS);
    pidP.push(null);
    pidI.push(null);
    pidD.push(null);
  }

  return [timestamps, pidP, pidI, pidD];
};

export const HardwareMonitorPlot: React.FC = () => {
  const data = useTelemetryStore((state) => state.hwHistory);
  const transport = useTelemetryStore((state) => state.transport);
  const isConnected = useSerialStore((state) => state.isConnected);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const tempContainerRef = useRef<HTMLDivElement>(null);
  const tempErrorContainerRef = useRef<HTMLDivElement>(null);
  const currentContainerRef = useRef<HTMLDivElement>(null);
  const voltageContainerRef = useRef<HTMLDivElement>(null);
  const pidContainerRef = useRef<HTMLDivElement>(null);
  const tempPlotRef = useRef<uPlot | null>(null);
  const tempErrorPlotRef = useRef<uPlot | null>(null);
  const currentPlotRef = useRef<uPlot | null>(null);
  const voltagePlotRef = useRef<uPlot | null>(null);
  const pidPlotRef = useRef<uPlot | null>(null);
  const [plotSize, setPlotSize] = useState({ width: 800, height: 250 });
  const updateTimerRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  // Refs to hold current range values for use in uPlot range callbacks
  const tempRangeRef = useRef<uPlot.Range.MinMax>([0, 100]);
  const currentRangeRef = useRef<uPlot.Range.MinMax>([0, 10]);
  const voltageRangeRef = useRef<uPlot.Range.MinMax>([0, 100]);
  const pidRangeRef = useRef<uPlot.Range.MinMax>([-5, 5]);

  // Convert data to uPlot format for temperature chart
  const tempUplotData = useMemo((): uPlot.AlignedData => convertTempDataToUplot(data), [data]);

  // Convert data to uPlot format for temperature error chart
  const tempErrorUplotData = useMemo((): uPlot.AlignedData => convertTempErrorDataToUplot(data), [data]);

  // Convert data to uPlot format for current chart
  const currentUplotData = useMemo((): uPlot.AlignedData => convertCurrentDataToUplot(data), [data]);

  // Convert data to uPlot format for voltage chart
  const voltageUplotData = useMemo((): uPlot.AlignedData => convertVoltageDataToUplot(data), [data]);

  // Convert data to uPlot format for PID chart
  const pidUplotData = useMemo((): uPlot.AlignedData => convertPidDataToUplot(data), [data]);

  // Calculate ranges and update refs for use in uPlot range callbacks
  const tempRange = useMemo((): uPlot.Range.MinMax => {
    if (data.length === 0) return tempRangeRef.current; // Keep previous range when no data

    let min = Infinity;
    let max = -Infinity;

    for (const point of data) {
      const values = [
        num(point.peltierTemp),
        num(point.peltierTempTarget),
        num(point.lidTemp),
        num(point.lidTempTarget),
      ];
      for (const v of values) {
        if (Number.isNaN(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    if (min === Infinity) return tempRangeRef.current;
    const range: uPlot.Range.MinMax = [min - 5, max + 5];
    tempRangeRef.current = range;
    return range;
  }, [data]);

  const currentRange = useMemo((): uPlot.Range.MinMax => {
    if (data.length === 0) return currentRangeRef.current; // Keep previous range when no data

    let min = Infinity;
    let max = -Infinity;

    for (const point of data) {
      const values = [
        num(point.peltierCurrent),
        num(point.peltierCurrentTarget),
        num(point.lidCurrent),
      ];
      for (const v of values) {
        if (Number.isNaN(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    if (min === Infinity) return currentRangeRef.current;
    const range: uPlot.Range.MinMax = [min - 0.5, max + 0.5];
    currentRangeRef.current = range;
    return range;
  }, [data]);

  const voltageRange = useMemo((): uPlot.Range.MinMax => {
    if (data.length === 0) return voltageRangeRef.current; // Keep previous range when no data

    let min = Infinity;
    let max = -Infinity;

    for (const point of data) {
      const values = [num(point.hbridgeVoltageTarget), num(point.hbridgeDuty)];
      for (const v of values) {
        if (Number.isNaN(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    if (min === Infinity) return voltageRangeRef.current;
    const range: uPlot.Range.MinMax = [min - 1, max + 1];
    voltageRangeRef.current = range;
    return range;
  }, [data]);

  const pidRange = useMemo((): uPlot.Range.MinMax => {
    // Fixed range of ±5 for PID components
    const range: uPlot.Range.MinMax = [-5, 5];
    pidRangeRef.current = range;
    return range;
  }, []);

  // Initialize temperature plot
  useEffect(() => {
    if (!tempContainerRef.current) return;

    const width = tempContainerRef.current.clientWidth;
    const height = tempContainerRef.current.clientHeight;
    if (width === 0 || height === 0) {
      // Tab not visible yet - clean up any existing plot
      if (tempPlotRef.current) {
        tempPlotRef.current.destroy();
        tempPlotRef.current = null;
      }
      return;
    }

    // If plot already exists with correct theme, don't recreate
    if (tempPlotRef.current) return;

    // Get current data at initialization time using helper function
    const initialData: uPlot.AlignedData = convertTempDataToUplot(useTelemetryStore.getState().hwHistory);

    const opts: uPlot.Options = {
      width,
      height: height - 30,
      series: [
        {
          value: (_u, v) => {
            if (v == null) return '--';
            const date = new Date(v);
            return date.toLocaleString();
          },
        },
        {
          label: 'Peltier Temp',
          stroke: isDark ? '#42a5f5' : '#2196f3',
          width: 2,
          points: { show: false },
          value: (_u, v) => v == null ? '--' : v.toFixed(2) + '°C',
        },
        {
          label: 'Peltier Target',
          stroke: isDark ? '#90caf9' : '#64b5f6',
          width: 2,
          points: { show: false },
          dash: [5, 5],
          value: (_u, v) => v == null ? '--' : v.toFixed(2) + '°C',
        },
        {
          label: 'Lid Temp',
          stroke: isDark ? '#ef5350' : '#f44336',
          width: 2,
          points: { show: false },
          value: (_u, v) => v == null ? '--' : v.toFixed(2) + '°C',
        },
        {
          label: 'Lid Target',
          stroke: isDark ? '#ff7961' : '#ef5350',
          width: 2,
          points: { show: false },
          dash: [5, 5],
          value: (_u, v) => v == null ? '--' : v.toFixed(2) + '°C',
        },
      ],
      axes: [
        {
          label: 'Time',
          labelSize: 18,
          labelGap: 0,
          stroke: isDark ? '#fff' : '#000',
          labelFont: `18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
          grid: { stroke: isDark ? '#444' : '#e0e0e0', width: 1 },
          values: (_u, vals) => vals.map(v => {
            const date = new Date(v);
            return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
          }),
        },
        {
          label: 'Temperature (°C)',
          labelSize: 40,
          labelGap: 10,
          stroke: isDark ? '#fff' : '#000',
          labelFont: `14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
          values: (_u, vals) => vals.map(v => v.toFixed(2) + '°C'),
          grid: { stroke: isDark ? '#444' : '#e0e0e0', width: 1 },
        },
      ],
      scales: {
        x: {},
        y: { range: () => tempRangeRef.current },
      },
      cursor: {
        drag: { x: false, y: false },
        points: {
          size: 8,
          width: 2,
          stroke: isDark ? '#fff' : '#000',
          fill: isDark ? '#333' : '#fff',
        },
      },
      legend: { show: true, live: true },
    };

    tempPlotRef.current = new uPlot(opts, initialData, tempContainerRef.current);

    return () => {
      tempPlotRef.current?.destroy();
      tempPlotRef.current = null;
    };
  }, [plotSize, isDark]);

  // Initialize temperature error plot
  useEffect(() => {
    if (!tempErrorContainerRef.current) return;

    const width = tempErrorContainerRef.current.clientWidth;
    const height = tempErrorContainerRef.current.clientHeight;
    if (width === 0 || height === 0) {
      // Tab not visible yet - clean up any existing plot
      if (tempErrorPlotRef.current) {
        tempErrorPlotRef.current.destroy();
        tempErrorPlotRef.current = null;
      }
      return;
    }

    // If plot already exists with correct theme, don't recreate
    if (tempErrorPlotRef.current) return;

    // Get current data at initialization time using helper function
    const initialData: uPlot.AlignedData = convertTempErrorDataToUplot(useTelemetryStore.getState().hwHistory);

    const opts: uPlot.Options = {
      width,
      height: height - 30,
      series: [
        {
          value: (_u, v) => {
            if (v == null) return '--';
            const date = new Date(v);
            return date.toLocaleString();
          },
        },
        {
          label: 'Temp Error',
          stroke: isDark ? '#ff7043' : '#e64a19',
          width: 2,
          points: { show: false },
          value: (_u, v) => v == null ? '--' : v.toFixed(3) + '°C',
        },
      ],
      axes: [
        {
          label: 'Time',
          labelSize: 18,
          labelGap: 0,
          stroke: isDark ? '#fff' : '#000',
          labelFont: `18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
          grid: { stroke: isDark ? '#444' : '#e0e0e0', width: 1 },
          values: (_u, vals) => vals.map(v => {
            const date = new Date(v);
            return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
          }),
        },
        {
          label: 'Error (°C)',
          labelSize: 40,
          labelGap: 10,
          stroke: isDark ? '#fff' : '#000',
          labelFont: `14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
          values: (_u, vals) => vals.map(v => v.toFixed(2) + '°C'),
          grid: { stroke: isDark ? '#444' : '#e0e0e0', width: 1 },
        },
      ],
      scales: {
        x: {},
        y: { range: () => [-1, 1] as uPlot.Range.MinMax },  // Fixed range ±1
      },
      hooks: {
        draw: [
          (u: uPlot) => {
            const ctx = u.ctx;
            const { left, width: plotWidth } = u.bbox;

            // Draw dotted lines at ±0.25
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = isDark ? '#888' : '#999';
            ctx.lineWidth = 1;

            // +0.25 line
            const y025 = u.valToPos(0.25, 'y', true);
            ctx.beginPath();
            ctx.moveTo(left, y025);
            ctx.lineTo(left + plotWidth, y025);
            ctx.stroke();

            // -0.25 line
            const yNeg025 = u.valToPos(-0.25, 'y', true);
            ctx.beginPath();
            ctx.moveTo(left, yNeg025);
            ctx.lineTo(left + plotWidth, yNeg025);
            ctx.stroke();

            ctx.restore();
          }
        ]
      },
      cursor: {
        drag: { x: false, y: false },
        points: {
          size: 8,
          width: 2,
          stroke: isDark ? '#fff' : '#000',
          fill: isDark ? '#333' : '#fff',
        },
      },
      legend: { show: true, live: true },
    };

    tempErrorPlotRef.current = new uPlot(opts, initialData, tempErrorContainerRef.current);

    return () => {
      tempErrorPlotRef.current?.destroy();
      tempErrorPlotRef.current = null;
    };
  }, [plotSize, isDark]);

  // Initialize current plot
  useEffect(() => {
    if (!currentContainerRef.current) return;

    const width = currentContainerRef.current.clientWidth;
    const height = currentContainerRef.current.clientHeight;
    if (width === 0 || height === 0) {
      // Tab not visible yet - clean up any existing plot
      if (currentPlotRef.current) {
        currentPlotRef.current.destroy();
        currentPlotRef.current = null;
      }
      return;
    }

    // If plot already exists with correct theme, don't recreate
    if (currentPlotRef.current) return;

    // Get current data at initialization time using helper function
    const initialData: uPlot.AlignedData = convertCurrentDataToUplot(useTelemetryStore.getState().hwHistory);

    const opts: uPlot.Options = {
      width,
      height: height - 30,
      series: [
        {
          value: (_u, v) => {
            if (v == null) return '--';
            const date = new Date(v);
            return date.toLocaleString('en-US', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            });
          },
        },
        {
          label: 'Peltier Current',
          stroke: isDark ? '#42a5f5' : '#1976d2',
          width: 2,
          points: { show: false },
          value: (_u, v) => v == null ? '--' : v.toFixed(2) + 'A',
        },
        {
          label: 'Peltier Target',
          stroke: isDark ? '#90caf9' : '#64b5f6',
          width: 2,
          points: { show: false },
          dash: [5, 5],
          value: (_u, v) => v == null ? '--' : v.toFixed(2) + 'A',
        },
        {
          label: 'Lid Current',
          stroke: isDark ? '#ef5350' : '#d32f2f',
          width: 2,
          points: { show: false },
          value: (_u, v) => v == null ? '--' : v.toFixed(2) + 'A',
        },
      ],
      axes: [
        {
          label: 'Time',
          labelSize: 18,
          labelGap: 0,
          stroke: isDark ? '#fff' : '#000',
          labelFont: `18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
          grid: { stroke: isDark ? '#444' : '#e0e0e0', width: 1 },
          values: (_u, vals) => vals.map(v => {
            const date = new Date(v);
            return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
          }),
        },
        {
          label: 'Current (A)',
          labelSize: 40,
          labelGap: 10,
          stroke: isDark ? '#fff' : '#000',
          labelFont: `14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
          values: (_u, vals) => vals.map(v => v.toFixed(3) + 'A'),
          grid: { stroke: isDark ? '#444' : '#e0e0e0', width: 1 },
        },
      ],
      scales: {
        x: {},
        y: { range: () => currentRangeRef.current },
      },
      cursor: {
        drag: { x: false, y: false },
        points: {
          size: 8,
          width: 2,
          stroke: isDark ? '#fff' : '#000',
          fill: isDark ? '#333' : '#fff',
        },
      },
      legend: { show: true, live: true },
    };

    currentPlotRef.current = new uPlot(opts, initialData, currentContainerRef.current);

    return () => {
      currentPlotRef.current?.destroy();
      currentPlotRef.current = null;
    };
  }, [plotSize, isDark]);

  // Initialize voltage plot
  useEffect(() => {
    if (!voltageContainerRef.current) return;

    const width = voltageContainerRef.current.clientWidth;
    const height = voltageContainerRef.current.clientHeight;
    if (width === 0 || height === 0) {
      // Tab not visible yet - clean up any existing plot
      if (voltagePlotRef.current) {
        voltagePlotRef.current.destroy();
        voltagePlotRef.current = null;
      }
      return;
    }

    // If plot already exists with correct theme, don't recreate
    if (voltagePlotRef.current) return;

    // Get current data at initialization time using helper function
    const initialData: uPlot.AlignedData = convertVoltageDataToUplot(useTelemetryStore.getState().hwHistory);

    const opts: uPlot.Options = {
      width,
      height: height - 30,
      series: [
        {
          value: (_u, v) => {
            if (v == null) return '--';
            const date = new Date(v);
            return date.toLocaleString('en-US', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            });
          },
        },
        { label: 'Voltage Target', stroke: isDark ? '#66bb6a' : '#388e3c', width: 2, points: { show: false } },
        { label: 'Duty Cycle', stroke: isDark ? '#81c784' : '#66bb6a', width: 2, points: { show: false } },
      ],
      axes: [
        {
          label: 'Time',
          labelSize: 18,
          labelGap: 0,
          stroke: isDark ? '#fff' : '#000',
          labelFont: `18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
          grid: { stroke: isDark ? '#444' : '#e0e0e0', width: 1 },
          values: (_u, vals) => vals.map(v => {
            const date = new Date(v);
            return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
          }),
        },
        {
          label: 'Value',
          labelSize: 40,
          labelGap: 10,
          stroke: isDark ? '#fff' : '#000',
          labelFont: `14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
          values: (_u, vals) => vals.map(v => v.toFixed(2)),
          grid: { stroke: isDark ? '#444' : '#e0e0e0', width: 1 },
        },
      ],
      scales: {
        x: {},
        y: { range: () => voltageRangeRef.current },
      },
      cursor: {
        drag: { x: false, y: false },
        points: {
          size: 8,
          width: 2,
          stroke: isDark ? '#fff' : '#000',
          fill: isDark ? '#333' : '#fff',
        },
      },
      legend: { show: true, live: true },
    };

    voltagePlotRef.current = new uPlot(opts, initialData, voltageContainerRef.current);

    return () => {
      voltagePlotRef.current?.destroy();
      voltagePlotRef.current = null;
    };
  }, [plotSize, isDark]);

  // Initialize PID plot
  useEffect(() => {
    if (!pidContainerRef.current) return;

    const width = pidContainerRef.current.clientWidth;
    const height = pidContainerRef.current.clientHeight;
    if (width === 0 || height === 0) {
      // Tab not visible yet - clean up any existing plot
      if (pidPlotRef.current) {
        pidPlotRef.current.destroy();
        pidPlotRef.current = null;
      }
      return;
    }

    // If plot already exists with correct theme, don't recreate
    if (pidPlotRef.current) return;

    // Get current data at initialization time using helper function
    const initialData: uPlot.AlignedData = convertPidDataToUplot(useTelemetryStore.getState().hwHistory);

    const opts: uPlot.Options = {
      width,
      height: height - 30,
      series: [
        {
          value: (_u, v) => {
            if (v == null) return '--';
            const date = new Date(v);
            return date.toLocaleString('en-US', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            });
          },
        },
        { label: 'P', stroke: isDark ? '#ff7043' : '#e64a19', width: 2, points: { show: false }, value: (_u, v) => v == null ? '--' : v.toFixed(3) + 'A' },
        { label: 'I', stroke: isDark ? '#42a5f5' : '#1976d2', width: 2, points: { show: false }, value: (_u, v) => v == null ? '--' : v.toFixed(3) + 'A' },
        { label: 'D', stroke: isDark ? '#66bb6a' : '#388e3c', width: 2, points: { show: false }, value: (_u, v) => v == null ? '--' : v.toFixed(3) + 'A' },
      ],
      axes: [
        {
          label: 'Time',
          labelSize: 18,
          labelGap: 0,
          stroke: isDark ? '#fff' : '#000',
          labelFont: `18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
          grid: { stroke: isDark ? '#444' : '#e0e0e0', width: 1 },
          values: (_u, vals) => vals.map(v => {
            const date = new Date(v);
            return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
          }),
        },
        {
          label: 'Current (A)',
          labelSize: 40,
          labelGap: 10,
          stroke: isDark ? '#fff' : '#000',
          labelFont: `14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
          values: (_u, vals) => vals.map(v => v.toFixed(2) + 'A'),
          grid: { stroke: isDark ? '#444' : '#e0e0e0', width: 1 },
        },
      ],
      scales: {
        x: {},
        y: { range: () => pidRangeRef.current },
      },
      cursor: {
        drag: { x: false, y: false },
        points: {
          size: 8,
          width: 2,
          stroke: isDark ? '#fff' : '#000',
          fill: isDark ? '#333' : '#fff',
        },
      },
      legend: { show: true, live: true },
    };

    pidPlotRef.current = new uPlot(opts, initialData, pidContainerRef.current);

    return () => {
      pidPlotRef.current?.destroy();
      pidPlotRef.current = null;
    };
  }, [plotSize, isDark]);

  // Update all plots (throttled to max 30fps)
  useEffect(() => {
    if (!tempPlotRef.current || !tempErrorPlotRef.current || !currentPlotRef.current || !voltagePlotRef.current || !pidPlotRef.current) return;

    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateRef.current;

    if (timeSinceLastUpdate < 33) {
      if (updateTimerRef.current) {
        window.clearTimeout(updateTimerRef.current);
      }

      updateTimerRef.current = window.setTimeout(() => {
        tempPlotRef.current?.setData(tempUplotData);
        tempErrorPlotRef.current?.setData(tempErrorUplotData);
        currentPlotRef.current?.setData(currentUplotData);
        voltagePlotRef.current?.setData(voltageUplotData);
        pidPlotRef.current?.setData(pidUplotData);
        lastUpdateRef.current = Date.now();
      }, 33 - timeSinceLastUpdate);

      return () => {
        if (updateTimerRef.current) {
          window.clearTimeout(updateTimerRef.current);
        }
      };
    }

    tempPlotRef.current.setData(tempUplotData);
    tempErrorPlotRef.current.setData(tempErrorUplotData);
    currentPlotRef.current.setData(currentUplotData);
    voltagePlotRef.current.setData(voltageUplotData);
    pidPlotRef.current.setData(pidUplotData);
    lastUpdateRef.current = now;
  }, [tempUplotData, tempErrorUplotData, currentUplotData, voltageUplotData, pidUplotData]);

  // Update scales when ranges change
  useEffect(() => {
    if (tempPlotRef.current && tempRange[0] !== null && tempRange[1] !== null) {
      tempPlotRef.current.setScale('y', { min: tempRange[0], max: tempRange[1] });
    }
  }, [tempRange]);

  useEffect(() => {
    if (currentPlotRef.current && currentRange[0] !== null && currentRange[1] !== null) {
      currentPlotRef.current.setScale('y', { min: currentRange[0], max: currentRange[1] });
    }
  }, [currentRange]);

  useEffect(() => {
    if (voltagePlotRef.current && voltageRange[0] !== null && voltageRange[1] !== null) {
      voltagePlotRef.current.setScale('y', { min: voltageRange[0], max: voltageRange[1] });
    }
  }, [voltageRange]);

  useEffect(() => {
    if (pidPlotRef.current && pidRange[0] !== null && pidRange[1] !== null) {
      pidPlotRef.current.setScale('y', { min: pidRange[0], max: pidRange[1] });
    }
  }, [pidRange]);

  // Handle resize for all plots
  useEffect(() => {
    const containers = [tempContainerRef.current, tempErrorContainerRef.current, currentContainerRef.current, voltageContainerRef.current, pidContainerRef.current];
    const plots = [tempPlotRef, tempErrorPlotRef, currentPlotRef, voltagePlotRef, pidPlotRef];

    if (!containers.every(c => c)) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        const newWidth = Math.floor(width);
        const newHeight = Math.floor((entry.contentRect.height || 250) - 30);

        if (newWidth > 0 && newHeight > 0) {
          setPlotSize({ width: newWidth, height: newHeight });
          plots.forEach(plotRef => {
            plotRef.current?.setSize({ width: newWidth, height: newHeight });
          });
        }
      }
    });

    containers.forEach(container => {
      if (container) resizeObserver.observe(container);
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <Box sx={{
      p: 2,
      height: '100%',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      '& .u-legend': {
        color: theme.palette.text.primary,
      },
      '& .u-legend th': {
        color: theme.palette.text.primary,
      },
      '& .u-legend td': {
        color: theme.palette.text.primary,
      },
    }}>
      {/* Temperature Chart */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold', fontSize: '11px' }}>
          Temperatures
        </Typography>
        <div ref={tempContainerRef} style={{ flexGrow: 1, minHeight: 0 }} />
      </Box>

      {/* Temperature Error Chart */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold', fontSize: '11px' }}>
          Temperature Error
        </Typography>
        <div ref={tempErrorContainerRef} style={{ flexGrow: 1, minHeight: 0 }} />
      </Box>

      {/* Current Chart */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold', fontSize: '11px' }}>
          Currents
        </Typography>
        <div ref={currentContainerRef} style={{ flexGrow: 1, minHeight: 0 }} />
      </Box>

      {/* Voltage & Duty Cycle Chart */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold', fontSize: '11px' }}>
          H-Bridge Control
        </Typography>
        <div ref={voltageContainerRef} style={{ flexGrow: 1, minHeight: 0 }} />
      </Box>

      {/* PID Components Chart */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold', fontSize: '11px' }}>
          PID Components
        </Typography>
        <div ref={pidContainerRef} style={{ flexGrow: 1, minHeight: 0 }} />
      </Box>

      {(!isConnected || transport !== 'usb') && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            bgcolor: 'background.paper',
            p: 2,
            borderRadius: 1,
          }}
        >
          <Typography color="text.secondary">
            {!isConnected
              ? 'Connect to a device over USB to view hardware data'
              : 'Hardware monitor is only available over USB'}
          </Typography>
        </Box>
      )}
    </Box>
  );
};
