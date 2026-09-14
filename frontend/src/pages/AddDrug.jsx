import '../styles/add-drug.css';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import SearchHeader from '../components/SearchHeader';
import Footer from '../components/Footer';
import { useToast } from '../components/Toast';
import { drugsApi, issuesApi } from '../services/api';

import HierarchyEditor from '../components/drug-editor/HierarchyEditor';
import DosingEditor from '../components/drug-editor/DosingEditor';
import WarningsEditor from '../components/drug-editor/WarningsEditor';
import AdverseEffectsEditor from '../components/drug-editor/AdverseEffectsEditor';
import InteractionsEditor from '../components/drug-editor/InteractionsEditor';
import DosageFormsEditor from '../components/drug-editor/DosageFormsEditor';
import TableRowsEditor from '../components/drug-editor/TableRowsEditor';
import { AutoSizeInput, AutoSizeTextarea } from '../components/drug-editor/AutoSizeField';

/* ────────────────────── helpers ────────────────────── */

const asArray = (value) => (Array.isArray(value) ? value : []);
const uid = (() => { let c = 0; return () => `u_${++c}_${Date.now()}`; })();

const normalizeArrayString = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '[]';
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return JSON.stringify(parsed.map((i) => String(i ?? '').trim()).filter(Boolean));
    } catch { /* fall through */ }
    return JSON.stringify(raw.split(/[\n,]+/).map((i) => i.trim()).filter(Boolean));
};

const parseNumberOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

const cleanText = (value) => String(value ?? '').trim();
const hasText = (value) => cleanText(value).length > 0;
const cloneValue = (value) => JSON.parse(JSON.stringify(value));

/* ────────────────────── section definitions ────────────────────── */

const TABLE_COLUMNS = {
    classes: [{ key: 'class_name', label: 'Class Name' }],
    subcategory_listing: [{ key: 'subcategory_id', label: 'Subcategory ID', type: 'number' }],
    fda_products: [
        { key: 'product_ndc', label: 'Product NDC' },
        { key: 'application_number', label: 'Application Number' },
    ],
    fda_submissions: [
        { key: 'application_number', label: 'Application Number' },
        { key: 'submission_type', label: 'Type' },
        { key: 'submission_number', label: 'Number' },
        { key: 'submission_status', label: 'Status' },
        { key: 'submission_status_date', label: 'Status Date' },
        { key: 'application_docs_json', label: 'Application Docs JSON', multiline: true },
    ],
    fda_extensions: [
        { key: 'marketing_category', label: 'Marketing Category' },
        { key: 'marketing_status', label: 'Marketing Status' },
        { key: 'manufacturer_name', label: 'Manufacturer' },
        { key: 'review_priority', label: 'Review Priority' },
        { key: 'active_ingredient', label: 'Active Ingredient', multiline: true },
        { key: 'inactive_ingredient', label: 'Inactive Ingredient', multiline: true },
    ],
};

const SECTION_DEFS = [
    { key: 'classes', title: 'Classes', icon: '🏷️', editor: 'table_rows', columns: TABLE_COLUMNS.classes },
    { key: 'dosage_forms', title: 'Dosage Forms', icon: '💊', editor: 'dosage_forms' },
    { key: 'dosing', title: 'Dosing', icon: '📋', editor: 'dosing' },
    { key: 'warnings', title: 'Warnings', icon: '⚠️', editor: 'warnings' },
    { key: 'adverse_effects', title: 'Adverse Effects', icon: '🔬', editor: 'adverse_effects' },
    { key: 'interactions', title: 'Drug Interactions', icon: '⚡', editor: 'interactions' },
    { key: 'pregnancy', title: 'Pregnancy & Lactation', icon: '🤰', editor: 'hierarchy', levels: [{ key: 'topic', label: 'Topic', placeholder: 'e.g. Pregnancy, Lactation' }, { key: 'sub_topic', label: 'Sub-Topic', placeholder: 'e.g. Animal studies' }, { key: 'list_header', label: 'List Header', placeholder: '' }] },
    { key: 'pharmacology', title: 'Pharmacology', icon: '🧪', editor: 'hierarchy', levels: [{ key: 'topic', label: 'Topic', placeholder: 'e.g. mechanism_of_action' }, { key: 'sub_topic', label: 'Sub-Topic', placeholder: '' }, { key: 'list_header', label: 'List Header', placeholder: '' }] },
    { key: 'administration', title: 'Administration', icon: '📝', editor: 'hierarchy', levels: [{ key: 'topic', label: 'Topic', placeholder: 'e.g. sl_administration, storage' }, { key: 'sub_topic', label: 'Sub-Topic', placeholder: '' }, { key: 'list_header', label: 'List Header', placeholder: '' }] },
    { key: 'suggested_dosing', title: 'Suggested Dosing', icon: '💉', editor: 'dosing' },
    { key: 'suggested_uses', title: 'Suggested Uses', icon: '✅', editor: 'hierarchy_simple', levels: [{ key: 'topic', label: 'Topic', placeholder: 'e.g. general' }] },
    { key: 'nutrition', title: 'Nutrition', icon: '🥗', editor: 'hierarchy_simple', levels: [{ key: 'topic', label: 'Topic', placeholder: 'e.g. general' }] },
    { key: 'subcategory_listing', title: 'Subcategory Listing', icon: '🗂️', editor: 'table_rows', columns: TABLE_COLUMNS.subcategory_listing },
    { key: 'fda_products', title: 'FDA Products', icon: '🧾', editor: 'table_rows', columns: TABLE_COLUMNS.fda_products },
    { key: 'fda_submissions', title: 'FDA Submissions', icon: '📨', editor: 'table_rows', columns: TABLE_COLUMNS.fda_submissions },
    { key: 'fda_extensions', title: 'FDA Marketing', icon: '🏭', editor: 'table_rows', columns: TABLE_COLUMNS.fda_extensions },
];

