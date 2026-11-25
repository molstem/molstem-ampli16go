import { Box, Button } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useNavigate } from 'react-router-dom';
import { Layout, SimpleMarkdown } from '../components';
import welcomeContent from '../content/welcome.md?raw';

export function WelcomePage() {
  const navigate = useNavigate();

  const handleGetStarted = () => {
    navigate('/setup');
  };

  return (
    <Layout>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        {/* Logo */}
        <Box
          component="img"
          src="./favicon.png"
          alt="molstem logo"
          sx={{
            height: { xs: 80, sm: 100, md: 120 },
            width: 'auto',
            mb: 3,
          }}
        />

        {/* Markdown Content */}
        <Box sx={{ textAlign: 'left', width: '100%' }}>
          <SimpleMarkdown content={welcomeContent} />
        </Box>

        {/* Get Started Button */}
        <Button
          variant="contained"
          size="large"
          endIcon={<ArrowForwardIcon />}
          onClick={handleGetStarted}
          sx={{
            mt: 4,
            px: 4,
            py: 1.5,
            fontSize: '1.1rem',
            width: { xs: '100%', sm: 'auto' },
          }}
        >
          Get Started
        </Button>
      </Box>
    </Layout>
  );
}
