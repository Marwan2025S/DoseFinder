import React from 'react';

/**
 * Lightweight markdown-to-React renderer.
 * Supports: h1-h6, **bold**, *italic*, unordered lists (- item),
 * ordered lists (1. item), tables, and --- horizontal separators.
 */

function parseInline(text, keyPrefix = '') {
  const parts = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match;
  let i = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2] !== undefined) {
      parts.push(
        React.createElement('strong', { key: `${keyPrefix}b${i}` }, match[2]),
      );
    } else if (match[3] !== undefined) {
      parts.push(
        React.createElement('em', { key: `${keyPrefix}i${i}` }, match[3]),
      );
    }

    lastIndex = match.index + match[0].length;
    i++;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 0 ? [text] : parts;
}

function splitTableRow(line) {
  if (!line.includes('|')) return null;

  const trimmed = line.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  let escaped = false;

  for (const char of normalized) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (escaped) current += '\\';
  cells.push(current.trim());

  return cells.length >= 2 ? cells : null;
}

function getTableAlignment(cell) {
  const trimmed = cell.trim();
  const alignLeft = trimmed.startsWith(':');
  const alignRight = trimmed.endsWith(':');

  if (alignLeft && alignRight) return 'center';
  if (alignRight) return 'right';
  return 'left';
}

function isTableSeparatorRow(cells, columnCount) {
  if (!cells || cells.length !== columnCount) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

export default function renderMarkdown(markdown) {
  if (!markdown) return null;

  const lines = markdown.split('\n');
  const elements = [];
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx];

    const tableHeaderCells = splitTableRow(line);
    const tableSeparatorCells = idx + 1 < lines.length ? splitTableRow(lines[idx + 1]) : null;

    if (tableHeaderCells && isTableSeparatorRow(tableSeparatorCells, tableHeaderCells.length)) {
      const tableStartIdx = idx;
      const alignments = tableSeparatorCells.map(getTableAlignment);
      const rows = [];
      idx += 2;

      while (idx < lines.length) {
        const rowCells = splitTableRow(lines[idx]);
        if (!rowCells || rowCells.length !== tableHeaderCells.length) break;
        rows.push(rowCells);
        idx++;
      }

      elements.push(
        React.createElement(
          'div',
          { key: `tbl-wrap${tableStartIdx}`, className: 'cb-md-table-wrap' },
          React.createElement(
            'table',
            { className: 'cb-md-table' },
            React.createElement(
              'thead',
              null,
              React.createElement(
                'tr',
                null,
                tableHeaderCells.map((cell, cellIdx) => (
                  React.createElement(
                    'th',
                    {
                      key: `th${tableStartIdx}-${cellIdx}`,
                      className: 'cb-md-th',
                      style: { textAlign: alignments[cellIdx] },
                    },
                    parseInline(cell, `th${tableStartIdx}-${cellIdx}`),
                  )
                )),
              ),
            ),
            rows.length > 0
              ? React.createElement(
                'tbody',
                null,
                rows.map((row, rowIdx) => (
                  React.createElement(
                    'tr',
                    { key: `tr${tableStartIdx}-${rowIdx}` },
                    row.map((cell, cellIdx) => (
                      React.createElement(
                        'td',
                        {
                          key: `td${tableStartIdx}-${rowIdx}-${cellIdx}`,
                          className: 'cb-md-td',
                          style: { textAlign: alignments[cellIdx] },
                        },
                        parseInline(cell, `td${tableStartIdx}-${rowIdx}-${cellIdx}`),
                      )
                    )),
                  )
                )),
              )
              : null,
          ),
        ),
      );
      continue;
    }

    if (/^-{3,}$/.test(line.trim())) {
      elements.push(React.createElement('hr', { key: `hr${idx}`, className: 'cb-md-hr' }));
      idx++;
      continue;
    }

    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const tag = `h${level}`;
      elements.push(
        React.createElement(tag, { key: `h${idx}`, className: `cb-md-h${level}` }, parseInline(headerMatch[2], `h${idx}`)),
      );
      idx++;
      continue;
    }

    if (/^[-*]\s+/.test(line.trimStart())) {
      const items = [];
      while (idx < lines.length && /^[-*]\s+/.test(lines[idx].trimStart())) {
        const content = lines[idx].replace(/^[-*]\s+/, '');
        items.push(
          React.createElement('li', { key: `uli${idx}` }, parseInline(content, `ul${idx}`)),
        );
        idx++;
      }
      elements.push(React.createElement('ul', { key: `ul${idx}`, className: 'cb-md-ul' }, items));
      continue;
    }

    if (/^\d+\.\s+/.test(line.trimStart())) {
      const items = [];
      while (idx < lines.length && /^\d+\.\s+/.test(lines[idx].trimStart())) {
        const content = lines[idx].replace(/^\d+\.\s+/, '');
        items.push(
          React.createElement('li', { key: `oli${idx}` }, parseInline(content, `ol${idx}`)),
        );
        idx++;
      }
      elements.push(React.createElement('ol', { key: `ol${idx}`, className: 'cb-md-ol' }, items));
      continue;
    }

    if (line.trim() === '') {
      idx++;
      continue;
    }

    elements.push(
      React.createElement('p', { key: `p${idx}`, className: 'cb-md-p' }, parseInline(line, `p${idx}`)),
    );
    idx++;
  }

  return elements;
}
