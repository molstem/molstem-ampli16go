import React from 'react';
import { Box, Typography } from '@mui/material';

// Import the markdown file at compile time
import documentationContent from '../../../Documentation-UI.md?raw';

export const Documentation: React.FC = () => {
  const content = documentationContent || '';
  const error = !content ? 'Documentation file not found' : null;

  // Simple markdown-to-HTML conversion
  const renderMarkdown = (md: string) => {
    let html = md;

    // Headers (process from most specific to least specific)
    html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Code blocks
    html = html.replace(/```([^`]+)```/gim, '<pre><code>$1</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/gim, '<code>$1</code>');

    // Line breaks
    html = html.replace(/\n\n/gim, '<br/><br/>');
    html = html.replace(/\n/gim, '<br/>');

    // Lists
    html = html.replace(/^\* (.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gis, '<ul>$1</ul>');

    return html;
  };

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error" variant="h6">
          {error}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          The documentation file should be located at the root of the repository as <code>Documentation-UI.md</code>
        </Typography>
      </Box>
    );
  }

  return (
      <Box
        sx={{
          wordBreak: 'break-word',
          '& h1': {
            fontSize: '2rem',
            fontWeight: 600,
            mb: 2,
            mt: 0,
          },
          '& h2': {
            fontSize: '1.5rem',
            fontWeight: 600,
            mb: 1.5,
            mt: 3,
          },
          '& h3': {
            fontSize: '1.25rem',
            fontWeight: 600,
            mb: 1,
            mt: 2,
          },
          '& h4': {
            fontSize: '1.1rem',
            fontWeight: 600,
            mb: 0.75,
            mt: 1.5,
          },
          '& p': {
            mb: 2,
          },
          '& code': {
            bgcolor: 'action.hover',
            px: 0.5,
            py: 0.25,
            borderRadius: 0.5,
            fontFamily: 'monospace',
            fontSize: '0.875rem',
          },
          '& pre': {
            bgcolor: 'action.hover',
            p: 2,
            borderRadius: 1,
            overflow: 'auto',
            '& code': {
              bgcolor: 'transparent',
              p: 0,
            },
          },
          '& ul': {
            mb: 2,
            pl: 3,
          },
          '& li': {
            mb: 0.5,
          },
          '& a': {
            color: 'primary.main',
            textDecoration: 'none',
            '&:hover': {
              textDecoration: 'underline',
            },
          },
        }}
      >
        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
      </Box>
  );
};