const EDITABLE_MAIN_FIELDS = ['generic_name', 'url', 'rx_status', 'brand_names', 'source', 'doctor_id'];
const EDITABLE_SECTION_FIELDS = [...SECTION_DEFS.map((section) => section.key), 'drug_dms_extensions'];

const stripEditorRuntime = (value) => {
    if (Array.isArray(value)) return value.map(stripEditorRuntime);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => key !== '_id')
                .map(([key, entryValue]) => [key, stripEditorRuntime(entryValue)]),
        );
    }
    return value;
};

const isEditorValueEqual = (left, right) => JSON.stringify(stripEditorRuntime(left)) === JSON.stringify(stripEditorRuntime(right));

const serializeEditMainField = (field, record) => {
    switch (field) {
        case 'generic_name':
        case 'brand_names':
            return cleanText(record[field]);
        case 'url':
        case 'rx_status':
            return hasText(record[field]) ? cleanText(record[field]) : null;
        case 'source':
            return cleanText(record.source) || 'DMS';
        case 'doctor_id':
            return parseNumberOrNull(record.doctor_id) ?? 0;
        default:
            return record[field];
    }
};

const buildEditPayload = (record, loadedRecord) => {
    if (!loadedRecord) return toPayload(record);

    const next = {};
    const serialized = toPayload(record);

    EDITABLE_MAIN_FIELDS.forEach((field) => {
        if (!isEditorValueEqual(record[field], loadedRecord[field])) {
            next[field] = serializeEditMainField(field, record);
        }
    });

    // The API already preserves untouched sub-tables by copying the current version,
    // so edit mode only needs to send sections the doctor actually changed.
    EDITABLE_SECTION_FIELDS.forEach((field) => {
        if (!isEditorValueEqual(record[field], loadedRecord[field])) {
            next[field] = serialized[field];
        }
    });

    return next;
};

const recordHasUserData = (record) => {
    const extension = asArray(record?.drug_dms_extensions)[0] ?? {};

    return (
        hasText(record?.generic_name) ||
        hasText(record?.brand_names) ||
        hasText(record?.url) ||
        hasText(record?.rx_status) ||
        cleanText(record?.source || 'DMS') !== 'DMS' ||
        (parseNumberOrNull(record?.doctor_id) ?? 0) !== 0 ||
        (parseNumberOrNull(extension.ham) ?? 0) !== 0 ||
        parseNumberOrNull(extension.price) !== null ||
        hasText(extension.notes) ||
        hasText(extension.arabic_trade_name) ||
        normalizeArrayString(extension.route ?? '[]') !== '[]' ||
        normalizeArrayString(extension.arabic_route ?? '[]') !== '[]' ||
        SECTION_DEFS.some((section) => asArray(record?.[section.key]).length > 0)
    );
};

/* ────────────────────── state builders ────────────────────── */

/** Build empty hierarchical state for a section key */
const makeEmptySection = (key) => {
    switch (key) {
        case 'dosage_forms': return [];
        case 'dosing': return [];
        case 'warnings': return [];
        case 'adverse_effects': return [];
        case 'interactions': return [];
        // hierarchy sections (3-level)
        case 'pregnancy':
        case 'pharmacology':
        case 'administration':
            return [];
        // hierarchy_simple (1-level: topic + items)
        case 'suggested_dosing':
        case 'suggested_uses':
        case 'nutrition':
            return [];
        default:
            return [];
    }
};

const emptyRecord = () => ({
    version_id: null,
    generic_name: '',
    url: '',
    rx_status: '',
    brand_names: '',
    source: 'DMS',
    doctor_id: 0,
    drug_id: null,
    version_number: 1,
    updated_at: '',
    is_current: 1,
    ...Object.fromEntries(SECTION_DEFS.map((s) => [s.key, makeEmptySection(s.key)])),
    drug_dms_extensions: [{
        ham: 0, price: null, notes: '', route: '[]', arabic_route: '[]', arabic_trade_name: '',
    }],
});

/* ──── Convert flat DB rows → hierarchical editor state ──── */

const groupByField = (rows, fieldKey) => {
    const map = new Map();
    rows.forEach((row) => {
        const key = String(row[fieldKey] ?? '').trim() || '';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(row);
    });
    return map;
};

/** Convert flat dosage_forms rows → population → forms → strengths tree */
const flatToDosForms = (rows) => {
    const popMap = groupByField(rows, 'population');
    return Array.from(popMap.entries()).map(([pop, formRows]) => {
        const formMap = groupByField(formRows, 'form_name');
        return {
            population: pop || 'default', _id: uid(),
            forms: Array.from(formMap.entries()).map(([formName, strengthRows]) => ({
                form_name: formName, _id: uid(),
                strengths: strengthRows.map((r) => r.strength_text || '').filter(Boolean),
            })),
        };
    });
};

