import React from 'react';

// Section-name patterns → DOM id for in-page cross-reference scrolling
const XREF_SECTION_MAP = [
    { patterns: ['warnings and precautions', 'warnings', 'boxed warning'], id: 'dv-section-warnings' },
    { patterns: ['adverse reactions', 'adverse effects'],                  id: 'dv-section-side-effects' },
    { patterns: ['drug interactions'],                                     id: 'dv-section-interactions' },
    { patterns: ['clinical pharmacology', 'pharmacokinetics', 'mechanism of action'], id: 'dv-section-pharmacology' },
    { patterns: ['dosage and administration', 'dosing'],                   id: 'dv-section-dosing' },
    { patterns: ['use in specific populations', 'pregnancy'],              id: 'dv-section-population' },
    { patterns: ['indications and usage', 'uses'],                         id: 'dv-section-uses' },
    { patterns: ['nutrition'],                                             id: 'dv-section-nutrition' },
];

function resolveSectionId(refText) {
    const lower = refText.toLowerCase();
    for (const { patterns, id } of XREF_SECTION_MAP) {
        if (patterns.some((p) => lower.includes(p))) return id;
    }
    return null;
}

// Matches [see Anything Here (5.1)] or [see Something].
// Parenthesised form (see X) is converted to bracket form by _presplitFdaBlob.
const XREF_RE = /\[\s*see\s+([^\]]+?)\s*\]/gi;

function parseInlineXrefs(line, lineKey) {
    if (!line.includes('[')) return line;
    const parts = [];
    let lastIndex = 0;
    let xrefIdx = 0;
    const re = new RegExp(XREF_RE.source, XREF_RE.flags);
    let match;

    while ((match = re.exec(line)) !== null) {
        if (match.index > lastIndex) parts.push(line.slice(lastIndex, match.index));
        const refText = match[1].trim();
        const sectionId = resolveSectionId(refText);
        if (sectionId) {
            parts.push(
                React.createElement('a', {
                    key: `${lineKey}-xr${xrefIdx}`,
                    className: 'dv-fda-xref',
                    href: `#${sectionId}`,
                    onClick: (e) => {
                        e.preventDefault();
                        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    },
                }, `see ${refText}`)
            );
        } else {
            parts.push(
                React.createElement('span', {
                    key: `${lineKey}-xr${xrefIdx}`,
                    className: 'dv-fda-xref-text',
                }, `see ${refText}`)
            );
        }
        lastIndex = match.index + match[0].length;
        xrefIdx++;
    }

    if (lastIndex < line.length) parts.push(line.slice(lastIndex));
    return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
}

// ── Pre-splitter for long Rx SPL blobs ──────────────────────────────────────
// For text ≥500 chars with ≤5 newlines, inserts blank lines around known
// ALL-CAPS section headers and breaks at ". Capital" sentence boundaries.
//
// Optional leading section number (e.g. "1 ", "14.2 ") before an ALL-CAPS
// title is consumed so it doesn't appear as an orphaned bullet point.
const _SPL_CAPS_SECT_RE = new RegExp(
    '(?<![\\n])' +
    '(?:\\d+[\\d\\.]*\\s+)?' +           // optional leading section number: "1 ", "14.2 "
    '(BOXED\\s+WARNINGS?|WARNINGS?\\s+AND\\s+PRECAUTIONS?|WARNINGS?|PRECAUTIONS?' +
    '|CONTRAINDICATIONS?|OVERDOSAGE|ADVERSE\\s+REACTIONS?|DRUG\\s+INTERACTIONS?' +
    '|CLINICAL\\s+PHARMACOLOGY|DOSAGE\\s+AND\\s+ADMINISTRATION' +
    '|INDICATIONS?\\s+AND\\s+USAGE|HOW\\s+SUPPLIED' +
    '|MECHANISM\\s+OF\\s+ACTION|PHARMACOKINETICS' +
    '|NONCLINICAL\\s+TOXICOLOGY|USE\\s+IN\\s+SPECIFIC\\s+POPULATIONS?' +
    '|PATIENT\\s+COUNSELING(?:\\s+INFORMATION)?)' +
    '(?=\\s|$)',
    'g'
);

const _SPL_ABBR_RE = /^(?:approx|incl|resp|vs|al|e\.g|i\.e|i\.v|p\.o|b\.i\.d|t\.i\.d|q\.i\.d|q\.d|p\.r\.n|q\.h|i\.m|mg|mL|mcg|kg|mmol|mEq|IU|hr|min|sec|mo|yr|wk|Dr|Jr|Sr|Mr|Mrs|Ms|No|Vol|Fig|Ref|Eq|cf)$/i;

