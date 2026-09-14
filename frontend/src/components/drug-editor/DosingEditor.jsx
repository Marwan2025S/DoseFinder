import { useState } from 'react';
import { AutoSizeInput } from './AutoSizeField';
import { ListHeaderGroups, normalizeHeaderKey } from './ListHeaderGroups';

/**
 * DosingEditor – Population-tabbed editor for drug dosing.
 * Hierarchy: population → indication → sub_indication → entries (list_header + notes_text)
 *
 * Data shape:
 * [
 *   { population: "adult", _id: "...", indications: [
 *       { indication: "rda", _id: "...", sub_indications: [
 *           { sub_indication: null, _id: "...", entries: [
 *               { list_header: null, notes_text: "Males: 90 mg/day", _id: "..." }
 *           ]}
 *       ]}
 *   ]}
 * ]
 */

const uid = (() => { let c = 0; return () => `ds_${++c}_${Date.now()}`; })();

const POPULATION_PRESETS = ['adult', 'pediatric', 'geriatric', 'default'];

export default function DosingEditor({ data = [], onChange }) {
    const [activeTab, setActiveTab] = useState(data[0]?._id || '');

    const update = (next) => onChange(next);

    const addPopulation = () => {
        const used = new Set(data.map((p) => p.population));
        const name = POPULATION_PRESETS.find((p) => !used.has(p)) || `population_${data.length + 1}`;
        const node = { population: name, _id: uid(), indications: [] };
        const next = [...data, node];
        update(next);
        setActiveTab(node._id);
    };

    const removePopulation = (id) => {
        const next = data.filter((p) => p._id !== id);
        update(next);
        if (activeTab === id) setActiveTab(next[0]?._id || '');
    };

    const updatePopulationName = (id, value) => {
        update(data.map((p) => p._id === id ? { ...p, population: value } : p));
    };

    const getActive = () => data.find((p) => p._id === activeTab) || null;

    /* ── Indication ── */
    const addIndication = () => {
        const next = data.map((p) => {
            if (p._id !== activeTab) return p;
            return { ...p, indications: [...p.indications, { indication: '', _id: uid(), sub_indications: [{ sub_indication: null, _id: uid(), entries: [{ list_header: null, notes_text: '', _id: uid() }] }] }] };
        });
        update(next);
    };

    const removeIndication = (indicationId) => {
        const next = data.map((p) => {
            if (p._id !== activeTab) return p;
            return { ...p, indications: p.indications.filter((ind) => ind._id !== indicationId) };
        });
        update(next);
    };

    const updateIndicationLabel = (indicationId, value) => {
        const next = data.map((p) => {
            if (p._id !== activeTab) return p;
            return { ...p, indications: p.indications.map((ind) => ind._id === indicationId ? { ...ind, indication: value } : ind) };
        });
        update(next);
    };

    /* ── Sub-Indication ── */
    const addSubIndication = (indicationId) => {
        const next = data.map((p) => {
            if (p._id !== activeTab) return p;
            return {
                ...p, indications: p.indications.map((ind) => {
                    if (ind._id !== indicationId) return ind;
                    return { ...ind, sub_indications: [...ind.sub_indications, { sub_indication: '', _id: uid(), entries: [{ list_header: null, notes_text: '', _id: uid() }] }] };
                }),
            };
        });
        update(next);
    };

    const removeSubIndication = (indicationId, subId) => {
        const next = data.map((p) => {
            if (p._id !== activeTab) return p;
            return {
                ...p, indications: p.indications.map((ind) => {
                    if (ind._id !== indicationId) return ind;
                    return { ...ind, sub_indications: ind.sub_indications.filter((s) => s._id !== subId) };
                }),
            };
        });
        update(next);
    };

    const updateSubIndicationLabel = (indicationId, subId, value) => {
        const next = data.map((p) => {
            if (p._id !== activeTab) return p;
            return {
                ...p, indications: p.indications.map((ind) => {
                    if (ind._id !== indicationId) return ind;
                    return { ...ind, sub_indications: ind.sub_indications.map((s) => s._id === subId ? { ...s, sub_indication: value } : s) };
                }),
            };
        });
        update(next);
    };

    /* ── Entry ── */
    const addEntry = (indicationId, subId, listHeader = null) => {
        const next = data.map((p) => {
            if (p._id !== activeTab) return p;
            return {
                ...p, indications: p.indications.map((ind) => {
                    if (ind._id !== indicationId) return ind;
                    return {
                        ...ind, sub_indications: ind.sub_indications.map((s) => {
                            if (s._id !== subId) return s;
                            return { ...s, entries: [...s.entries, { list_header: listHeader || null, notes_text: '', _id: uid() }] };
                        }),
                    };
                }),
            };
        });
        update(next);
    };

    const removeEntry = (indicationId, subId, entryId) => {
        const next = data.map((p) => {
            if (p._id !== activeTab) return p;
            return {
                ...p, indications: p.indications.map((ind) => {
                    if (ind._id !== indicationId) return ind;
                    return {
                        ...ind, sub_indications: ind.sub_indications.map((s) => {
                            if (s._id !== subId) return s;
                            return { ...s, entries: s.entries.filter((e) => e._id !== entryId) };
                        }),
                    };
                }),
            };
        });
        update(next);
    };

    const updateEntry = (indicationId, subId, entryId, field, value) => {
        const next = data.map((p) => {
            if (p._id !== activeTab) return p;
            return {
                ...p, indications: p.indications.map((ind) => {
                    if (ind._id !== indicationId) return ind;
                    return {
                        ...ind, sub_indications: ind.sub_indications.map((s) => {
                            if (s._id !== subId) return s;
                            return { ...s, entries: s.entries.map((e) => e._id === entryId ? { ...e, [field]: value || null } : e) };
                        }),
                    };
                }),
            };
        });
        update(next);
    };

    const updateEntryGroupHeader = (indicationId, subId, headerKey, value) => {
        const next = data.map((p) => {
            if (p._id !== activeTab) return p;
            return {
                ...p, indications: p.indications.map((ind) => {
                    if (ind._id !== indicationId) return ind;
                    return {
                        ...ind, sub_indications: ind.sub_indications.map((s) => {
                            if (s._id !== subId) return s;
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
                }),
            };
        });
        update(next);
    };

    const removeEntryGroup = (indicationId, subId, headerKey) => {
        const next = data.map((p) => {
            if (p._id !== activeTab) return p;
            return {
                ...p, indications: p.indications.map((ind) => {
                    if (ind._id !== indicationId) return ind;
                    return {
                        ...ind, sub_indications: ind.sub_indications.map((s) => {
                            if (s._id !== subId) return s;
                            return {
                                ...s,
                                entries: s.entries.filter((entry) => normalizeHeaderKey(entry.list_header) !== headerKey),
                            };
                        }),
                    };
                }),
            };
        });
        update(next);
    };

    const active = getActive();

    return (
        <div className="de-dosing-root">
            {/* Population tabs */}
            <div className="de-pop-tabs">
                {data.map((pop) => (
                    <button key={pop._id} type="button" className={`de-pop-tab ${activeTab === pop._id ? 'active' : ''}`} onClick={() => setActiveTab(pop._id)}>
                        {pop.population || 'Unnamed'}
                        <span className="de-pop-tab-x" onClick={(e) => { e.stopPropagation(); removePopulation(pop._id); }} title="Remove population">×</span>
                    </button>
                ))}
                <button type="button" className="de-pop-tab de-pop-tab-add" onClick={addPopulation}>+ Population</button>
            </div>

            {active && (
                <div className="de-pop-body">
                    <div className="he-node-header" style={{ marginBottom: 10 }}>
                        <span className="he-level-badge">Population</span>
                        <AutoSizeInput type="text" className="he-label-input" value={active.population} onChange={(e) => updatePopulationName(active._id, e.target.value)} placeholder="Population name..." minChars={12} />
                    </div>

                    {active.indications.map((ind) => (
                        <div key={ind._id} className="he-node he-depth-0">
                            <IndicationNode
                                ind={ind}
                                onUpdateLabel={updateIndicationLabel}
                                onRemove={removeIndication}
                                onAddSub={addSubIndication}
                                onRemoveSub={removeSubIndication}
                                onUpdateSubLabel={updateSubIndicationLabel}
                                onAddEntry={addEntry}
                                onRemoveEntry={removeEntry}
                                onUpdateEntry={updateEntry}
                            />
                        </div>
                    ))}

                    <button type="button" className="he-add-root-btn" onClick={addIndication}>
                        <span className="he-plus">+</span> Add Indication
                    </button>
                </div>
            )}

            {data.length === 0 && (
                <p className="he-empty">No populations. Click "+ Population" to add one.</p>
            )}
        </div>
    );
}

function IndicationNode({ ind, onUpdateLabel, onRemove, onAddSub, onRemoveSub, onUpdateSubLabel, onAddEntry, onRemoveEntry, onUpdateEntry }) {
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
                <span className="he-level-badge">Indication</span>
                <AutoSizeInput type="text" className="he-label-input" value={ind.indication} onChange={(e) => onUpdateLabel(ind._id, e.target.value)} placeholder="e.g. rda, dosing..." minChars={12} />
                <button type="button" className="he-remove-node-btn" onClick={() => onRemove(ind._id)} title="Remove indication">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
            </div>
            {!collapsed && (
                <div className="he-node-body">
                    {ind.sub_indications.map((sub) => (
                        <div key={sub._id} className="he-node he-depth-1">
                            <SubIndicationNode
                                sub={sub}
                                indicationId={ind._id}
                                onRemove={onRemoveSub}
                                onUpdateLabel={onUpdateSubLabel}
                                onAddEntry={onAddEntry}
                                onRemoveEntry={onRemoveEntry}
                                onUpdateEntry={onUpdateEntry}
                            />
                        </div>
                    ))}
                    <div className="he-add-bar">
                        <button type="button" className="he-add-child-btn" onClick={() => onAddSub(ind._id)}>
                            <span className="he-plus">+</span> Sub-Indication
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

function SubIndicationNode({ sub, indicationId, onRemove, onUpdateLabel, onAddEntry, onRemoveEntry, onUpdateEntry }) {
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
                <span className="he-level-badge he-level-1">Sub-Indication</span>
                <AutoSizeInput type="text" className="he-label-input" value={sub.sub_indication || ''} onChange={(e) => onUpdateLabel(indicationId, sub._id, e.target.value)} placeholder="(optional)" minChars={10} />
                <button type="button" className="he-remove-node-btn" onClick={() => onRemove(indicationId, sub._id)} title="Remove sub-indication">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
            </div>
            {!collapsed && (
                <div className="he-node-body">
                    <ListHeaderGroups
                        entries={sub.entries}
                        textField="notes_text"
                        textPlaceholder="Dosing text..."
                        addTextLabel="Add Dosing Text"
                        addHeaderLabel="Add List Header"
                        onAddHeader={() => onAddEntry(indicationId, sub._id, null)}
                        onAddText={(listHeader) => onAddEntry(indicationId, sub._id, listHeader)}
                        onUpdateHeader={(headerKey, value) => onUpdateEntryGroupHeader(indicationId, sub._id, headerKey, value)}
                        onRemoveGroup={(headerKey) => onRemoveEntryGroup(indicationId, sub._id, headerKey)}
                        onUpdateText={(entryId, value) => onUpdateEntry(indicationId, sub._id, entryId, 'notes_text', value)}
                        onRemoveText={(entryId) => onRemoveEntry(indicationId, sub._id, entryId)}
                    />
                </div>
            )}
        </>
    );
}