/** Convert flat dosing rows → population → indication → sub_indication → entries tree */
const flatToDosing = (rows) => {
    const popMap = groupByField(rows, 'population');
    return Array.from(popMap.entries()).map(([pop, popRows]) => {
        const indMap = groupByField(popRows, 'indication');
        return {
            population: pop || 'default', _id: uid(),
            indications: Array.from(indMap.entries()).map(([ind, indRows]) => {
                const subMap = groupByField(indRows, 'sub_indication');
                return {
                    indication: ind, _id: uid(),
                    sub_indications: Array.from(subMap.entries()).map(([sub, subRows]) => ({
                        sub_indication: sub || null, _id: uid(),
                        entries: subRows.map((r) => ({
                            list_header: r.list_header ?? null,
                            notes_text: r.notes_text ?? '',
                            _id: uid(),
                            _keep_empty: !hasText(r.notes_text),
                        })),
                    })),
                };
            }),
        };
    });
};

/** Convert flat warnings rows → warning_type → sub_warning_type → entries tree */
const flatToWarnings = (rows) => {
    const typeMap = groupByField(rows, 'warning_type');
    return Array.from(typeMap.entries()).map(([wt, wtRows]) => {
        const subMap = groupByField(wtRows, 'sub_warning_type');
        return {
            warning_type: wt, _id: uid(),
            sub_types: Array.from(subMap.entries()).map(([st, stRows]) => ({
                sub_warning_type: st || null, _id: uid(),
                entries: stRows.map((r) => ({ list_header: r.list_header || null, text: r.text || '', _id: uid() })),
            })),
        };
    });
};

/** Convert flat adverse_effects rows → severity_band → body_system → entries tree */
const flatToAdverse = (rows) => {
    const bandMap = groupByField(rows, 'severity_band');
    return Array.from(bandMap.entries()).map(([band, bandRows]) => {
        const bsMap = groupByField(bandRows, 'body_system');
        return {
            severity_band: band || 'Frequency Not Defined', _id: uid(),
            body_systems: Array.from(bsMap.entries()).map(([bs, bsRows]) => ({
                body_system: bs || 'general', _id: uid(),
                entries: bsRows.map((r) => ({ list_header: r.list_header || null, effect_text: r.effect_text || '', _id: uid() })),
            })),
        };
    });
};

/** Convert flat interactions rows → severity_level groups */
const flatToInteractions = (rows) => {
    const slMap = groupByField(rows, 'severity_level');
    return Array.from(slMap.entries()).map(([sl, slRows]) => ({
        severity_level: sl || '',
        _severity_level_was_null: slRows.every((r) => r?.severity_level == null),
        _id: uid(),
        interactions: slRows.map((r) => ({
            interacting_drug: r.interacting_drug ?? '',
            description: r.description ?? '',
            _description_was_null: r?.description == null,
            _id: uid(),
        })),
    }));
};

/** Convert flat topic/sub_topic/list_header/text rows → hierarchy tree (3-level) */
const flatToHierarchy3 = (rows, textField = 'text') => {
    const topicMap = groupByField(rows, 'topic');
    return Array.from(topicMap.entries()).map(([topic, topicRows]) => {
        const subMap = groupByField(topicRows, 'sub_topic');
        return {
            topic: topic || 'general', _id: uid(),
            children: Array.from(subMap.entries()).map(([sub, subRows]) => {
                const headerMap = groupByField(subRows, 'list_header');
                return {
                    sub_topic: sub || '', _id: uid(),
                    children: Array.from(headerMap.entries()).map(([header, hRows]) => ({
                        list_header: header || '', _id: uid(),
                        items: hRows.map((r) => r[textField] || '').filter(Boolean),
                    })),
                };
            }),
        };
    });
};

/** Convert flat topic/text rows → hierarchy tree (1-level: topic + items) */
const flatToHierarchy1 = (rows, textField = 'text') => {
    const topicMap = groupByField(rows, 'topic');
    return Array.from(topicMap.entries()).map(([topic, topicRows]) => ({
        topic: topic || 'general', _id: uid(),
        items: topicRows.map((r) => r[textField] || '').filter(Boolean),
    }));
};

const tableRowsToEditor = (key, rows) => {
    const columns = TABLE_COLUMNS[key] || [];
    return asArray(rows).map((row) => ({
        ...Object.fromEntries(columns.map((column) => [column.key, row?.[column.key] ?? column.defaultValue ?? ''])),
        _id: uid(),
    }));
};

const editorTableRowsToPayload = (key, rows) => {
    const columns = TABLE_COLUMNS[key] || [];
    return asArray(rows)
        .map((row) => Object.fromEntries(columns.map((column) => {
            const raw = row?.[column.key];
            const value = column.type === 'number' ? parseNumberOrNull(raw) : (typeof raw === 'string' ? cleanText(raw) : raw);
            return [column.key, value === '' ? null : value];
        })))
        .filter((row) => Object.values(row).some((value) => value !== null && value !== undefined && value !== ''));
};