// Connector/function words allowed inside a numbered-section title
const _CONNECTOR_RE = /^(?:and|or|with|in|of|for|by|from|on|at|to|not|a|an|the|including|via)$/i;

// Matches (see X) including one level of nested parens, e.g. (see Warnings (5.1))
const _PAREN_XREF_RE = /\(see\s+(?:[^)(]|\([^)]*\))+\)/gi;

// Splits "Administration with a Jet Nebulizer Patients should be advised..."
// into { title: "Administration with a Jet Nebulizer", body: "Patients should be advised..." }
// Heuristic: title = consecutive capitalized words (+ short connectors);
// stops when it sees [Cap word] immediately followed by a lowercase prose word (> 2 chars).
function _extractNumSectionTitle(rest) {
    const words = rest.split(/\s+/);
    let i = 0;
    while (i < words.length) {
        const word  = words[i];
        const next  = words[i + 1] || '';
        const nn    = words[i + 2] || '';
        if (_CONNECTOR_RE.test(word) && i > 0) { i++; continue; }
        if (/^[A-Z]/.test(word)) {
            const nnIsBody = nn && /^[a-z]/.test(nn) && nn.length > 2 && !_CONNECTOR_RE.test(nn);
            // "Nebulizer Patients should" → next is cap, nn is lowercase prose → body starts at next
            if (/^[A-Z]/.test(next) && nnIsBody) { i++; break; }
            // "Effects long-term use" → next itself is lowercase prose
            if (/^[a-z]/.test(next) && next.length > 3 && !_CONNECTOR_RE.test(next)) { i++; break; }
            i++;
        } else {
            break;
        }
    }
    return { title: words.slice(0, i).join(' '), body: words.slice(i).join(' ') };
}

function _presplitFdaBlob(text) {
    if (text.length < 500) return text;
    if ((text.match(/\n/g) || []).length > 5) return text;

    // Mask parenthesised cross-refs BEFORE Pass 1 so the section-title splitter
    // does not fragment section names that appear inside them, e.g. "(see WARNINGS)."
    // On restore they are converted to bracket form so parseInlineXrefs picks them up.
    const masks = [];
    text = text.replace(_PAREN_XREF_RE, (m) => {
        masks.push(m);
        return `\x00M${masks.length - 1}\x00`;
    });

    // Pass 1: insert blank lines around known ALL-CAPS section titles.
    // The optional non-capturing prefix also eats any leading section number.
    text = text.replace(_SPL_CAPS_SECT_RE, '\n\n$1\n\n')
               .replace(/^\n+/, '')
               .replace(/\n{3,}/g, '\n\n');

    // Pass 1.5: insert \n\n before numbered subsection headers, e.g. "17.1 Administration".
    // Matches any word/punct char immediately followed by whitespace then "N.M TitleWord..."
    // Lookahead [A-Z][a-z] ensures it's a Title-Case word, not a unit like "mg" or "mL".
    text = text.replace(
        /([A-Za-z.!?)0-9])\s+(\d{1,2}\.\d{1,3}(?:\.\d+)?)\s+(?=[A-Z][a-z])/g,
        '$1\n\n$2 '
    ).replace(/\n{3,}/g, '\n\n');

    // Pass 2: break at ". Capital" sentence boundaries (double-newline = new <p>).
    text = text.replace(/([.!?])\s+([A-Z])/g, (match, punct, cap, offset, str) => {
        const preceding = str.slice(0, offset + 1);
        const wm = preceding.match(/\b(\w+)\.$/);
        if (wm) {
            const w = wm[1];
            if (w.length <= 1) return match;        // single letter (i. ii. A. B.)
            if (/^\d+$/.test(w)) return match;      // number (1. 2. 10.)
            if (_SPL_ABBR_RE.test(w)) return match; // known abbreviation
        }
        return punct + '\n\n' + cap;                // double newline → separate <p>
    });

    // Restore masked cross-refs as [see X] bracket form.
    masks.forEach((m, i) => {
        // "(see X)" → "[see X]"  (strip outer parens, swap to square brackets)
        const inner = m.slice(1, -1);               // remove leading ( and trailing )
        const bracketForm = inner.replace(/^see\s+/i, '[see ') + ']';
        text = text.replace(`\x00M${i}\x00`, bracketForm);
    });

    return text.replace(/\n{3,}/g, '\n\n');
}

