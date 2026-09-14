/**
 * Drug-source helpers for DoseGPT chat messages.
 *
 * When the model answers from tool results, the drugs it actually mentions are
 * attached to the assistant message as "sources" so the UI can link back to the
 * drug pages. Sources are persisted inside the message content itself using a
 * trailing marker, so no schema change is required:
 *
 *     <answer text>\n\n[[dosegpt-sources]][{"id":123,"name":"Paracetamol"}]
 *
 * The marker is stripped before content reaches the model or the client.
 */

const SOURCES_MARKER = '\n\n[[dosegpt-sources]]';
const MAX_SOURCES = 6;
// Keep in sync with chk_content_length on the messages tables.
const MAX_STORED_CONTENT_LENGTH = 10000;
const MIN_MATCHABLE_NAME_LENGTH = 3;

function parseNameList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item ?? '').trim()).filter(Boolean);
    }
    if (typeof value !== 'string') return [];
    const raw = value.trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
        }
        return [String(parsed ?? '').trim()].filter(Boolean);
    } catch {
        return raw.split(',').map((item) => item.trim()).filter(Boolean);
    }
}

function toCandidate(entry) {
    const id = Number.parseInt(entry?.drug_id, 10);
    if (!Number.isInteger(id) || id <= 0) return null;

    const brandNames = parseNameList(entry?.brand_names);
    const genericName = typeof entry?.generic_name === 'string' ? entry.generic_name.trim() : '';
    const displayName = genericName || brandNames[0] || '';
    if (!displayName) return null;

    const aliases = [...new Set(
        [displayName, ...brandNames, ...parseNameList(entry?.arabic_trade_name)]
            .filter((alias) => alias.length >= MIN_MATCHABLE_NAME_LENGTH),
    )];

    return { id, name: displayName, aliases };
}

/**
 * Pull drug candidates out of a tool result and push them onto the accumulator.
 * Supports searchDrugs (`result.results`) and the legacy SQL tool (`result.rows`,
 * only rows that expose drug_id + a name column).
 */
function collectSourceCandidates(toolName, result, accumulator) {
    if (!Array.isArray(accumulator) || !result || result.ok === false) return;

    const entries = Array.isArray(result.results)
        ? result.results
        : Array.isArray(result.rows) ? result.rows : [];

    for (const entry of entries) {
        const candidate = toCandidate(entry);
        if (candidate) accumulator.push(candidate);
    }
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isMentioned(alias, answerText) {
    if (alias.length < MIN_MATCHABLE_NAME_LENGTH) return false;
    // Custom boundary instead of \b so non-Latin names (Arabic trade names) match too.
    const pattern = new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapeRegExp(alias)}([^\\p{L}\\p{N}]|$)`,
        'iu',
    );
    return pattern.test(answerText);
}

/**
 * Keep only the retrieved drugs the answer actually mentions, deduped by id and
 * by display name (the catalog stores several records per generic name — six
 * identical "Ibuprofen" pills help nobody). An answer like "DoseFinder did not
 * find a match" naturally yields no sources.
 */
function buildMentionedSources(candidates, answerText) {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    if (typeof answerText !== 'string' || !answerText.trim()) return [];

    const sources = [];
    const seenIds = new Set();
    const seenNames = new Set();

    for (const candidate of candidates) {
        if (sources.length >= MAX_SOURCES) break;
        if (!candidate || seenIds.has(candidate.id)) continue;
        const nameKey = candidate.name.toLowerCase();
        if (seenNames.has(nameKey)) continue;
        if (!candidate.aliases.some((alias) => isMentioned(alias, answerText))) continue;
        seenIds.add(candidate.id);
        seenNames.add(nameKey);
        sources.push({ id: candidate.id, name: candidate.name });
    }

    return sources;
}

/** Append the sources marker to content for storage. Drops sources over the size cap. */
function encodeMessageSources(content, sources) {
    if (typeof content !== 'string' || !Array.isArray(sources) || sources.length === 0) {
        return content;
    }
    const payload = JSON.stringify(sources.map(({ id, name }) => ({ id, name })));
    const encoded = `${content}${SOURCES_MARKER}${payload}`;
    return encoded.length <= MAX_STORED_CONTENT_LENGTH ? encoded : content;
}

/** Split stored content into clean text + sources. Tolerates unmarked/legacy content. */
function decodeMessageSources(rawContent) {
    if (typeof rawContent !== 'string') return { content: '', sources: [] };

    const markerIndex = rawContent.lastIndexOf(SOURCES_MARKER);
    if (markerIndex === -1) return { content: rawContent, sources: [] };

    try {
        const parsed = JSON.parse(rawContent.slice(markerIndex + SOURCES_MARKER.length));
        const sources = Array.isArray(parsed)
            ? parsed
                .filter((source) => Number.isInteger(source?.id) && source.id > 0
                    && typeof source?.name === 'string' && source.name.trim())
                .map(({ id, name }) => ({ id, name }))
            : [];
        return { content: rawContent.slice(0, markerIndex).trimEnd(), sources };
    } catch {
        return { content: rawContent, sources: [] };
    }
}

function stripMessageSources(rawContent) {
    return decodeMessageSources(rawContent).content;
}

module.exports = {
    SOURCES_MARKER,
    collectSourceCandidates,
    buildMentionedSources,
    encodeMessageSources,
    decodeMessageSources,
    stripMessageSources,
};
