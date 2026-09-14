import { useState } from 'react';
import { AutoSizeInput } from './AutoSizeField';
import { ListHeaderGroups, normalizeHeaderKey } from './ListHeaderGroups';

/**
 * WarningsEditor – Hierarchy: warning_type → sub_warning_type → entries (list_header + text)
 *
 * Data shape:
 * [
 *   { warning_type: "Black Box Warning", _id: "...", sub_types: [
 *       { sub_warning_type: null, _id: "...", entries: [
 *           { list_header: null, text: "Can cause...", _id: "..." }
 *       ]}
 *   ]}
 * ]
 */

const uid = (() => { let c = 0; return () => `wr_${++c}_${Date.now()}`; })();

const WARNING_TYPE_PRESETS = ['Black Box Warning', 'Contraindication', 'Caution', 'Allergic Category'];

export default function WarningsEditor({ data = [], onChange }) {
    const update = (next) => onChange(next);

    const addWarningType = () => {
        const used = new Set(data.map((w) => w.warning_type));
        const name = WARNING_TYPE_PRESETS.find((p) => !used.has(p)) || '';
        update([...data, {
            warning_type: name, _id: uid(), sub_types: [
                { sub_warning_type: null, _id: uid(), entries: [{ list_header: null, text: '', _id: uid() }] },
            ],
        }]);
    };

    const removeWarningType = (id) => update(data.filter((w) => w._id !== id));

    const updateWarningTypeLabel = (id, value) => {
        update(data.map((w) => w._id === id ? { ...w, warning_type: value } : w));
    };

    /* Sub-type ops */
    const addSubType = (wtId) => {
        update(data.map((w) => {
            if (w._id !== wtId) return w;
            return { ...w, sub_types: [...w.sub_types, { sub_warning_type: '', _id: uid(), entries: [{ list_header: null, text: '', _id: uid() }] }] };
        }));
    };

    const removeSubType = (wtId, stId) => {
        update(data.map((w) => {
            if (w._id !== wtId) return w;
            return { ...w, sub_types: w.sub_types.filter((s) => s._id !== stId) };
        }));
    };

    const updateSubTypeLabel = (wtId, stId, value) => {
        update(data.map((w) => {
            if (w._id !== wtId) return w;
            return { ...w, sub_types: w.sub_types.map((s) => s._id === stId ? { ...s, sub_warning_type: value || null } : s) };
        }));
    };

    /* Entry ops */
    const addEntry = (wtId, stId, listHeader = null) => {
        update(data.map((w) => {
            if (w._id !== wtId) return w;
            return {
                ...w, sub_types: w.sub_types.map((s) => {
                    if (s._id !== stId) return s;
                    return { ...s, entries: [...s.entries, { list_header: listHeader || null, text: '', _id: uid() }] };
                }),
            };
        }));
    };

    const removeEntry = (wtId, stId, eId) => {
        update(data.map((w) => {
            if (w._id !== wtId) return w;
            return {
                ...w, sub_types: w.sub_types.map((s) => {
                    if (s._id !== stId) return s;
                    return { ...s, entries: s.entries.filter((e) => e._id !== eId) };
                }),
            };
        }));
    };

    const updateEntry = (wtId, stId, eId, field, value) => {
        update(data.map((w) => {
            if (w._id !== wtId) return w;
            return {
                ...w, sub_types: w.sub_types.map((s) => {
                    if (s._id !== stId) return s;
                    return { ...s, entries: s.entries.map((e) => e._id === eId ? { ...e, [field]: value || null } : e) };
                }),
            };
        }));
    };

    const updateEntryGroupHeader = (wtId, stId, headerKey, value) => {
        update(data.map((w) => {
            if (w._id !== wtId) return w;
            return {
                ...w, sub_types: w.sub_types.map((s) => {
                    if (s._id !== stId) return s;
                    return {
                        ...s,
                        entries: s.entries.map((entry) => (
                            normalizeHeaderKey(entry.list_header) === headerKey
                                ? { ...entry, list_header: value || null }
                                : entry
                        )),
                    };
                }),
            };
        }));
    };

    const removeEntryGroup = (wtId, stId, headerKey) => {
        update(data.map((w) => {
            if (w._id !== wtId) return w;
            return {
                ...w, sub_types: w.sub_types.map((s) => {
                    if (s._id !== stId) return s;
                    return {
                        ...s,
                        entries: s.entries.filter((entry) => normalizeHeaderKey(entry.list_header) !== headerKey),
                    };
                }),
            };
        }));
    };

    return (
        <div className="he-root">
            {data.map((wt) => (
                <WarningTypeNode key={wt._id} wt={wt}
                    onUpdateLabel={updateWarningTypeLabel} onRemove={removeWarningType}
                    onAddSub={addSubType} onRemoveSub={removeSubType} onUpdateSubLabel={updateSubTypeLabel}
                    onAddEntry={addEntry} onRemoveEntry={removeEntry} onUpdateEntry={updateEntry}
                />
            ))}
            <button type="button" className="he-add-root-btn" onClick={addWarningType}>
                <span className="he-plus">+</span> Add Warning Type
            </button>
        </div>
    );
}