/** Master conversion: flat record → hierarchical editor state */
const toEditorRecord = (data) => {
    const base = emptyRecord();
    const ext = asArray(data?.drug_dms_extensions)[0] ?? {};
    const extensionNotes = ext?.notes ?? data?.note_raw;

    return {
        ...base,
        version_id: data?.version_id ?? data?.drug_id ?? data?.id ?? null,
        generic_name: data?.generic_name ?? '',
        url: data?.url ?? '',
        rx_status: data?.rx_status ?? data?.rx ?? '',
        brand_names: data?.brand_names ?? '',
        source: data?.source ?? 'DMS',
        doctor_id: data?.doctor_id ?? 0,
        drug_id: data?.drug_id ?? data?.id ?? null,
        version_number: data?.version_number ?? 1,
        updated_at: data?.updated_at ?? '',
        is_current: data?.is_current ?? 1,
        classes: tableRowsToEditor('classes', data?.classes),
        dosage_forms: flatToDosForms(asArray(data?.dosage_forms)),
        dosing: flatToDosing(asArray(data?.dosing)),
        warnings: flatToWarnings(asArray(data?.warnings)),
        adverse_effects: flatToAdverse(asArray(data?.adverse_effects)),
        interactions: flatToInteractions(asArray(data?.interactions)),
        pregnancy: flatToHierarchy3(asArray(data?.pregnancy)),
        pharmacology: flatToHierarchy3(asArray(data?.pharmacology)),
        administration: flatToHierarchy3(asArray(data?.administration)),
        suggested_dosing: flatToDosing(asArray(data?.suggested_dosing)),
        suggested_uses: flatToHierarchy1(asArray(data?.suggested_uses)),
        nutrition: flatToHierarchy1(asArray(data?.nutrition)),
        subcategory_listing: tableRowsToEditor('subcategory_listing', data?.subcategory_listing),
        fda_products: tableRowsToEditor('fda_products', data?.fda_products),
        fda_submissions: tableRowsToEditor('fda_submissions', data?.fda_submissions),
        fda_extensions: tableRowsToEditor('fda_extensions', data?.fda_extensions),
        drug_dms_extensions: [{
            ham: ext?.ham ?? (data?.ham === 'YES' ? 1 : 0),
            price: ext?.price ?? data?.price ?? null,
            notes: extensionNotes ?? '',
            _notes_was_null: extensionNotes == null,
            route: ext?.route ?? data?.route ?? '[]',
            arabic_route: ext?.arabic_route ?? data?.arabic_route ?? '[]',
            arabic_trade_name: ext?.arabic_trade_name ?? data?.arabic_trade_name ?? '',
        }],
    };
};

/* ──── Flatten hierarchical state → flat DB rows ──── */

/** Flatten dosage_forms tree → flat rows */
const flattenDosForms = (tree) => {
    const rows = [];
    asArray(tree).forEach((pop) => {
        asArray(pop.forms).forEach((form) => {
            const strengths = asArray(form.strengths).filter((s) => s.trim());
            if (strengths.length === 0) {
                if (form.form_name?.trim()) rows.push({ population: pop.population || 'default', form_name: form.form_name, strength_text: '' });
            } else {
                strengths.forEach((s) => rows.push({ population: pop.population || 'default', form_name: form.form_name, strength_text: s }));
            }
        });
    });
    return rows;
};

/** Flatten dosing tree → flat rows */
const flattenDosing = (tree) => {
    const rows = [];
    asArray(tree).forEach((pop) => {
        asArray(pop.indications).forEach((ind) => {
            asArray(ind.sub_indications).forEach((sub) => {
                asArray(sub.entries).forEach((e) => {
                    const notesText = typeof e?.notes_text === 'string' ? e.notes_text : '';
                    if (notesText.trim() || e?._keep_empty) {
                        rows.push({
                            population: pop.population || 'default',
                            indication: ind.indication || '',
                            sub_indication: sub.sub_indication || null,
                            list_header: e.list_header || null,
                            notes_text: notesText.trim() ? notesText : '',
                        });
                    }
                });
            });
        });
    });
    return rows;
};

/** Flatten warnings tree → flat rows */
const flattenWarnings = (tree) => {
    const rows = [];
    asArray(tree).forEach((wt) => {
        asArray(wt.sub_types).forEach((st) => {
            asArray(st.entries).forEach((e) => {
                if (e.text?.trim()) {
                    rows.push({
                        warning_type: wt.warning_type || '',
                        sub_warning_type: st.sub_warning_type || null,
                        list_header: e.list_header || null,
                        text: e.text,
                    });
                }
            });
        });
    });
    return rows;
};

/** Flatten adverse_effects tree → flat rows */
const flattenAdverse = (tree) => {
    const rows = [];
    asArray(tree).forEach((band) => {
        asArray(band.body_systems).forEach((bs) => {
            asArray(bs.entries).forEach((e) => {
                if (e.effect_text?.trim()) {
                    rows.push({
                        severity_band: band.severity_band || 'Frequency Not Defined',
                        body_system: bs.body_system || 'general',
                        list_header: e.list_header || null,
                        effect_text: e.effect_text,
                    });
                }
            });
        });
    });
    return rows;
};

/** Flatten interactions tree → flat rows */
const flattenInteractions = (tree) => {
    const rows = [];
    asArray(tree).forEach((group) => {
        asArray(group.interactions).forEach((i) => {
            const interactingDrug = typeof i?.interacting_drug === 'string' ? i.interacting_drug : '';
            const severityLevel = cleanText(group?.severity_level);
            const description = typeof i?.description === 'string' ? i.description : '';
            if (interactingDrug.trim()) {
                rows.push({
                    severity_level: severityLevel || (group?._severity_level_was_null ? null : ''),
                    interacting_drug: interactingDrug,
                    description: description.trim() ? description : (i?._description_was_null ? null : ''),
                });
            }
        });
    });
    return rows;
};

