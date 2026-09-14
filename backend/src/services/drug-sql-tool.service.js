const { getPool } = require('../config/db');
const AdminModel = require('../models/admin.model');
const { getActiveDrugIdSet, isDrugAccessibleForUser } = require('../utils/drugAccess');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const MAX_SQL_LENGTH = 3000;
const MAX_CELL_LENGTH = 1200;

const ERROR_CATEGORIES = Object.freeze({
    EMPTY_RESULT: 'empty_result',
    INVALID_TABLE: 'invalid_table',
    SQL_SYNTAX_ERROR: 'sql_syntax_error',
    UNKNOWN_COLUMN: 'unknown_column',
    UNSAFE_QUERY: 'unsafe_query',
    ACCESS_FILTER_REQUIRED: 'access_filter_required',
    SQL_EXECUTION_ERROR: 'sql_execution_error',
});

const WARNING_CATEGORIES = Object.freeze({
    LIMIT_CLAMPED: 'limit_clamped',
    MISSING_CURRENT_FILTER: 'missing_current_filter',
    MISSING_NOT_DELETED_FILTER: 'missing_not_deleted_filter',
    MISSING_DRUG_NAME_FILTER: 'missing_drug_name_filter',
    SELECT_STAR: 'select_star',
    TOO_MANY_DETAIL_JOINS: 'too_many_detail_joins',
});

const DRUG_SCHEMA = {
    drug_versions: ['version_id', 'drug_id', 'version_number', 'updated_at', 'is_current', 'is_deleted', 'deleted_at'],
    drug_master: ['version_id', 'generic_name', 'url', 'rx_status', 'brand_names', 'source', 'doctor_id'],
    drug_dms_extensions: ['id', 'version_id', 'ham', 'price', 'notes', 'route', 'arabic_route', 'arabic_trade_name'],
    drug_fda_products: ['id', 'version_id', 'product_ndc', 'application_number'],
    drug_fda_submissions: ['id', 'version_id', 'application_number', 'submission_type', 'submission_number', 'submission_status', 'submission_status_date', 'application_docs_json'],
    drug_fda_extensions: ['id', 'version_id', 'marketing_category', 'marketing_status', 'manufacturer_name', 'review_priority', 'active_ingredient', 'inactive_ingredient'],
    drug_dosage_forms: ['id', 'version_id', 'population', 'form_name', 'strength_text'],
    drug_dosing: ['id', 'version_id', 'population', 'indication', 'sub_indication', 'list_header', 'notes_text'],
    drug_administration: ['id', 'version_id', 'topic', 'sub_topic', 'list_header', 'text'],
    drug_adverse_effects: ['id', 'version_id', 'severity_band', 'body_system', 'list_header', 'effect_text'],
    drug_interactions: ['id', 'version_id', 'severity_level', 'interacting_drug', 'description'],
    drug_warnings: ['id', 'version_id', 'warning_type', 'sub_warning_type', 'list_header', 'text'],
    drug_pharmacology: ['id', 'version_id', 'topic', 'sub_topic', 'list_header', 'text'],
    drug_pregnancy: ['id', 'version_id', 'topic', 'sub_topic', 'list_header', 'text'],
    drug_nutrition: ['id', 'version_id', 'topic', 'text'],
    drug_suggested_uses: ['id', 'version_id', 'topic', 'text'],
    drug_suggested_dosing: ['id', 'version_id', 'population', 'indication', 'sub_indication', 'list_header', 'notes_text'],
    drug_categories: ['id', 'name', 'url'],
    drug_subcategories: ['id', 'category_id', 'name', 'subcategory_id_slug'],
    drug_subcategory_listing: ['id', 'subcategory_id', 'version_id'],
    drug_classes: ['id', 'version_id', 'class_name'],
};

const ALLOWED_TABLES = new Set(Object.keys(DRUG_SCHEMA));
const DETAIL_TABLES = new Set([
    'drug_dms_extensions',
    'drug_fda_products',
    'drug_fda_submissions',
    'drug_fda_extensions',
    'drug_dosage_forms',
    'drug_dosing',
    'drug_administration',
    'drug_adverse_effects',
    'drug_interactions',
    'drug_warnings',
    'drug_pharmacology',
    'drug_pregnancy',
    'drug_nutrition',
    'drug_suggested_uses',
    'drug_suggested_dosing',
    'drug_classes',
]);

