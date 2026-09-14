const express = require('express');
const { getPool } = require('../config/db');
const { APP } = require('../config/constants');

const router = express.Router();

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function escapeHtml(value) {
    if (value === null || value === undefined) return '';

    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
}

function quoteIdentifier(identifier) {
    return `\`${String(identifier).replace(/`/g, '``')}\``;
}

function clampLimit(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
    return Math.min(parsed, MAX_LIMIT);
}

function normalizeRows(rows) {
    return rows.map(row => {
        const normalized = {};
        Object.entries(row).forEach(([key, value]) => {
            if (value instanceof Date) {
                normalized[key] = value.toISOString().replace('T', ' ').replace('.000Z', '');
                return;
            }

            if (Buffer.isBuffer(value)) {
                normalized[key] = value.toString('utf8');
                return;
            }

            normalized[key] = value;
        });
        return normalized;
    });
}

function formatValue(value) {
    if (value === null) return '<span class="null">NULL</span>';
    if (value === undefined) return '';

    const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    const escaped = escapeHtml(text);

    if (text.length > 180 || text.includes('\n') || /^[\[{]/.test(text.trim())) {
        return `<details><summary>${escapeHtml(text.slice(0, 120))}${text.length > 120 ? '...' : ''}</summary><pre>${escaped}</pre></details>`;
    }

    return escaped;
}

function renderRowsTable(columns, rows) {
    if (!rows.length) {
        return '<div class="empty">No info in this table for this drug_id.</div>';
    }

    return `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>${columns.map(column => `<th>${escapeHtml(column.name)}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${rows.map(row => `
                        <tr>
                            ${columns.map(column => `<td>${formatValue(row[column.name])}</td>`).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderColumns(columns) {
    return `
        <div class="columns">
            ${columns.map(column => `
                <span class="column">
                    <strong>${escapeHtml(column.name)}</strong>
                    <small>${escapeHtml(column.type)}${column.key ? ` / ${escapeHtml(column.key)}` : ''}</small>
                </span>
            `).join('')}
        </div>
    `;
}

function renderSection(result) {
    const statusClass = result.error ? 'error' : result.rows.length ? 'ok' : 'empty-count';
    const queryLabel = result.filter
        ? `<span class="query">${escapeHtml(result.filter)}</span>`
        : '<span class="query muted">not filtered</span>';

    return `
        <section>
            <div class="section-head">
                <div>
                    <h2>${escapeHtml(result.tableName)}</h2>
                    ${queryLabel}
                </div>
                <span class="count ${statusClass}">${result.error ? 'error' : `${result.rows.length} rows`}</span>
            </div>
            ${renderColumns(result.columns)}
            ${result.error
                ? `<div class="error-box">${escapeHtml(result.error)}</div>`
                : renderRowsTable(result.columns, result.rows)
            }
        </section>
    `;
}

function isEmptyResult(result) {
    return !result.error && result.rows.length === 0;
}

function renderEmptySectionRow(result) {
    const queryLabel = result.filter
        ? `<span class="query">${escapeHtml(result.filter)}</span>`
        : '<span class="query muted">not filtered</span>';

    return `
        <div class="empty-section-row">
            <div>
                <strong>${escapeHtml(result.tableName)}</strong>
                ${queryLabel}
            </div>
            <span class="count empty-count">0 rows</span>
        </div>
    `;
}

function renderEmptySectionsGroup(emptyTables) {
    if (!emptyTables.length) return '';

    return `
        <details class="empty-group">
            <summary>
                <span>Empty tables</span>
                <span class="count empty-count">${emptyTables.length} tables</span>
            </summary>
            <div class="empty-group-body">
                ${emptyTables.map(renderEmptySectionRow).join('')}
            </div>
        </details>
    `;
}

function renderPage({ id, limit, tables, versionIds, databaseName, error }) {
    const hasId = id !== '';
    const safeId = escapeAttribute(id);
    const safeLimit = escapeAttribute(limit);
    const emptyTables = tables.filter(isEmptyResult);
    const visibleTables = tables.filter(table => !isEmptyResult(table));

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Direct MySQL Drug Table Viewer</title>
<style>
* { box-sizing: border-box; }
:root {
    --bg: #f6f8fb;
    --panel: #ffffff;
    --text: #17202a;
    --muted: #5f6f82;
    --line: #d9e1eb;
    --soft: #edf3f8;
    --accent: #0f766e;
    --accent-dark: #115e59;
    --danger: #b42318;
    --ok: #0f766e;
    --empty: #8a5a00;
}
body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: Arial, Helvetica, sans-serif;
    line-height: 1.45;
}
header {
    position: sticky;
    top: 0;
    z-index: 10;
    border-bottom: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.97);
    backdrop-filter: blur(8px);
}
.bar {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    gap: 10px;
    align-items: end;
    width: min(1500px, calc(100vw - 32px));
    margin: 0 auto;
    padding: 16px 0;
}
h1, h2 { margin: 0; letter-spacing: 0; }
h1 { font-size: 24px; }
h2 { font-size: 18px; }
.sub {
    margin-top: 4px;
    color: var(--muted);
    font-size: 13px;
}
label {
    display: grid;
    gap: 5px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
}
input {
    min-height: 38px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 8px 10px;
    background: #fff;
    color: var(--text);
    font: inherit;
}
input[name="id"] { width: 180px; }
input[name="limit"] { width: 120px; }
button {
    min-height: 38px;
    border: 0;
    border-radius: 6px;
    padding: 8px 16px;
    background: var(--accent);
    color: #fff;
    font-weight: 700;
    cursor: pointer;
}
button:hover { background: var(--accent-dark); }
main {
    width: min(1500px, calc(100vw - 32px));
    margin: 18px auto 32px;
}
.notice, .error-box {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    padding: 12px 14px;
    color: var(--muted);
    margin-bottom: 14px;
}
.error-box {
    border-color: #f0b8b2;
    background: #fff7f6;
    color: var(--danger);
}
.summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
}
.pill {
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--panel);
    padding: 6px 10px;
    color: var(--muted);
    font-size: 13px;
}
section {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    margin-bottom: 14px;
    overflow: hidden;
}
.section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    border-bottom: 1px solid var(--line);
    background: #fbfcfe;
    padding: 14px;
}
.query {
    display: inline-block;
    margin-top: 5px;
    color: var(--muted);
    font-family: Consolas, 'Courier New', monospace;
    font-size: 12px;
}
.muted { color: var(--muted); }
.count {
    flex: 0 0 auto;
    border-radius: 999px;
    padding: 4px 9px;
    background: var(--soft);
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
}
.count.ok { color: var(--ok); }
.count.error { color: var(--danger); }
.count.empty-count { color: var(--empty); }
.columns {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    border-bottom: 1px solid var(--line);
    padding: 10px 14px;
}
.column {
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 4px 8px;
    background: #fff;
    font-size: 12px;
}
.column small { color: var(--muted); }
.table-wrap {
    width: 100%;
    overflow: auto;
}
table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}
th, td {
    border-bottom: 1px solid var(--line);
    border-right: 1px solid var(--line);
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
}
th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--soft);
    color: var(--muted);
    font-size: 11px;
    line-height: 1.2;
    padding: 5px 7px;
    text-transform: uppercase;
    white-space: nowrap;
}
td {
    max-width: 420px;
    overflow-wrap: anywhere;
}
tr:last-child td { border-bottom: 0; }
.empty {
    padding: 16px 14px;
    color: var(--muted);
}
.empty-group {
    border: 1px dashed var(--line);
    border-radius: 8px;
    background: var(--panel);
    margin-top: 18px;
    overflow: hidden;
}
.empty-group summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    color: var(--muted);
    cursor: pointer;
    font-weight: 700;
}
.empty-group-body {
    display: grid;
    gap: 0;
    border-top: 1px solid var(--line);
}
.empty-section-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line);
}
.empty-section-row:last-child { border-bottom: 0; }
.empty-section-row strong {
    display: block;
    font-size: 13px;
}
.null {
    color: var(--muted);
    font-style: italic;
}
details summary {
    cursor: pointer;
    color: var(--accent-dark);
}
pre {
    white-space: pre-wrap;
    margin: 8px 0 0;
    font-family: Consolas, 'Courier New', monospace;
    font-size: 12px;
}
@media (max-width: 800px) {
    .bar { grid-template-columns: 1fr; align-items: stretch; }
    input, input[name="id"], input[name="limit"], button { width: 100%; }
    .section-head { display: grid; }
}
</style>
</head>
<body>
<header>
    <form class="bar" method="GET" action="/drug-db-tables">
        <div>
            <h1>Direct MySQL Drug Table Viewer</h1>
            <div class="sub">Queries the MySQL database directly from the Node backend. Each table is queried separately; no SQL joins are used.</div>
        </div>
        <label>
            drug_id
            <input name="id" value="${safeId}" inputmode="numeric" placeholder="4073" required>
        </label>
        <label>
            row limit
            <input name="limit" value="${safeLimit}" inputmode="numeric">
        </label>
        <button type="submit">Load Tables</button>
    </form>
</header>
<main>
    ${error ? `<div class="error-box">${escapeHtml(error)}</div>` : ''}
    <div class="notice">
        Enter a public <strong>drug_id</strong>. The page first reads matching rows from <code>drug_versions</code>, then queries every database table independently by <code>drug_id</code> or <code>version_id</code> when that column exists.
    </div>
    <div class="summary">
        <span class="pill">database: <strong>${escapeHtml(databaseName || 'unknown')}</strong></span>
        <span class="pill">tables: <strong>${tables.length}</strong></span>
        <span class="pill">with info: <strong>${visibleTables.length}</strong></span>
        <span class="pill">empty: <strong>${emptyTables.length}</strong></span>
        <span class="pill">drug_id: <strong>${hasId ? escapeHtml(id) : 'not selected'}</strong></span>
        <span class="pill">version_ids: <strong>${versionIds.length ? escapeHtml(versionIds.join(', ')) : 'none'}</strong></span>
        <span class="pill">limit/table: <strong>${escapeHtml(limit)}</strong></span>
    </div>
    ${hasId
        ? `${visibleTables.map(renderSection).join('')}${renderEmptySectionsGroup(emptyTables)}`
        : '<div class="notice">No drug_id loaded yet.</div>'
    }
</main>
</body>
</html>`;
}

async function getTableMetadata(pool) {
    const [tables] = await pool.query(`
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
    `);

    const [columns] = await pool.query(`
        SELECT
            TABLE_NAME AS tableName,
            COLUMN_NAME AS name,
            COLUMN_TYPE AS type,
            COLUMN_KEY AS \`key\`
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME, ORDINAL_POSITION
    `);

    const columnMap = new Map();
    columns.forEach(column => {
        if (!columnMap.has(column.tableName)) columnMap.set(column.tableName, []);
        columnMap.get(column.tableName).push({
            name: column.name,
            type: column.type,
            key: column.key
        });
    });

    return tables.map(table => ({
        tableName: table.tableName,
        columns: columnMap.get(table.tableName) || []
    }));
}

async function getVersionIds(pool, drugId) {
    const [rows] = await pool.query(
        'SELECT `version_id` FROM `drug_versions` WHERE `drug_id` = ? ORDER BY `version_id`',
        [drugId]
    );
    return rows.map(row => row.version_id);
}

function buildTableQuery(table, drugId, versionIds, limit) {
    const columnNames = new Set(table.columns.map(column => column.name));
    const tableName = quoteIdentifier(table.tableName);

    if (columnNames.has('drug_id')) {
        return {
            sql: `SELECT * FROM ${tableName} WHERE ${quoteIdentifier('drug_id')} = ? LIMIT ${limit}`,
            params: [drugId],
            filter: 'WHERE drug_id = ?'
        };
    }

    if (columnNames.has('version_id')) {
        if (!versionIds.length) {
            return {
                sql: null,
                params: [],
                filter: 'WHERE version_id IN (version_ids for drug_id)'
            };
        }

        const placeholders = versionIds.map(() => '?').join(', ');
        return {
            sql: `SELECT * FROM ${tableName} WHERE ${quoteIdentifier('version_id')} IN (${placeholders}) LIMIT ${limit}`,
            params: versionIds,
            filter: 'WHERE version_id IN (version_ids for drug_id)'
        };
    }

    return {
        sql: null,
        params: [],
        filter: 'No drug_id/version_id column'
    };
}

async function loadTableRows(pool, table, drugId, versionIds, limit) {
    const query = buildTableQuery(table, drugId, versionIds, limit);

    if (!query.sql) {
        return {
            ...table,
            rows: [],
            filter: query.filter
        };
    }

    try {
        const [rows] = await pool.query(query.sql, query.params);
        return {
            ...table,
            rows: normalizeRows(rows),
            filter: query.filter
        };
    } catch (error) {
        return {
            ...table,
            rows: [],
            filter: query.filter,
            error: error.message
        };
    }
}

router.get('/', async (req, res) => {
    if (APP.ENV === 'production') {
        return res.status(404).send('Not found');
    }

    const id = String(req.query.id || req.query.drug_id || '').trim();
    const limit = clampLimit(req.query.limit);

    try {
        const pool = getPool();
        const [[databaseRow]] = await pool.query('SELECT DATABASE() AS databaseName');
        const metadata = await getTableMetadata(pool);

        let versionIds = [];
        let tables = metadata.map(table => ({ ...table, rows: [], filter: 'No drug_id loaded' }));

        if (id) {
            versionIds = await getVersionIds(pool, id);
            tables = await Promise.all(metadata.map(table => (
                loadTableRows(pool, table, id, versionIds, limit)
            )));
        }

        res.type('html').send(renderPage({
            id,
            limit,
            tables,
            versionIds,
            databaseName: databaseRow?.databaseName || '',
            error: ''
        }));
    } catch (error) {
        res.status(500).type('html').send(renderPage({
            id,
            limit,
            tables: [],
            versionIds: [],
            databaseName: '',
            error: error.message
        }));
    }
});

module.exports = router;