// ── Heading detection ────────────────────────────────────────────────────────
const FDA_HEADINGS = [
    'Active ingredient', 'Active ingredients',
    'Inactive ingredient', 'Inactive ingredients',
    'Purpose', 'Purposes',
    'Use', 'Uses',
    'Warning', 'Warnings',
    'Directions', 'Direction',
    'Other information', 'Other safety information',
    'Questions', 'Questions or comments',
    'Stop use', 'Stop use and ask a doctor',
    'Do not use',
    'Ask a doctor', 'Ask a doctor or pharmacist',
    'Keep out of reach of children',
    'When using this product',
    'Pregnancy', 'Pregnancy or breast-feeding',
    'Dosage', 'Dosage and administration',
    'Storage', 'Storage and handling',
    'Indications', 'Indications and usage',
    'Contraindications',
    'Mechanism of action',
    'Pharmacokinetics', 'Pharmacology', 'Clinical pharmacology',
    'Adverse reactions', 'Adverse effects',
    'Precautions', 'General precautions',
    'Boxed warning', 'Black box warning',
    'Drug interactions',
    'Overdosage', 'Overdose',
    'How supplied',
    'Description',
];

const FDA_HEADING_RE = (() => {
    const escaped = FDA_HEADINGS
        .slice()
        .sort((a, b) => b.length - a.length)
        .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp('^(' + escaped.join('|') + ')\\s*:\\s*', 'i');
})();

// ALL-CAPS prefix ending in ':'
const FDA_CAPS_RE = /^([A-Z][A-Z &/-]{2,60})\s*:\s*/;
// Standalone ALL-CAPS section title (no colon) — produced by _presplitFdaBlob pass 1
const FDA_ALLCAPS_SOLO_RE = /^([A-Z][A-Z\s&/-]{4,69})$/;
// Numbered subsection header, e.g. "17.1 Administration with a Jet Nebulizer"
const FDA_NUM_SECT_RE = /^(\d{1,2}\.\d{1,3}(?:\.\d+)?)\s+(.+)$/;

// ── Main renderer ────────────────────────────────────────────────────────────
export default function renderFdaText(text) {
    if (text == null) return null;
    const raw = String(text);
    if (!raw.trim()) return null;

    const processed = _presplitFdaBlob(raw);
    const lines = processed.replace(/\r\n?/g, '\n').split('\n');
    const elements = [];
    let paraBuf = []; // pending parsed line parts for current <p>
    let keyCounter = 0;

    function nextKey() { return keyCounter++; }

    function flushPara() {
        if (!paraBuf.length) return;
        const children = [];
        paraBuf.forEach((lineParts, li) => {
            if (li > 0) children.push(React.createElement('br', { key: `br-${nextKey()}` }));
            if (Array.isArray(lineParts)) {
                lineParts.forEach((part) => children.push(part));
            } else {
                children.push(lineParts);
            }
        });
        elements.push(React.createElement('p', { key: `para-${nextKey()}`, className: 'fda-para' }, ...children));
        paraBuf = [];
    }

    lines.forEach((lineRaw, lineIdx) => {
        const line = lineRaw.trim();
        if (!line) { flushPara(); return; }

        const m = line.match(FDA_HEADING_RE) || line.match(FDA_CAPS_RE) || line.match(FDA_ALLCAPS_SOLO_RE);
        const mNum = !m && line.match(FDA_NUM_SECT_RE);
        if (mNum) {
            const { title, body } = _extractNumSectionTitle(mNum[2]);
            flushPara();
            elements.push(
                React.createElement('span', { key: `sh-block-${nextKey()}`, className: 'fda-subhead block' },
                    `${mNum[1]} ${title}`)
            );
            if (body) paraBuf.push(parseInlineXrefs(body, `${lineIdx}`));
            return;
        }
        if (m) {
            const heading = m[1];
            const rest = line.slice(m[0].length).trim();
            flushPara();
            if (rest) {
                const restParsed = parseInlineXrefs(rest, `${lineIdx}`);
                elements.push(
                    React.createElement('p', { key: `para-${nextKey()}`, className: 'fda-para' },
                        React.createElement('span', { key: `sh-${lineIdx}`, className: 'fda-subhead' }, `${heading}:`),
                        ' ',
                        ...(Array.isArray(restParsed) ? restParsed : [restParsed])
                    )
                );
            } else {
                const hadColon = m[0].trimEnd().endsWith(':');
                elements.push(
                    React.createElement('span', { key: `sh-block-${nextKey()}`, className: 'fda-subhead block' },
                        heading + (hadColon ? ':' : ''))
                );
            }
            return;
        }

        paraBuf.push(parseInlineXrefs(line, `${lineIdx}`));
    });

    flushPara();
    return elements.length > 0 ? elements : null;
}