/** Flatten 3-level hierarchy tree → flat rows */
const flattenHierarchy3 = (tree, textField = 'text') => {
    const rows = [];
    asArray(tree).forEach((topicNode) => {
        asArray(topicNode.children).forEach((subNode) => {
            asArray(subNode.children).forEach((headerNode) => {
                asArray(headerNode.items).forEach((text) => {
                    if (text?.trim()) {
                        rows.push({
                            topic: topicNode.topic || 'general',
                            sub_topic: subNode.sub_topic || null,
                            list_header: headerNode.list_header || null,
                            [textField]: text,
                        });
                    }
                });
            });
        });
    });
    return rows;
};

/** Flatten 1-level hierarchy tree → flat rows */
const flattenHierarchy1 = (tree, textField = 'text') => {
    const rows = [];
    asArray(tree).forEach((topicNode) => {
        asArray(topicNode.items).forEach((text) => {
            if (text?.trim()) {
                rows.push({ topic: topicNode.topic || 'general', [textField]: text });
            }
        });
    });
    return rows;
};

/** Master flatten: editor state → flat payload for API */
const toPayload = (record) => {
    const ext = { ...(asArray(record.drug_dms_extensions)[0] ?? {}) };
    const extensionNotes = cleanText(ext.notes);
    return {
        generic_name: cleanText(record.generic_name),
        ...(cleanText(record.url) ? { url: cleanText(record.url) } : {}),
        ...(cleanText(record.rx_status) ? { rx_status: cleanText(record.rx_status) } : {}),
        brand_names: cleanText(record.brand_names),
        source: cleanText(record.source) || 'DMS',
        doctor_id: parseNumberOrNull(record.doctor_id) ?? 0,
        classes: editorTableRowsToPayload('classes', record.classes),
        dosage_forms: flattenDosForms(record.dosage_forms),
        dosing: flattenDosing(record.dosing),
        warnings: flattenWarnings(record.warnings),
        adverse_effects: flattenAdverse(record.adverse_effects),
        interactions: flattenInteractions(record.interactions),
        pregnancy: flattenHierarchy3(record.pregnancy),
        pharmacology: flattenHierarchy3(record.pharmacology),
        administration: flattenHierarchy3(record.administration),
        suggested_dosing: flattenDosing(record.suggested_dosing),
        suggested_uses: flattenHierarchy1(record.suggested_uses),
        nutrition: flattenHierarchy1(record.nutrition),
        subcategory_listing: editorTableRowsToPayload('subcategory_listing', record.subcategory_listing),
        fda_products: editorTableRowsToPayload('fda_products', record.fda_products),
        fda_submissions: editorTableRowsToPayload('fda_submissions', record.fda_submissions),
        fda_extensions: editorTableRowsToPayload('fda_extensions', record.fda_extensions),
        drug_dms_extensions: [{
            ham: parseNumberOrNull(ext.ham) ? 1 : 0,
            price: parseNumberOrNull(ext.price),
            notes: extensionNotes || !ext._notes_was_null ? extensionNotes : null,
            route: normalizeArrayString(ext.route ?? ''),
            arabic_route: normalizeArrayString(ext.arabic_route ?? ''),
            arabic_trade_name: cleanText(ext.arabic_trade_name),
        }],
    };
};

/* ──── AI extraction mapping ──── */
const mapExtractedToSchema = (extracted) => {
    const payload = extracted ?? {};
    return toEditorRecord({
        source: 'DMS',
        ...payload,
        drug_dms_extensions: asArray(payload.drug_dms_extensions).length > 0
            ? payload.drug_dms_extensions
            : [{ ham: 0, price: null, notes: null, route: '[]', arabic_route: '[]', arabic_trade_name: null }],
    });
};

/* ────────────────────── UI helpers ────────────────────── */

function Field({ label, value, onChange, type = 'text', textarea = false, placeholder = '' }) {
    return (
        <div className="adf-field">
            <label className="adf-label">{label}</label>
            {textarea
                ? <AutoSizeTextarea className="adf-input" minRows={3} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
                : <AutoSizeInput className="adf-input" type={type} value={value ?? ''} placeholder={placeholder} minChars={type === 'number' ? 6 : 14} onChange={(e) => onChange(e.target.value)} />
            }
        </div>
    );
}

function EditorSectionNav({ items, activeSection, onNavigate }) {
    if (!items.length) return null;

    return (
        <nav className="adf-page-nav" aria-label="Drug editor sections">
            {items.map((item) => {
                const isActive = activeSection === item.id;
                return (
                    <button
                        key={item.id}
                        type="button"
                        className={`adf-page-nav__item ${isActive ? 'active' : ''}`}
                        onClick={() => onNavigate(item.id)}
                        aria-label={`Go to ${item.title}`}
                        aria-current={isActive ? 'location' : undefined}
                    >
                        <span className="adf-page-nav__label">{item.title}</span>
                        <span className="adf-page-nav__mark" aria-hidden="true" />
                    </button>
                );
            })}
        </nav>
    );
}