const FORBIDDEN_SQL_PATTERN = /\b(insert|update|delete|drop|alter|create|truncate|replace|grant|revoke|call|execute|prepare|set|use|lock|unlock|load|outfile|infile|into|union|information_schema|mysql|performance_schema|sys|users|doctors|saved_drugs|conversations|messages|auth_sessions|password_reset_otps|email_change_otps|drug_issues)\b/i;
const FORBIDDEN_FUNCTION_PATTERN = /\b(database|user|current_user|session_user|system_user|version|sleep|benchmark)\s*\(/i;
const AGGREGATE_FUNCTION_PATTERN = /\b(?:count|sum|avg|min|max|group_concat|json_arrayagg|json_objectagg)\s*\(/i;
const GROUPING_PATTERN = /\b(?:group\s+by|having)\b/i;
const SUBQUERY_PATTERN = /\(\s*select\b/i;
const CURRENT_FILTER_PATTERN = /\bis_current\s*=\s*(?:1|true)\b/i;
const NOT_DELETED_FILTER_PATTERN = /(?:\bcoalesce\s*\(\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?is_deleted\s*,\s*0\s*\)\s*=\s*0\b|\bis_deleted\s*=\s*(?:0|false)\b)/i;
const DRUG_NAME_FIELD_PATTERN = /\b(?:generic_name|brand_names|arabic_trade_name|drug_id)\b/i;

class SqlToolError extends Error {
    constructor(category, message, details = {}) {
        super(message);
        this.name = 'SqlToolError';
        this.category = category;
        this.details = details;
    }
}

function stripQuotedText(sql) {
    return sql
        .replace(/'([^'\\]|\\.)*'/g, "''")
        .replace(/"([^"\\]|\\.)*"/g, '""');
}

function parsePositiveInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getRowDrugId(row = {}) {
    const preferredKeys = ['drug_id', 'drugId', 'public_drug_id', 'publicDrugId'];
    for (const key of preferredKeys) {
        const parsed = parsePositiveInteger(row[key]);
        if (parsed) return parsed;
    }

    const aliasedDrugIdKey = Object.keys(row).find((key) => /(^|_)drug_?id$/i.test(key));
    return aliasedDrugIdKey ? parsePositiveInteger(row[aliasedDrugIdKey]) : null;
}

function normalizeLimit(limit) {
    const parsed = parsePositiveInteger(limit);
    if (!parsed) return DEFAULT_LIMIT;
    return Math.min(parsed, MAX_LIMIT);
}

function extractReferencedTables(sqlWithoutQuotedText) {
    return Array.from(sqlWithoutQuotedText.matchAll(/\b(?:from|join)\s+([`"]?)([a-zA-Z_][a-zA-Z0-9_]*)\1/gi))
        .map((match) => match[2].toLowerCase());
}

function extractWhereClause(sqlWithoutQuotedText) {
    const match = sqlWithoutQuotedText.match(/\bwhere\b([\s\S]*?)(?:\bgroup\s+by\b|\border\s+by\b|\bhaving\b|\blimit\b|$)/i);
    return match ? match[1] : '';
}

function queryHasDrugNameFilter(sqlWithoutQuotedText) {
    return DRUG_NAME_FIELD_PATTERN.test(extractWhereClause(sqlWithoutQuotedText));
}

function queryReferencesVersionedData(referencedTables) {
    return referencedTables.some((tableName) => tableName === 'drug_versions' || DRUG_SCHEMA[tableName]?.includes('version_id'));
}

function getSelectList(sqlWithoutQuotedText) {
    const match = sqlWithoutQuotedText.match(/^\s*select\s+(?:distinct\s+)?([\s\S]+?)\bfrom\b/i);
    return match ? match[1] : '';
}

function hasSelectStar(sqlWithoutQuotedText) {
    return /(^|,)\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\.)?\*\s*(?:,|$)/i.test(getSelectList(sqlWithoutQuotedText));
}

function uniqueValues(values) {
    return Array.from(new Set(values));
}

function createWarning(category, message, details = {}) {
    return {
        category,
        severity: 'warning',
        message,
        ...details,
    };
}

function collectQualityWarnings(sqlWithoutQuotedText, referencedTables) {
    const warnings = [];
    const uniqueTables = uniqueValues(referencedTables);

    if (hasSelectStar(sqlWithoutQuotedText)) {
        warnings.push(createWarning(
            WARNING_CATEGORIES.SELECT_STAR,
            'Select only columns needed for the final answer instead of SELECT *.'
        ));
    }

    if (queryReferencesVersionedData(uniqueTables) && !CURRENT_FILTER_PATTERN.test(sqlWithoutQuotedText)) {
        warnings.push(createWarning(
            WARNING_CATEGORIES.MISSING_CURRENT_FILTER,
            'Current user-facing drug answers should normally include drug_versions.is_current = 1.'
        ));
    }

    if (queryReferencesVersionedData(uniqueTables) && !NOT_DELETED_FILTER_PATTERN.test(sqlWithoutQuotedText)) {
        warnings.push(createWarning(
            WARNING_CATEGORIES.MISSING_NOT_DELETED_FILTER,
            'Current user-facing drug answers should normally include COALESCE(drug_versions.is_deleted, 0) = 0.'
        ));
    }

    const joinedDetailTables = uniqueTables.filter((tableName) => DETAIL_TABLES.has(tableName));
    if (joinedDetailTables.length > 2) {
        warnings.push(createWarning(
            WARNING_CATEGORIES.TOO_MANY_DETAIL_JOINS,
            'Query joins many detail tables. Prefer one focused detail table per answer unless comparing related fields.',
            { tables: joinedDetailTables }
        ));
    }

    if (uniqueTables.includes('drug_master') && !queryHasDrugNameFilter(sqlWithoutQuotedText)) {
        warnings.push(createWarning(
            WARNING_CATEGORIES.MISSING_DRUG_NAME_FILTER,
            'Drug-specific lookups should usually filter by generic_name, brand_names, arabic_trade_name, or drug_id.'
        ));
    }

    return warnings;
}

function normalizeSql(sql) {
    if (typeof sql !== 'string') {
        throw new SqlToolError(ERROR_CATEGORIES.SQL_SYNTAX_ERROR, 'SQL query must be a string.');
    }

    const trimmed = sql.trim();
    if (!trimmed) {
        throw new SqlToolError(ERROR_CATEGORIES.SQL_SYNTAX_ERROR, 'SQL query is required.');
    }

    if (trimmed.length > MAX_SQL_LENGTH) {
        throw new SqlToolError(
            ERROR_CATEGORIES.UNSAFE_QUERY,
            `SQL query is too long. Keep it under ${MAX_SQL_LENGTH} characters.`
        );
    }

    if (/;/.test(trimmed)) {
        throw new SqlToolError(ERROR_CATEGORIES.UNSAFE_QUERY, 'Multiple statements and semicolons are not allowed.');
    }

    if (/\?/.test(trimmed)) {
        throw new SqlToolError(ERROR_CATEGORIES.SQL_SYNTAX_ERROR, 'SQL placeholders are not allowed. Write literal read-only filters only.');
    }

    if (!/^\s*select\b/i.test(trimmed)) {
        throw new SqlToolError(ERROR_CATEGORIES.UNSAFE_QUERY, 'Only read-only SELECT queries are allowed.');
    }

    const withoutQuotedText = stripQuotedText(trimmed);
    if (/--|#|\/\*/.test(withoutQuotedText)) {
        throw new SqlToolError(ERROR_CATEGORIES.UNSAFE_QUERY, 'SQL comments are not allowed.');
    }

    if (/\b(?:from|join)\s+[`"]?[a-zA-Z_][a-zA-Z0-9_]*[`"]?\s*\./i.test(withoutQuotedText)) {
        throw new SqlToolError(ERROR_CATEGORIES.INVALID_TABLE, 'Schema-qualified table names are not allowed.');
    }

    if (FORBIDDEN_SQL_PATTERN.test(withoutQuotedText)) {
        throw new SqlToolError(ERROR_CATEGORIES.UNSAFE_QUERY, 'Query contains a forbidden table or SQL operation.');
    }

    if (SUBQUERY_PATTERN.test(withoutQuotedText)) {
        throw new SqlToolError(ERROR_CATEGORIES.UNSAFE_QUERY, 'Subqueries are not allowed in DoseFinder SQL tool queries.');
    }

    if (FORBIDDEN_FUNCTION_PATTERN.test(withoutQuotedText) || /@@/.test(withoutQuotedText)) {
        throw new SqlToolError(ERROR_CATEGORIES.UNSAFE_QUERY, 'Query contains a forbidden SQL function or variable.');
    }

    const referencedTables = extractReferencedTables(withoutQuotedText);

    if (referencedTables.length === 0) {
        throw new SqlToolError(ERROR_CATEGORIES.SQL_SYNTAX_ERROR, 'Query must read from at least one allowed drug table.');
    }

    const disallowedTables = referencedTables.filter((tableName) => !ALLOWED_TABLES.has(tableName));
    if (disallowedTables.length > 0) {
        throw new SqlToolError(
            ERROR_CATEGORIES.INVALID_TABLE,
            `Query references disallowed table(s): ${uniqueValues(disallowedTables).join(', ')}.`,
            { tables: uniqueValues(disallowedTables) }
        );
    }

    if (queryReferencesVersionedData(referencedTables) && (
        AGGREGATE_FUNCTION_PATTERN.test(withoutQuotedText)
        || GROUPING_PATTERN.test(withoutQuotedText)
    )) {
        throw new SqlToolError(
            ERROR_CATEGORIES.UNSAFE_QUERY,
            'Aggregate and grouped queries over versioned drug data are not allowed because access flags must be enforced per drug row.'
        );
    }

    return {
        sql: trimmed,
        withoutQuotedText,
        referencedTables: uniqueValues(referencedTables),
        warnings: collectQualityWarnings(withoutQuotedText, referencedTables),
        hasDrugNameFilter: queryHasDrugNameFilter(withoutQuotedText),
    };
}

function applyLimit(sql, limit) {
    const safeLimit = normalizeLimit(limit);
    const limitAtEndPattern = /\blimit\s+(\d+)(?:\s*,\s*(\d+)|\s+offset\s+\d+)?\s*$/i;
    const match = sql.match(limitAtEndPattern);
    const requestedLimit = parsePositiveInteger(limit);

    if (!match) {
        return {
            sql: `${sql} LIMIT ${safeLimit}`,
            limit: safeLimit,
            requestedLimit,
            clamped: Boolean(requestedLimit && requestedLimit > safeLimit),
        };
    }

    const queryLimit = parsePositiveInteger(match[2] || match[1]) || safeLimit;
    const finalLimit = Math.min(queryLimit, safeLimit, MAX_LIMIT);

    return {
        sql: sql.replace(limitAtEndPattern, `LIMIT ${finalLimit}`),
        limit: finalLimit,
        requestedLimit: queryLimit,
        clamped: queryLimit > finalLimit || Boolean(requestedLimit && requestedLimit > safeLimit),
    };
}

function truncateValue(value) {
    if (typeof value !== 'string' || value.length <= MAX_CELL_LENGTH) return value;
    return `${value.slice(0, MAX_CELL_LENGTH)}...`;
}

function sanitizeRows(rows) {
    return rows.map((row) => Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, truncateValue(value)])
    ));
}