function WarningTypeNode({ wt, onUpdateLabel, onRemove, onAddSub, onRemoveSub, onUpdateSubLabel, onAddEntry, onRemoveEntry, onUpdateEntry }) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div className="he-node he-depth-0 he-node-warn">
            <div className="he-node-header">
                <button type="button" className="he-collapse-btn" onClick={() => setCollapsed(!collapsed)}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </button>
                <span className="he-level-badge he-badge-warn">Type</span>
                <AutoSizeInput type="text" className="he-label-input" value={wt.warning_type} onChange={(e) => onUpdateLabel(wt._id, e.target.value)} placeholder="e.g. Contraindication, Caution..." minChars={14} />
                <button type="button" className="he-remove-node-btn" onClick={() => onRemove(wt._id)} title="Remove warning type">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
            </div>
            {!collapsed && (
                <div className="he-node-body">
                    {wt.sub_types.map((st) => (
                        <div key={st._id} className="he-node he-depth-1">
                            <SubWarningNode st={st} wtId={wt._id}
                                onRemove={onRemoveSub} onUpdateLabel={onUpdateSubLabel}
                                onAddEntry={onAddEntry} onRemoveEntry={onRemoveEntry} onUpdateEntry={onUpdateEntry}
                            />
                        </div>
                    ))}
                    <div className="he-add-bar">
                        <button type="button" className="he-add-child-btn" onClick={() => onAddSub(wt._id)}>
                            <span className="he-plus">+</span> Sub-Type
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function SubWarningNode({ st, wtId, onRemove, onUpdateLabel, onAddEntry, onRemoveEntry, onUpdateEntry }) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <>
            <div className="he-node-header">
                <button type="button" className="he-collapse-btn" onClick={() => setCollapsed(!collapsed)}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </button>
                <span className="he-level-badge he-level-1">Sub-Type</span>
                <AutoSizeInput type="text" className="he-label-input" value={st.sub_warning_type || ''} onChange={(e) => onUpdateLabel(wtId, st._id, e.target.value)} placeholder="(optional)" minChars={10} />
                <button type="button" className="he-remove-node-btn" onClick={() => onRemove(wtId, st._id)} title="Remove sub-type">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
            </div>
            {!collapsed && (
                <div className="he-node-body">
                    <ListHeaderGroups
                        entries={st.entries}
                        textField="text"
                        textPlaceholder="Warning text..."
                        addTextLabel="Add Warning Text"
                        addHeaderLabel="Add List Header"
                        onAddHeader={() => onAddEntry(wtId, st._id, null)}
                        onAddText={(listHeader) => onAddEntry(wtId, st._id, listHeader)}
                        onUpdateHeader={(headerKey, value) => onUpdateEntryGroupHeader(wtId, st._id, headerKey, value)}
                        onRemoveGroup={(headerKey) => onRemoveEntryGroup(wtId, st._id, headerKey)}
                        onUpdateText={(entryId, value) => onUpdateEntry(wtId, st._id, entryId, 'text', value)}
                        onRemoveText={(entryId) => onRemoveEntry(wtId, st._id, entryId)}
                    />
                </div>
            )}
        </>
    );
}