function SectionCard({ def, data, onChange, onDelete, defaultCollapsed = false, sectionId }) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);

    const renderEditor = () => {
        switch (def.editor) {
            case 'dosage_forms':
                return <DosageFormsEditor data={data} onChange={onChange} />;
            case 'dosing':
                return <DosingEditor data={data} onChange={onChange} />;
            case 'warnings':
                return <WarningsEditor data={data} onChange={onChange} />;
            case 'adverse_effects':
                return <AdverseEffectsEditor data={data} onChange={onChange} />;
            case 'interactions':
                return <InteractionsEditor data={data} onChange={onChange} />;
            case 'hierarchy':
                return <HierarchyEditor data={data} onChange={onChange} levels={def.levels} />;
            case 'hierarchy_simple':
                return <HierarchyEditor data={data} onChange={onChange} levels={def.levels} />;
            case 'table_rows':
                return <TableRowsEditor data={data} onChange={onChange} columns={def.columns} />;
            default:
                return null;
        }
    };

    return (
        <section id={sectionId} className="adf-section adf-section-card">
            <div className="adf-section-card-header" onClick={() => setCollapsed(!collapsed)}>
                <div className="adf-section-card-left">
                    <span className="adf-section-card-icon">{def.icon}</span>
                    <h2 className="adf-section-title" style={{ margin: 0 }}>{def.title}</h2>
                </div>
                <div className="adf-section-card-actions">
                    <button type="button" className="adf-section-delete-btn"
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        title={`Remove ${def.title} section`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                    </button>
                    <svg className="adf-section-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                        style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </div>
            </div>
            {!collapsed && (
                <div className="adf-section-card-body">
                    {renderEditor()}
                </div>
            )}
        </section>
    );
}

/* ────────────────────── MAIN COMPONENT ────────────────────── */