function mapDatabaseError(error) {
    const code = error?.code || '';
    const message = error?.sqlMessage || error?.message || 'The database could not run the SQL query.';

    if (['ER_BAD_FIELD_ERROR', 'ER_NON_UNIQ_ERROR'].includes(code)) {
        return new SqlToolError(ERROR_CATEGORIES.UNKNOWN_COLUMN, message);
    }

    if (code === 'ER_PARSE_ERROR') {
        return new SqlToolError(ERROR_CATEGORIES.SQL_SYNTAX_ERROR, message);
    }

    if (code === 'ER_NO_SUCH_TABLE') {
        return new SqlToolError(ERROR_CATEGORIES.INVALID_TABLE, message);
    }

    return new SqlToolError(ERROR_CATEGORIES.SQL_EXECUTION_ERROR, message);
}

function createRepairGuidance(category) {
    switch (category) {
        case ERROR_CATEGORIES.EMPTY_RESULT:
            return [
                'Broaden the drug-name search with LOWER(dm.generic_name) LIKE, LOWER(dm.brand_names) LIKE, and LOWER(dde.arabic_trade_name) LIKE when drug_dms_extensions is relevant.',
                'Keep drug_versions.is_current = 1 and COALESCE(drug_versions.is_deleted, 0) = 0, but remove overly strict price, route, form, or interaction filters if they may be excluding matches.',
                'If multiple possible records are found after broadening, summarize candidates and ask the user to clarify.',
            ];
        case ERROR_CATEGORIES.INVALID_TABLE:
            return [
                'Call getDrugSqlSchema and use only the allowlisted table names exactly as listed.',
                'Do not use schema-qualified table names or private user/auth/chat/saved/issue tables.',
            ];
        case ERROR_CATEGORIES.UNKNOWN_COLUMN:
            return [
                'Call getDrugSqlSchema and check the exact columns for each table.',
                'Join drug_versions dv to drug_master dm on version_id, filter dv.is_current = 1 and COALESCE(dv.is_deleted, 0) = 0, then join detail tables on version_id.',
                'Fully qualify duplicate column names and alias selected output columns.',
            ];
        case ERROR_CATEGORIES.SQL_SYNTAX_ERROR:
            return [
                'Write one MySQL-compatible SELECT statement with no semicolon, placeholders, comments, or multiple statements.',
                'Use literal LIKE filters for search terms and select only the answer columns needed.',
            ];
        case ERROR_CATEGORIES.UNSAFE_QUERY:
            return [
                'Use SELECT only over allowlisted drug knowledge tables.',
                'Do not use writes, UNION, comments, system functions, SQL variables, or private tables.',
            ];
        case ERROR_CATEGORIES.ACCESS_FILTER_REQUIRED:
            return [
                'Include drug_versions.drug_id AS drug_id in queries that read versioned drug data.',
                'Join through drug_versions when reading detail tables so DoseFinder access flags can be enforced.',
            ];
        default:
            return [
                'Repair the SQL using the schema guide, with one focused detail table when possible.',
                'Keep the query read-only and current-record focused.',
            ];
    }
}

