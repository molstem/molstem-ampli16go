import React, { useState } from 'react';
import { Box, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import UsbOffIcon from '@mui/icons-material/UsbOff';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import MenuIcon from '@mui/icons-material/Menu';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import DevicesIcon from '@mui/icons-material/Devices';
import { BrandLockup } from './BrandLockup';
import { DeviceStatusIndicator } from './DeviceStatusIndicator';
import { useSerialStore } from '../stores/serialStore';
import { disconnectDevice, portDisplayName } from '../services/connectionActions';
import { openExternal } from '../utils/format';
import { showDevicesLink, type Route } from '../routes';

const APP_HOME = 'https://app.molstem.com';

interface AppHeaderProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  route: Route;
  onNavigate: (route: Route) => void;
}

interface NavItem {
  route: Route;
  label: string;
  icon: React.ReactNode;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ darkMode, onToggleDarkMode, route, onNavigate }) => {
  const isConnected = useSerialStore((s) => s.isConnected);
  const statusColor = useSerialStore((s) => s.statusColor);
  const port = useSerialStore((s) => s.port);
  const status = useSerialStore((s) => s.status);
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);

  const navItems: NavItem[] = [
    ...(showDevicesLink() ? [{ route: '/devices' as Route, label: 'Devices', icon: <DevicesIcon fontSize="small" /> }] : []),
    { route: '/docs', label: 'Documentation', icon: <MenuBookIcon fontSize="small" /> },
  ];

  const disconnectLabel = `Disconnect${port ? ` from ${portDisplayName(port)}` : ''}`;
  const closeMenu = () => setMenuAnchorEl(null);

  return (
    <Box
      component="header"
      sx={{
        py: 1,
        px: { xs: 1.5, sm: 3 },
        borderBottom: 1,
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 1, sm: 2 },
        minHeight: 56,
        flexWrap: 'nowrap',
        flexShrink: 0,
      }}
    >
      <IconButton onClick={(e) => setMenuAnchorEl(e.currentTarget)} aria-label="Menu" sx={{ display: { xs: 'flex', md: 'none' } }}>
        <MenuIcon />
      </IconButton>

      <Box
        component="a"
        href={APP_HOME}
        onClick={(e: React.MouseEvent) => {
          e.preventDefault();
          openExternal(APP_HOME);
        }}
        aria-label="molstem app home"
        sx={{ display: 'flex', alignItems: 'center', textDecoration: 'none', color: 'inherit', cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
      >
        <BrandLockup label="thermocycler" />
      </Box>

      <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 2, ml: 1 }}>
        {navItems.map((item) => (
          <Box
            key={item.route}
            component="a"
            href={`.${item.route}`}
            onClick={(e: React.MouseEvent) => {
              e.preventDefault();
              onNavigate(item.route);
            }}
            aria-current={route === item.route ? 'page' : undefined}
            sx={{
              color: 'primary.main',
              textDecoration: route === item.route ? 'underline' : 'none',
              textUnderlineOffset: 4,
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            {item.label}
          </Box>
        ))}
      </Box>

      <Box sx={{ flex: 1 }} />

      <Box sx={{ display: { xs: 'none', md: 'flex' } }}>
        <DeviceStatusIndicator variant="inline" />
      </Box>

      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
        {isConnected && (
          <Tooltip title={disconnectLabel}>
            <IconButton onClick={() => void disconnectDevice()} color="inherit" size="small" aria-label={disconnectLabel} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
              <UsbOffIcon />
            </IconButton>
          </Tooltip>
        )}

        <Tooltip title={isConnected ? status : 'Not connected'}>
          <IconButton size="small" sx={{ cursor: 'help' }} aria-label={isConnected ? 'Connected' : 'Not connected'}>
            {statusColor === 'success' ? <CheckCircleIcon color="success" /> : <ErrorIcon color="error" />}
          </IconButton>
        </Tooltip>

        <Tooltip title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
          <IconButton onClick={onToggleDarkMode} color="inherit" size="small" aria-label="Toggle dark mode" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
            {darkMode ? <Brightness7Icon /> : <Brightness4Icon />}
          </IconButton>
        </Tooltip>
      </Box>

      <Menu anchorEl={menuAnchorEl} open={Boolean(menuAnchorEl)} onClose={closeMenu}>
        {navItems.map((item) => (
          <MenuItem
            key={item.route}
            selected={route === item.route}
            onClick={() => {
              onNavigate(item.route);
              closeMenu();
            }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>
        ))}
        {isConnected && (
          <MenuItem
            onClick={() => {
              void disconnectDevice();
              closeMenu();
            }}
            sx={{ display: { xs: 'flex', sm: 'none' } }}
          >
            <ListItemIcon>
              <UsbOffIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{disconnectLabel}</ListItemText>
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            onToggleDarkMode();
            closeMenu();
          }}
          sx={{ display: { xs: 'flex', sm: 'none' } }}
        >
          <ListItemIcon>{darkMode ? <Brightness7Icon fontSize="small" /> : <Brightness4Icon fontSize="small" />}</ListItemIcon>
          <ListItemText>{darkMode ? 'Light mode' : 'Dark mode'}</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
};