export default function AddDrug({ mode = 'add' }) {
    const { id } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { showToast } = useToast();
    const isEdit = mode === 'edit' && !!id;
    const issueFixId = isEdit ? parseNumberOrNull(searchParams.get('issueId')) : null;
    const isIssueFixFlow = isEdit && issueFixId != null;

    const [record, setRecord] = useState(emptyRecord());
    const [loadedRecord, setLoadedRecord] = useState(null);
    const [rawText, setRawText] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const [extractingSource, setExtractingSource] = useState('');
    const [extractFeedback, setExtractFeedback] = useState({ tone: '', message: '' });
    const [loading, setLoading] = useState(isEdit);
    const [saving, setSaving] = useState(false);
    const [visibleSections, setVisibleSections] = useState(new Set(SECTION_DEFS.map((s) => s.key)));
    const [showSectionMenu, setShowSectionMenu] = useState(false);
    const [activeSection, setActiveSection] = useState('adf-core-info');

    const extension = useMemo(() => asArray(record.drug_dms_extensions)[0] ?? {}, [record.drug_dms_extensions]);
    const extracting = extractingSource !== '';
    const visibleSectionDefs = useMemo(
        () => SECTION_DEFS.filter((section) => visibleSections.has(section.key)),
        [visibleSections],
    );
    const editorNavItems = useMemo(() => {
        const items = [
            ...(!isEdit ? [{ id: 'adf-ai-extract', title: 'AI Extract' }] : []),
            { id: 'adf-core-info', title: 'Core Information' },
            { id: 'adf-dms-extension', title: 'DMS Extension' },
            ...visibleSectionDefs.map((section) => ({
                id: `adf-section-${section.key}`,
                title: section.title,
            })),
            { id: 'adf-save-section', title: isEdit ? 'Save Changes' : 'Create Drug' },
        ];

        return loading ? [] : items;
    }, [isEdit, loading, visibleSectionDefs]);

    useEffect(() => {
        if (!isEdit) {
            setLoadedRecord(null);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const data = await drugsApi.getDetails(id);
                if (!cancelled) {
                    const editorRecord = toEditorRecord(data);
                    setRecord(editorRecord);
                    setLoadedRecord(cloneValue(editorRecord));
                    // Always show all sections on edit so user can add to any
                    setVisibleSections(new Set(SECTION_DEFS.map((s) => s.key)));
                }
            } catch (error) {
                if (!cancelled) showToast(error.message || 'Failed to load drug', 'error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [id, isEdit, showToast]);

    useEffect(() => {
        if (editorNavItems.length === 0) return undefined;

        const updateActiveSection = () => {
            const activationOffset = 150;
            let current = editorNavItems[0].id;

            editorNavItems.forEach((item) => {
                const element = document.getElementById(item.id);
                if (element && element.getBoundingClientRect().top <= activationOffset) {
                    current = item.id;
                }
            });

            setActiveSection((prev) => (prev === current ? prev : current));
        };

        updateActiveSection();
        window.addEventListener('scroll', updateActiveSection, { passive: true });
        window.addEventListener('resize', updateActiveSection);

        return () => {
            window.removeEventListener('scroll', updateActiveSection);
            window.removeEventListener('resize', updateActiveSection);
        };
    }, [editorNavItems]);

    const setField = (key, value) => setRecord((prev) => ({ ...prev, [key]: value }));
    const setExtensionField = (key, value) => {
        setRecord((prev) => {
            const current = asArray(prev.drug_dms_extensions);
            return { ...prev, drug_dms_extensions: [{ ...(current[0] ?? {}), [key]: value }] };
        });
    };

    const setSectionData = (key, value) => setRecord((prev) => ({ ...prev, [key]: value }));

    const removeSection = (key) => {
        setVisibleSections((prev) => { const next = new Set(prev); next.delete(key); return next; });
        setSectionData(key, makeEmptySection(key));
    };

    const addSection = (key) => {
        setVisibleSections((prev) => new Set(prev).add(key));
        setShowSectionMenu(false);
    };

    const hiddenSections = SECTION_DEFS.filter((s) => !visibleSections.has(s.key));

    const scrollToEditorSection = (sectionId) => {
        const element = document.getElementById(sectionId);
        if (!element) return;

        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveSection(sectionId);
    };

    const applyExtractedData = (extracted, successMessage) => {
        if (recordHasUserData(record) && !window.confirm('This will replace the current Add Drug form values with the extracted data. Continue?')) {
            setExtractFeedback({ tone: 'info', message: 'Extraction completed, but the current form was kept unchanged.' });
            return false;
        }

        setRecord(mapExtractedToSchema(extracted));
        setVisibleSections(new Set(SECTION_DEFS.map((section) => section.key)));
        setShowSectionMenu(false);
        setExtractFeedback({ tone: 'success', message: successMessage });
        return true;
    };

    const extractFromText = async () => {
        if (!rawText.trim()) {
            const message = 'Please paste source text first.';
            setExtractFeedback({ tone: 'error', message });
            showToast(message, 'error');
            return;
        }

        setExtractingSource('text');
        setExtractFeedback({ tone: 'info', message: 'Extracting from pasted text...' });
        try {
            const extracted = await drugsApi.extractText(rawText);
            if (applyExtractedData(extracted, 'Extraction completed and mapped to the Add Drug form.')) {
                showToast('Extraction completed and mapped to the Add Drug form.');
            }
        } catch (error) {
            const message = error.message || 'Failed to extract data';
            setExtractFeedback({ tone: 'error', message });
            showToast(message, 'error');
        } finally {
            setExtractingSource('');
        }
    };

    const extractFromFile = async () => {
        if (!selectedFile) {
            const message = 'Please choose a PDF or DOCX file first.';
            setExtractFeedback({ tone: 'error', message });
            showToast(message, 'error');
            return;
        }

        setExtractingSource('file');
        setExtractFeedback({ tone: 'info', message: `Extracting from ${selectedFile.name}...` });
        try {
            const extracted = await drugsApi.extractFile(selectedFile);
            if (applyExtractedData(extracted, `Extraction completed from ${selectedFile.name}.`)) {
                showToast(`Extraction completed from ${selectedFile.name}.`);
            }
        } catch (error) {
            const message = error.message || 'Failed to extract data from the uploaded file';
            setExtractFeedback({ tone: 'error', message });
            showToast(message, 'error');
        } finally {
            setExtractingSource('');
        }
    };

    const save = async () => {
        if (!String(record.generic_name ?? '').trim()) { showToast('Generic name is required', 'error'); return; }
        setSaving(true);
        try {
            const payload = isEdit ? buildEditPayload(record, loadedRecord) : toPayload(record);
            if (isEdit && Object.keys(payload).length === 0) {
                showToast(isIssueFixFlow ? 'Make a change before marking the issue as fixed.' : 'No changes to save.', 'info');
                return;
            }
            if (isEdit) {
                const updatedDrug = await drugsApi.update(id, payload);

                if (isIssueFixFlow) {
                    const resolvedVersionNumber = parseNumberOrNull(updatedDrug?.version_number);
                    if (resolvedVersionNumber == null) {
                        showToast('Drug updated, but the issue could not be marked as fixed because the new version number was missing.', 'error');
                        navigate(`/issues/${issueFixId}`);
                        return;
                    }

                    try {
                        await issuesApi.fix(issueFixId, { resolvedVersionNumber });
                        showToast('Drug updated and issue marked as fixed');
                    } catch (issueError) {
                        showToast(issueError.message || 'Drug updated, but failed to mark the issue as fixed.', 'error');
                    }

                    navigate(`/issues/${issueFixId}`);
                    return;
                }

                showToast('Drug updated successfully');
                navigate(`/drug/${id}`);
            } else {
                const created = await drugsApi.create(payload);
                const newId = created?.drug_id ?? created?.id ?? created?.version_id ?? null;
                showToast('Drug added successfully');
                if (newId) navigate(`/drug/${newId}`);
                else navigate('/medications');
            }
        } catch (error) {
            showToast(error.message || 'Failed to save drug', 'error');
        } finally {
            setSaving(false);
        }
    };

    /* ────── Render ────── */
    return (
        <div className="drug-view-page">
            <SearchHeader />
            <div className="adf-wrap">
                <EditorSectionNav
                    items={editorNavItems}
                    activeSection={activeSection}
                    onNavigate={scrollToEditorSection}
                />
                {/* Header */}
                <div className="adf-header">
                    <div className="adf-header-icon">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20" /></svg>
                    </div>
                    <div>
                        <h1 className="adf-title">{isEdit ? `Edit Drug #${id}` : 'Add New Drug'}</h1>
                        <p className="adf-subtitle">Dynamic drug editor with hierarchical sections</p>
                    </div>
                </div>

                {isIssueFixFlow && (
                    <section className="doctor-approval-banner" aria-live="polite">
                        <strong className="doctor-approval-banner__title">Issue-linked fix in progress</strong>
                        <p className="doctor-approval-banner__text">
                            Saving this edit will keep the normal versioning behavior and then mark issue #{issueFixId} as fixed with the new version.
                        </p>
                    </section>
                )}

                {/* AI Extract */}
                {!isEdit && (
                    <section id="adf-ai-extract" className="adf-section">
                        <h2 className="adf-section-title">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5z" /></svg>
                            AI Extract (Optional)
                        </h2>
                        <div className="adf-extract-grid">
                            <div className="adf-extract-card">
                                <p className="adf-extract-label">Upload PDF or DOCX</p>
                                <label className="ed-upload-zone adf-upload-zone-card" htmlFor="drug-extract-file">
                                    <span className="ed-upload-zone__icon">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M12 16V4" />
                                            <path d="m7 9 5-5 5 5" />
                                            <path d="M20 16.5a4.5 4.5 0 0 1-1.2 8.84H6.2A4.2 4.2 0 0 1 5 17.13" />
                                        </svg>
                                    </span>
                                    <span className="ed-upload-zone__label">
                                        {selectedFile ? selectedFile.name : 'Choose a PDF or DOCX file'}
                                    </span>
                                    <span className="ed-upload-zone__hint">Text PDFs only, up to 10 MB. Scanned PDFs are not supported in v1.</span>
                                    <input
                                        id="drug-extract-file"
                                        type="file"
                                        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                        onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                                    />
                                </label>
                                <button type="button" className="adf-btn-primary" onClick={extractFromFile} disabled={extracting || !selectedFile}>
                                    {extractingSource === 'file' ? <><span className="adf-spinner" /> Extracting...</> : 'Extract From File'}
                                </button>
                            </div>

                            <div className="adf-extract-card">
                                <p className="adf-extract-label">Paste source text</p>
                                <textarea
                                    className="adf-textarea-big"
                                    rows={8}
                                    value={rawText}
                                    onChange={(e) => setRawText(e.target.value)}
                                    placeholder="Paste leaflet or paper text here, then extract to prefill the Add Drug form."
                                />
                                <button type="button" className="adf-btn-primary" onClick={extractFromText} disabled={extracting || !rawText.trim()}>
                                    {extractingSource === 'text' ? <><span className="adf-spinner" /> Extracting...</> : 'Extract From Text'}
                                </button>
                            </div>
                        </div>
                        {extractFeedback.message && (
                            <p className={`adf-extract-status adf-extract-status--${extractFeedback.tone || 'info'}`}>
                                {extractFeedback.message}
                            </p>
                        )}
                    </section>
                )}

                {loading ? (
                    <section className="adf-section"><p className="adf-empty">Loading drug data...</p></section>
                ) : (
                    <>
                        {/* Top-level Fields */}
                        <section id="adf-core-info" className="adf-section">
                            <h2 className="adf-section-title">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                                Core Information
                            </h2>
                            <div className="adf-grid-2">
                                <Field label="Generic Name *" value={record.generic_name} onChange={(v) => setField('generic_name', v)} placeholder="e.g. Ascorbic Acid" />
                                <Field label="Brand Names (comma separated)" value={record.brand_names} onChange={(v) => setField('brand_names', v)} placeholder="e.g. Ascor, Cenolate, Vitamin C" />
                                <Field label="URL" value={record.url} onChange={(v) => setField('url', v)} placeholder="https://..." />
                                <Field label="Rx Status" value={record.rx_status} onChange={(v) => setField('rx_status', v)} placeholder="e.g. Rx, OTC, Rx/OTC" />
                                <Field label="Source" value={record.source} onChange={(v) => setField('source', v)} placeholder="e.g. DMS, MedScape" />
                                <Field label="Doctor ID" type="number" value={record.doctor_id ?? ''} onChange={(v) => setField('doctor_id', v)} />
                            </div>
                        </section>

                        {/* DMS Extension */}
                        <section id="adf-dms-extension" className="adf-section">
                            <h2 className="adf-section-title">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                DMS Extension
                            </h2>
                            <div className="adf-grid-2">
                                <Field label="HAM (1/0)" type="number" value={extension.ham ?? ''} onChange={(v) => setExtensionField('ham', v)} />
                                <Field label="Price" type="number" value={extension.price ?? ''} onChange={(v) => setExtensionField('price', v)} />
                                <Field label="Arabic Trade Name" value={extension.arabic_trade_name ?? ''} onChange={(v) => setExtensionField('arabic_trade_name', v)} />
                                <Field label="Route (JSON or comma list)" textarea value={extension.route ?? ''} onChange={(v) => setExtensionField('route', v)} />
                                <Field label="Arabic Route (JSON or comma list)" textarea value={extension.arabic_route ?? ''} onChange={(v) => setExtensionField('arabic_route', v)} />
                                <Field label="Notes" textarea value={extension.notes ?? ''} onChange={(v) => setExtensionField('notes', v)} />
                            </div>
                        </section>

                        {/* Section Cards */}
                        {visibleSectionDefs.map((def) => (
                            <SectionCard
                                key={def.key}
                                def={def}
                                sectionId={`adf-section-${def.key}`}
                                data={record[def.key]}
                                onChange={(val) => setSectionData(def.key, val)}
                                onDelete={() => removeSection(def.key)}
                            />
                        ))}

                        {/* Add Section Button */}
                        {hiddenSections.length > 0 && (
                            <div className="adf-add-section-wrap">
                                <button type="button" className="adf-btn-add-section" onClick={() => setShowSectionMenu(!showSectionMenu)}>
                                    <span className="he-plus">+</span> Add Section
                                </button>
                                {showSectionMenu && (
                                    <div className="adf-section-menu">
                                        {hiddenSections.map((s) => (
                                            <button key={s.key} type="button" className="adf-section-menu-item" onClick={() => addSection(s.key)}>
                                                <span>{s.icon}</span> {s.title}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Save Bar */}
                        <div id="adf-save-section" className="adf-save-bar">
                            <div className="adf-save-summary">
                                <span>Sections: <strong>{visibleSections.size}</strong></span>
                            </div>
                            <button type="button" className="adf-btn-primary adf-btn-lg" onClick={save} disabled={saving}>
                                {saving ? <><span className="adf-spinner" /> Saving...</> : (isEdit ? 'Save Changes' : 'Create Drug')}
                            </button>
                        </div>
                    </>
                )}
            </div>
            <Footer />
        </div>
    );
}
