import { useState } from 'react';
import { AutoSizeInput } from './AutoSizeField';
import { ListHeaderGroups, normalizeHeaderKey } from './ListHeaderGroups';

/**
 * AdverseEffectsEditor – Hierarchy: severity_band → body_system → entries (list_header + effect_text)
 *
 * Data shape:
 * [
 *   { severity_band: ">10%", _id: "...", body_systems: [
 *       { body_system: "general", _id: "...", entries: [
 *           { list_header: null, effect_text: "Flushing", _id: "..." }
 *       ]}
 *   ]}
 * ]
 */

const uid = (() => { let c = 0; return () => `ae_${++c}_${Date.now()}`; })();

export default function AdverseEffectsEditor({ data = [], onChange }) {
    const update = (next) => onChange(next);

    const addBand = () => {
        update([...data, {
            severity_band: 'Frequency Not Defined', _id: uid(), body_systems: [
                { body_system: 'general', _id: uid(), entries: [{ list_header: null, effect_text: '', _id: uid() }] },
            ],
        }]);
    };

    const removeBand = (id) => update(data.filter((b) => b._id !== id));

    const updateBandLabel = (id, value) => {
        update(data.map((b) => b._id === id ? { ...b, severity_band: value } : b));
    };

    /* Body system ops */
    const addBodySystem = (bandId) => {
        update(data.map((b) => {
            if (b._id !== bandId) return b;
            return { ...b, body_systems: [...b.body_systems, { body_system: '', _id: uid(), entries: [{ list_header: null, effect_text: '', _id: uid() }] }] };
        }));
    };

    const removeBodySystem = (bandId, bsId) => {
        update(data.map((b) => {
            if (b._id !== bandId) return b;
            return { ...b, body_systems: b.body_systems.filter((bs) => bs._id !== bsId) };
        }));
    };

    const updateBodySystemLabel = (bandId, bsId, value) => {
        update(data.map((b) => {
            if (b._id !== bandId) return b;
            return { ...b, body_systems: b.body_systems.map((bs) => bs._id === bsId ? { ...bs, body_system: value } : bs) };
        }));
    };

    /* Entry ops */
    const addEntry = (bandId, bsId, listHeader = null) => {
        update(data.map((b) => {
            if (b._id !== bandId) return b;
            return {
                ...b, body_systems: b.body_systems.map((bs) => {
                    if (bs._id !== bsId) return bs;
                    return { ...bs, entries: [...bs.entries, { list_header: listHeader || null, effect_text: '', _id: uid() }] };
                }),
            };
        }));
    };

    const removeEntry = (bandId, bsId, eId) => {
        update(data.map((b) => {
            if (b._id !== bandId) return b;
            return {
                ...b, body_systems: b.body_systems.map((bs) => {
                    if (bs._id !== bsId) return bs;
                    return { ...bs, entries: bs.entries.filter((e) => e._id !== eId) };
                }),
            };
        }));
    };

    const updateEntry = (bandId, bsId, eId, field, value) => {
        update(data.map((b) => {
            if (b._id !== bandId) return b;
            return {
                ...b, body_systems: b.body_systems.map((bs) => {
                    if (bs._id !== bsId) return bs;
                    return { ...bs, entries: bs.entries.map((e) => e._id === eId ? { ...e, [field]: value || null } : e) };
                }),
            };
        }));
    };

    const updateEntryGroupHeader = (bandId, bsId, headerKey, value) => {
        update(data.map((b) => {
            if (b._id !== bandId) return b;
            return {
                ...b, body_systems: b.body_systems.map((bs) => {
                    if (bs._id !== bsId) return bs;
                    return {
                        ...bs,
                        entries: bs.entries.map((entry) => (
                            normalizeHeaderKey(entry.list_header) === headerKey
                                ? { ...entry, list_header: value || null }
                                : entry
                        )),
                    };
                }),
            };
        }));
    };

    const removeEntryGroup = (bandId, bsId, headerKey) => {
        update(data.map((b) => {
            if (b._id !== bandId) return b;
            return {
                ...b, body_systems: b.body_systems.map((bs) => {
                    if (bs._id !== bsId) return bs;
                    return {
                        ...bs,
                        entries: bs.entries.filter((entry) => normalizeHeaderKey(entry.list_header) !== headerKey),
                    };
                }),
            };
        }));
    };

    return (
        <div className="he-root">
            {data.map((band) => (
                <BandNode key={band._id} band={band}
                    onUpdateLabel={updateBandLabel} onRemove={removeBand}
                    onAddBS={addBodySystem} onRemoveBS={removeBodySystem} onUpdateBSLabel={updateBodySystemLabel}
                    onAddEntry={addEntry} onRemoveEntry={removeEntry} onUpdateEntry={updateEntry}
                />
            ))}
            <button type="button" className="he-add-root-btn" onClick={addBand}>
                <span className="he-plus">+</span> Add Severity Band
            </button>
        </div>
    );
}