function createErrorResult(error, warnings = [], profile = {}) {
    const category = error?.category || ERROR_CATEGORIES.SQL_EXECUTION_ERROR;
    const message = error?.message || 'The SQL tool could not run this query.';

    return {
        ok: false,
        error: {
            category,
            message,
        },
        warnings,
        repair_guidance: createRepairGuidance(category),
        query_profile: profile,
    };
}

function createLimitWarning(limitedQuery) {
    if (!limitedQuery.clamped) return null;
    return createWarning(
        WARNING_CATEGORIES.LIMIT_CLAMPED,
        `Requested row limit was clamped to ${limitedQuery.limit}.`,
        { max_limit: MAX_LIMIT }
    );
}

class DrugSqlToolService {
    static getSchema() {
        return {
            guide_version: '2026-05-09',
            purpose: 'DoseFinder read-only drug knowledge SQL guide for DoseGPT.',
            tables: DRUG_SCHEMA,
            canonical_join_path: [
                'Start from drug_versions dv for every current drug lookup.',
                'Join drug_master dm ON dm.version_id = dv.version_id for generic names, brand names, URLs, Rx status, and source metadata.',
                'Filter current records with dv.is_current = 1 and COALESCE(dv.is_deleted, 0) = 0 before answering user-facing questions.',
                'Join one focused detail table ON detail.version_id = dv.version_id for dosing, adverse effects, warnings, interactions, forms, routes, price, pregnancy, nutrition, suggested uses, FDA metadata, or classes.',
                'Use category tables only when the user asks about drug categories/subcategories; join drug_subcategory_listing.version_id to drug_versions.version_id.',
            ],
            common_identifiers: {
                public_drug_id: 'drug_versions.drug_id',
                version_join_key: 'version_id',
                detail_join_rule: 'drug_versions.version_id = detail_table.version_id',
                current_record_flag: 'drug_versions.is_current',
                not_deleted_flag: 'drug_versions.is_deleted',
                display_name_fields: ['drug_master.generic_name', 'drug_master.brand_names', 'drug_dms_extensions.arabic_trade_name'],
            },
            current_record_rule: [
                'Use drug_versions.is_current = 1 and COALESCE(drug_versions.is_deleted, 0) = 0 by default for all user-facing answers.',
                'Only omit the current filter if the user explicitly asks for historical versions; do not include deleted rows unless the user is explicitly asking about deletion metadata.',
                'When reading versioned drug data, include drug_versions.drug_id AS drug_id in the SELECT list so access flags can be enforced before rows are returned.',
            ],
            search_rules: {
                brand_or_generic_name: 'Search LOWER(drug_master.generic_name) and LOWER(drug_master.brand_names) with LIKE. Brand names may contain multiple values in one field.',
                arabic_trade_name: 'Join drug_dms_extensions and search LOWER(drug_dms_extensions.arabic_trade_name) with LIKE when Arabic or trade-name matching may be needed.',
                dosage_forms: 'Use drug_dosage_forms.form_name, drug_dosage_forms.strength_text, and drug_dosage_forms.population for available form/strength questions.',
                prices: 'Use drug_dms_extensions.price, route, arabic_route, ham, and notes for price and local extension questions. Include the matched drug name fields with price results.',
                warnings_and_contraindications: 'Use drug_warnings.warning_type, sub_warning_type, list_header, and text. Search text fields for contraindication-related wording when needed.',
                interactions: 'Use drug_interactions.interacting_drug, severity_level, and description. Search both the base drug name and the interacting drug name.',
                dosing: 'Use drug_dosing for approved dosing details. Use drug_suggested_dosing only when the user asks about suggested dosing data.',
                adverse_effects: 'Use drug_adverse_effects.severity_band, body_system, list_header, and effect_text.',
                fda_metadata: 'Use drug_fda_products, drug_fda_submissions, and drug_fda_extensions for user-visible FDA product, application, manufacturer, ingredient, and marketing status data. Internal FDA identifier and source payload hash tables are not user-facing.',
                comparisons: 'Query candidate rows first, then compare only columns present in returned rows. Ask for clarification if many candidates match.',
            },
            query_quality_rules: [
                'Avoid SELECT *; select and alias only the columns needed for the answer.',
                'Use LOWER(column) LIKE LOWER(\'%term%\') for name/text matching.',
                'For a drug-specific answer, include a drug-name or public drug ID filter unless the user explicitly asks for browsing many records.',
                'Avoid joining many detail tables in one query; run a focused follow-up query when another topic is needed.',
                'Summarize only returned rows. Do not infer medical facts from drug names alone.',
            ],
            example_queries: [
                {
                    intent: 'Find a current drug by generic, brand, or Arabic trade name',
                    sql: "SELECT dv.drug_id, dm.generic_name, dm.brand_names, dde.arabic_trade_name FROM drug_versions dv JOIN drug_master dm ON dm.version_id = dv.version_id LEFT JOIN drug_dms_extensions dde ON dde.version_id = dv.version_id WHERE dv.is_current = 1 AND COALESCE(dv.is_deleted, 0) = 0 AND (LOWER(dm.generic_name) LIKE LOWER('%lisinopril%') OR LOWER(dm.brand_names) LIKE LOWER('%lisinopril%') OR LOWER(dde.arabic_trade_name) LIKE LOWER('%lisinopril%')) LIMIT 10",
                },
                {
                    intent: 'Price lookup for a matching drug',
                    sql: "SELECT dv.drug_id, dm.generic_name, dm.brand_names, dde.arabic_trade_name, dde.price, dde.route, dde.notes FROM drug_versions dv JOIN drug_master dm ON dm.version_id = dv.version_id JOIN drug_dms_extensions dde ON dde.version_id = dv.version_id WHERE dv.is_current = 1 AND COALESCE(dv.is_deleted, 0) = 0 AND (LOWER(dm.generic_name) LIKE LOWER('%lisinopril%') OR LOWER(dm.brand_names) LIKE LOWER('%lisinopril%') OR LOWER(dde.arabic_trade_name) LIKE LOWER('%lisinopril%')) ORDER BY dde.price IS NULL, dde.price LIMIT 10",
                },
                {
                    intent: 'Dosing details for a drug and indication',
                    sql: "SELECT dv.drug_id, dm.generic_name, dd.population, dd.indication, dd.sub_indication, dd.list_header, dd.notes_text FROM drug_versions dv JOIN drug_master dm ON dm.version_id = dv.version_id JOIN drug_dosing dd ON dd.version_id = dv.version_id WHERE dv.is_current = 1 AND COALESCE(dv.is_deleted, 0) = 0 AND LOWER(dm.generic_name) LIKE LOWER('%ibuprofen%') AND (LOWER(dd.indication) LIKE LOWER('%pain%') OR LOWER(dd.notes_text) LIKE LOWER('%pain%')) LIMIT 10",
                },
                {
                    intent: 'Adverse effects or side effects',
                    sql: "SELECT dv.drug_id, dm.generic_name, dae.severity_band, dae.body_system, dae.list_header, dae.effect_text FROM drug_versions dv JOIN drug_master dm ON dm.version_id = dv.version_id JOIN drug_adverse_effects dae ON dae.version_id = dv.version_id WHERE dv.is_current = 1 AND COALESCE(dv.is_deleted, 0) = 0 AND (LOWER(dm.generic_name) LIKE LOWER('%ibuprofen%') OR LOWER(dm.brand_names) LIKE LOWER('%ibuprofen%')) LIMIT 15",
                },
                {
                    intent: 'Interaction between two drugs',
                    sql: "SELECT dv.drug_id, dm.generic_name, di.interacting_drug, di.severity_level, di.description FROM drug_versions dv JOIN drug_master dm ON dm.version_id = dv.version_id JOIN drug_interactions di ON di.version_id = dv.version_id WHERE dv.is_current = 1 AND COALESCE(dv.is_deleted, 0) = 0 AND (LOWER(dm.generic_name) LIKE LOWER('%aspirin%') OR LOWER(dm.brand_names) LIKE LOWER('%aspirin%')) AND LOWER(di.interacting_drug) LIKE LOWER('%warfarin%') LIMIT 10",
                },
                {
                    intent: 'Contraindications or warnings',
                    sql: "SELECT dv.drug_id, dm.generic_name, dw.warning_type, dw.sub_warning_type, dw.list_header, dw.text FROM drug_versions dv JOIN drug_master dm ON dm.version_id = dv.version_id JOIN drug_warnings dw ON dw.version_id = dv.version_id WHERE dv.is_current = 1 AND COALESCE(dv.is_deleted, 0) = 0 AND (LOWER(dm.generic_name) LIKE LOWER('%metformin%') OR LOWER(dm.brand_names) LIKE LOWER('%metformin%')) AND (LOWER(dw.warning_type) LIKE LOWER('%contra%') OR LOWER(dw.text) LIKE LOWER('%contra%')) LIMIT 10",
                },
                {
                    intent: 'Available routes and dosage forms',
                    sql: "SELECT dv.drug_id, dm.generic_name, dde.route, dde.arabic_route, ddf.population, ddf.form_name, ddf.strength_text FROM drug_versions dv JOIN drug_master dm ON dm.version_id = dv.version_id LEFT JOIN drug_dms_extensions dde ON dde.version_id = dv.version_id LEFT JOIN drug_dosage_forms ddf ON ddf.version_id = dv.version_id WHERE dv.is_current = 1 AND COALESCE(dv.is_deleted, 0) = 0 AND (LOWER(dm.generic_name) LIKE LOWER('%acyclovir%') OR LOWER(dm.brand_names) LIKE LOWER('%acyclovir%')) LIMIT 20",
                },
                {
                    intent: 'Compare prices across matching records',
                    sql: "SELECT dv.drug_id, dm.generic_name, dm.brand_names, dde.arabic_trade_name, dde.price, dde.route FROM drug_versions dv JOIN drug_master dm ON dm.version_id = dv.version_id JOIN drug_dms_extensions dde ON dde.version_id = dv.version_id WHERE dv.is_current = 1 AND COALESCE(dv.is_deleted, 0) = 0 AND (LOWER(dm.generic_name) LIKE LOWER('%metformin%') OR LOWER(dm.brand_names) LIKE LOWER('%metformin%') OR LOWER(dde.arabic_trade_name) LIKE LOWER('%metformin%')) ORDER BY dde.price IS NULL, dde.price LIMIT 20",
                },
                {
                    intent: 'Drug class lookup',
                    sql: "SELECT dv.drug_id, dm.generic_name, dc.class_name FROM drug_versions dv JOIN drug_master dm ON dm.version_id = dv.version_id JOIN drug_classes dc ON dc.version_id = dv.version_id WHERE dv.is_current = 1 AND COALESCE(dv.is_deleted, 0) = 0 AND (LOWER(dm.generic_name) LIKE LOWER('%atorvastatin%') OR LOWER(dm.brand_names) LIKE LOWER('%atorvastatin%')) LIMIT 10",
                },
                {
                    intent: 'FDA manufacturer and marketing status lookup',
                    sql: "SELECT dv.drug_id, dm.generic_name, dfe.manufacturer_name, dfe.marketing_category, dfe.marketing_status, dfe.active_ingredient FROM drug_versions dv JOIN drug_master dm ON dm.version_id = dv.version_id JOIN drug_fda_extensions dfe ON dfe.version_id = dv.version_id WHERE dv.is_current = 1 AND COALESCE(dv.is_deleted, 0) = 0 AND (LOWER(dm.generic_name) LIKE LOWER('%acetaminophen%') OR LOWER(dm.brand_names) LIKE LOWER('%acetaminophen%')) LIMIT 10",
                },
            ],
            safety: {
                allowed_operations: ['SELECT'],
                default_rows_returned: DEFAULT_LIMIT,
                max_rows_returned: MAX_LIMIT,
                private_tables_hidden: true,
                sql_visible_to_users: false,
            },
        };
    }

