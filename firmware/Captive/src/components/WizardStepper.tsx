import { Stepper, Step, StepLabel, useMediaQuery, useTheme } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { STEPS } from '../context/WizardContext';

const STEP_LABELS = ['Welcome', 'Device Setup', 'WiFi', 'Complete'];

export function WizardStepper() {
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const currentPath = location.pathname;
  const activeStep = STEPS.indexOf(currentPath);

  // Don't show stepper on welcome or complete pages
  if (activeStep <= 0 || activeStep >= STEPS.length - 1) {
    return null;
  }

  return (
    <Stepper
      activeStep={activeStep}
      alternativeLabel={!isMobile}
      orientation={isMobile ? 'vertical' : 'horizontal'}
      sx={{ mb: 3 }}
    >
      {STEP_LABELS.map((label, index) => (
        <Step key={label} completed={index < activeStep}>
          <StepLabel>{label}</StepLabel>
        </Step>
      ))}
    </Stepper>
  );
}
