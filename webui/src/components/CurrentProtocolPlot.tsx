import React, { useEffect, useRef, useMemo, useState } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useTelemetryStore } from '../stores/telemetryStore';

/** uPlot draws its legend below the canvas; keep it inside a fixed-height parent. */
const LEGEND_HEIGHT = 36;

export const CurrentProtocolPlot: React.FC = () => {
  // Whole-run temperature history fed by the device poller; cleared when a run starts
  const data = useTelemetryStore((state) => state.temperatureHistory);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [plotSize, setPlotSize] = useState({ width: 800, height: 400 });
  const lastThemeRef = useRef(isDark);

  // Convert data to uPlot format: [timestamps, peltier values, lid values]
  const uplotData = useMemo((): uPlot.AlignedData => {
    if (data.length === 0) {
      return [[], [], []];
    }

    const timestamps: number[] = [];
    const peltierValues: number[] = [];
    const lidValues: number[] = [];

    for (const point of data) {
      timestamps.push(point.t);
      peltierValues.push(point.peltier);
      lidValues.push(point.lid);
    }

    return [timestamps, peltierValues, lidValues];
  }, [data]);

  // Calculate min/max for Y-axis
  const yRange = useMemo((): uPlot.Range.MinMax => {
    if (data.length === 0) {
      return [0, 100];
    }

    let min = Infinity;
    let max = -Infinity;

    for (const point of data) {
      if (point.peltier < min) min = point.peltier;
      if (point.peltier > max) max = point.peltier;
      if (point.lid < min) min = point.lid;
      if (point.lid > max) max = point.lid;
    }

    return [min - 5, max + 5];
  }, [data]);

  // Initialize plot when container is ready
  useEffect(() => {
    if (!containerRef.current) return;

    // Check if container has size (tab is visible)
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    if (width === 0 || height === 0) {
      // Tab not visible yet - clean up any existing plot
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
      }
      return;
    }

    // Check if theme changed - if so, recreate plot
    if (lastThemeRef.current !== isDark && plotRef.current) {
      plotRef.current.destroy();
      plotRef.current = null;
    }
    lastThemeRef.current = isDark;

    // If plot already exists with correct theme, don't recreate
    if (plotRef.current) return;

    // Get current data from store
    const currentData = useTelemetryStore.getState().temperatureHistory;
    const timestamps: number[] = [];
    const peltierValues: number[] = [];
    const lidValues: number[] = [];

    for (const point of currentData) {
      timestamps.push(point.t);
      peltierValues.push(point.peltier);
      lidValues.push(point.lid);
    }

    const initialData: uPlot.AlignedData = [timestamps, peltierValues, lidValues];

    // Calculate initial yRange
    let min = Infinity;
    let max = -Infinity;
    for (const point of currentData) {
      if (point.peltier < min) min = point.peltier;
      if (point.peltier > max) max = point.peltier;
      if (point.lid < min) min = point.lid;
      if (point.lid > max) max = point.lid;
    }
    const initialYRange: uPlot.Range.MinMax = currentData.length > 0 ? [min - 5, max + 5] : [0, 100];

    // Create options inline with initial yRange and theme colors
    const opts: uPlot.Options = {
      width: width - 32,
      height: height - 32 - LEGEND_HEIGHT,
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
          stroke: isDark ? '#42a5f5' : '#1976d2',
          width: 2,
          points: { show: false },
        },
        {
          label: 'Lid Temp',
          stroke: isDark ? '#ef5350' : '#d32f2f',
          width: 2,
          points: { show: false },
        },
      ],
      axes: [
        {
          label: 'Time',
          labelSize: 20,
          labelGap: 0,
          stroke: isDark ? '#fff' : '#000',
          labelFont: `20px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
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
          values: (_u, vals) => vals.map(v => v.toFixed(1) + '°C'),
          grid: { stroke: isDark ? '#444' : '#e0e0e0', width: 1 },
        },
      ],
      scales: {
        x: {},
        y: {
          auto: false,
          range: initialYRange,
        },
      },
      cursor: {
        drag: {
          x: false,
          y: false,
        },
        points: {
          size: 8,
          width: 2,
          stroke: isDark ? '#fff' : '#000',
          fill: isDark ? '#333' : '#fff',
        },
      },
      legend: {
        show: true,
        live: true,
      },
    };

    plotRef.current = new uPlot(opts, initialData, containerRef.current);

    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [plotSize, isDark]);

  // Update data (throttled to avoid excessive re-renders)
  useEffect(() => {
    if (!plotRef.current || data.length === 0) return;

    // Use requestAnimationFrame to batch updates
    const frameId = requestAnimationFrame(() => {
      plotRef.current?.setData(uplotData);
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [uplotData, data.length]);

  // Update scales when range changes
  useEffect(() => {
    if (plotRef.current && yRange[0] !== null && yRange[1] !== null) {
      plotRef.current.setScale('y', { min: yRange[0], max: yRange[1] });
    }
  }, [yRange]);

  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const newWidth = Math.floor(width - 32); // Account for padding
        const newHeight = Math.floor(height - 32 - LEGEND_HEIGHT);

        if (newWidth > 0 && newHeight > 0) {
          // Check if plot exists before resizing
          if (plotRef.current) {
            plotRef.current.setSize({ width: newWidth, height: newHeight });
          }
          // Always update state to trigger initialization effect when becoming visible
          setPlotSize(prev => {
            // Force new object to trigger effect even if dimensions haven't changed
            if (prev.width === newWidth && prev.height === newHeight) {
              return { width: newWidth, height: newHeight }; // New object reference
            }
            return { width: newWidth, height: newHeight };
          });
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <Box
      sx={{
        p: 2,
        height: '100%',
        width: '100%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        '& .u-legend': {
          color: theme.palette.text.primary,
        },
        '& .u-legend th': {
          color: theme.palette.text.primary,
        },
        '& .u-legend td': {
          color: theme.palette.text.primary,
        },
      }}
    >
      <div ref={containerRef} style={{ flexGrow: 1, minHeight: 0 }} />

      {data.length === 0 && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
          }}
        >
          <Typography color="text.secondary">Waiting for temperature data…</Typography>
        </Box>
      )}
    </Box>
  );
};