    static async filterRowsForUser(rows, validation, user) {
        if (!queryReferencesVersionedData(validation.referencedTables) || rows.length === 0) {
            return { rows };
        }

        const rowsWithDrugIds = rows.map((row) => ({
            row,
            drugId: getRowDrugId(row),
        }));

        if (rowsWithDrugIds.some((entry) => !entry.drugId)) {
            return {
                error: new SqlToolError(
                    ERROR_CATEGORIES.ACCESS_FILTER_REQUIRED,
                    'Queries that read versioned drug data must select drug_versions.drug_id AS drug_id so access flags can be enforced.'
                ),
            };
        }

        const rowDrugIds = rowsWithDrugIds.map((entry) => entry.drugId);
        const [flagsByDrugId, activeDrugIds] = await Promise.all([
            AdminModel.getDrugFlagsMap(rowDrugIds),
            getActiveDrugIdSet(rowDrugIds),
        ]);
        return {
            rows: rowsWithDrugIds
                .filter(({ drugId }) => activeDrugIds.has(Number(drugId)) && isDrugAccessibleForUser(flagsByDrugId.get(Number(drugId)), user))
                .map(({ row }) => row),
        };
    }

    static async query(sql, limit = DEFAULT_LIMIT, user = null) {
        let validation;

        try {
            validation = normalizeSql(sql);
        } catch (error) {
            return createErrorResult(error);
        }

        const limitedQuery = applyLimit(validation.sql, limit);
        const limitWarning = createLimitWarning(limitedQuery);
        const warnings = limitWarning
            ? [...validation.warnings, limitWarning]
            : validation.warnings;
        const profile = {
            referenced_tables: validation.referencedTables,
            has_drug_name_filter: validation.hasDrugNameFilter,
            current_filter_present: CURRENT_FILTER_PATTERN.test(validation.withoutQuotedText),
            not_deleted_filter_present: NOT_DELETED_FILTER_PATTERN.test(validation.withoutQuotedText),
        };

        try {
            const pool = getPool();
            const [rows, fields] = await pool.query(limitedQuery.sql);
            const columns = fields.map((field) => field.name);
            const accessResult = await this.filterRowsForUser(rows, validation, user);

            if (accessResult.error) {
                return {
                    ...createErrorResult(accessResult.error, warnings, profile),
                    rows: [],
                    row_count: 0,
                    columns,
                    limit: limitedQuery.limit,
                    limited: false,
                };
            }

            if (accessResult.rows.length === 0) {
                return {
                    ...createErrorResult(
                        new SqlToolError(
                            ERROR_CATEGORIES.EMPTY_RESULT,
                            'The query ran safely but returned no rows.'
                        ),
                        warnings,
                        profile
                    ),
                    rows: [],
                    row_count: 0,
                    columns,
                    limit: limitedQuery.limit,
                    limited: false,
                };
            }

            return {
                ok: true,
                rows: sanitizeRows(accessResult.rows),
                row_count: accessResult.rows.length,
                columns,
                limit: limitedQuery.limit,
                limited: accessResult.rows.length === limitedQuery.limit,
                warnings,
                query_profile: profile,
            };
        } catch (error) {
            return createErrorResult(mapDatabaseError(error), warnings, profile);
        }
    }
}

module.exports = DrugSqlToolService;
