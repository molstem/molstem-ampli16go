import { Box, Typography, Link as MuiLink } from '@mui/material';

interface SimpleMarkdownProps {
  content: string;
}

/**
 * Lightweight markdown-like renderer for simple content.
 * Supports: headings (#, ##, ###), paragraphs, unordered lists (-),
 * ordered lists (1.), bold (**text**), and links [text](url)
 */
export function SimpleMarkdown({ content }: SimpleMarkdownProps) {
  const lines = content.split('\n');
  const elements: JSX.Element[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0 && listType) {
      const ListTag = listType === 'ul' ? 'ul' : 'ol';
      elements.push(
        <Box component={ListTag} key={key++} sx={{ pl: 2, color: 'text.secondary', my: 1 }}>
          {listItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </Box>
      );
      listItems = [];
      listType = null;
    }
  };

  const renderInline = (text: string): (string | JSX.Element)[] => {
    const result: (string | JSX.Element)[] = [];
    // Match bold (**text**) and links [text](url)
    const regex = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
    let lastIndex = 0;
    let match;
    let inlineKey = 0;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push(text.slice(lastIndex, match.index));
      }

      const token = match[0];
      if (token.startsWith('**') && token.endsWith('**')) {
        // Bold
        result.push(
          <strong key={inlineKey++}>{token.slice(2, -2)}</strong>
        );
      } else if (token.startsWith('[')) {
        // Link
        const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) {
          result.push(
            <MuiLink
              key={inlineKey++}
              href={linkMatch[2]}
              target="_blank"
              rel="noopener noreferrer"
            >
              {linkMatch[1]}
            </MuiLink>
          );
        }
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      result.push(text.slice(lastIndex));
    }

    return result.length > 0 ? result : [text];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // Check for headings (order matters: check ### before ## before #)
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <Typography key={key++} variant="subtitle1" sx={{ mt: 2, mb: 1, fontWeight: 'medium' }}>
          {trimmed.slice(4)}
        </Typography>
      );
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <Typography key={key++} variant="h6" sx={{ mt: 2, mb: 1 }}>
          {trimmed.slice(3)}
        </Typography>
      );
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <Typography key={key++} variant="h5" color="primary" sx={{ mt: 2, mb: 2, textAlign: 'center' }}>
          {trimmed.slice(2)}
        </Typography>
      );
      continue;
    }

    // Check for list items
    if (trimmed.startsWith('- ')) {
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listItems.push(trimmed.slice(2));
      continue;
    }

    const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) {
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      listItems.push(olMatch[2]);
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <Typography key={key++} variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {renderInline(trimmed)}
      </Typography>
    );
  }

  flushList();

  return <Box>{elements}</Box>;
}