function BandNode({ band, onUpdateLabel, onRemove, onAddBS, onRemoveBS, onUpdateBSLabel, onAddEntry, onRemoveEntry, onUpdateEntry }) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div className="he-node he-depth-0">
            <div className="he-node-header">
                <button type="button" className="he-collapse-btn" onClick={() => setCollapsed(!collapsed)}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </button>
                <span className="he-level-badge">Band</span>
                <AutoSizeInput type="text" className="he-label-input" value={band.severity_band} onChange={(e) => onUpdateLabel(band._id, e.target.value)} placeholder="e.g. >10%, 1-10%, Frequency Not Defined..." minChars={16} />
                <button type="button" className="he-remove-node-btn" onClick={() => onRemove(band._id)} title="Remove band">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
            </div>
            {!collapsed && (
                <div className="he-node-body">
                    {band.body_systems.map((bs) => (
                        <div key={bs._id} className="he-node he-depth-1">
                            <BodySystemNode bs={bs} bandId={band._id}
                                onRemove={onRemoveBS} onUpdateLabel={onUpdateBSLabel}
                                onAddEntry={onAddEntry} onRemoveEntry={onRemoveEntry} onUpdateEntry={onUpdateEntry}
                            />
                        </div>
                    ))}
                    <div className="he-add-bar">
                        <button type="button" className="he-add-child-btn" onClick={() => onAddBS(band._id)}>
                            <span className="he-plus">+</span> Body System
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function BodySystemNode({ bs, bandId, onRemove, onUpdateLabel, onAddEntry, onRemoveEntry, onUpdateEntry }) {
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
                <span className="he-level-badge he-level-1">Body System</span>
                <AutoSizeInput type="text" className="he-label-input" value={bs.body_system || ''} onChange={(e) => onUpdateLabel(bandId, bs._id, e.target.value)} placeholder="e.g. general, cardiovascular..." minChars={14} />
                <button type="button" className="he-remove-node-btn" onClick={() => onRemove(bandId, bs._id)} title="Remove body system">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
            </div>
            {!collapsed && (
                <div className="he-node-body">
                    <ListHeaderGroups
                        entries={bs.entries}
                        textField="effect_text"
                        textPlaceholder="Effect text..."
                        addTextLabel="Add Effect Text"
                        addHeaderLabel="Add List Header"
                        onAddHeader={() => onAddEntry(bandId, bs._id, null)}
                        onAddText={(listHeader) => onAddEntry(bandId, bs._id, listHeader)}
                        onUpdateHeader={(headerKey, value) => onUpdateEntryGroupHeader(bandId, bs._id, headerKey, value)}
                        onRemoveGroup={(headerKey) => onRemoveEntryGroup(bandId, bs._id, headerKey)}
                        onUpdateText={(entryId, value) => onUpdateEntry(bandId, bs._id, entryId, 'effect_text', value)}
                        onRemoveText={(entryId) => onRemoveEntry(bandId, bs._id, entryId)}
                    />
                </div>
            )}
        </>
    );
}
