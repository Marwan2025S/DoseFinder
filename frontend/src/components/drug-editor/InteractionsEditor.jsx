import { useState } from 'react';
import { AutoSizeInput, AutoSizeTextarea } from './AutoSizeField';

/**
 * InteractionsEditor – Grouped by severity_level, each containing interacting drugs.
 *
 * Data shape:
 * [
 *   { severity_level: "Risk X", _id: "...", interactions: [
 *       { interacting_drug: "Warfarin", description: "Increased bleeding risk", _id: "..." }
 *   ]}
 * ]
 */

const uid = (() => { let c = 0; return () => `ix_${++c}_${Date.now()}`; })();

export default function InteractionsEditor({ data = [], onChange }) {
    const update = (next) => onChange(next);

    const addGroup = () => {
        update([...data, {
            severity_level: '', _id: uid(), interactions: [
                { interacting_drug: '', description: '', _id: uid() },
            ],
        }]);
    };

    const removeGroup = (id) => update(data.filter((g) => g._id !== id));

    const updateGroupLabel = (id, value) => {
        update(data.map((g) => g._id === id ? { ...g, severity_level: value } : g));
    };

    const addInteraction = (groupId) => {
        update(data.map((g) => {
            if (g._id !== groupId) return g;
            return { ...g, interactions: [...g.interactions, { interacting_drug: '', description: '', _id: uid() }] };
        }));
    };

    const removeInteraction = (groupId, intId) => {
        update(data.map((g) => {
            if (g._id !== groupId) return g;
            return { ...g, interactions: g.interactions.filter((i) => i._id !== intId) };
        }));
    };

    const updateInteraction = (groupId, intId, field, value) => {
        update(data.map((g) => {
            if (g._id !== groupId) return g;
            return { ...g, interactions: g.interactions.map((i) => i._id === intId ? { ...i, [field]: value } : i) };
        }));
    };

    return (
        <div className="he-root">
            {data.map((group) => (
                <InteractionGroup key={group._id} group={group}
                    onUpdateLabel={updateGroupLabel} onRemove={removeGroup}
                    onAddInteraction={addInteraction} onRemoveInteraction={removeInteraction} onUpdateInteraction={updateInteraction}
                />
            ))}
            <button type="button" className="he-add-root-btn" onClick={addGroup}>
                <span className="he-plus">+</span> Add Severity Group
            </button>
        </div>
    );
}

function InteractionGroup({ group, onUpdateLabel, onRemove, onAddInteraction, onRemoveInteraction, onUpdateInteraction }) {
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
                <span className="he-level-badge">Severity</span>
                <AutoSizeInput type="text" className="he-label-input" value={group.severity_level} onChange={(e) => onUpdateLabel(group._id, e.target.value)} placeholder="e.g. Risk X, Monitor Closely (optional)..." minChars={16} />
                <button type="button" className="he-remove-node-btn" onClick={() => onRemove(group._id)} title="Remove group">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
            </div>
            {!collapsed && (
                <div className="he-node-body">
                    {group.interactions.map((inter) => (
                        <div key={inter._id} className="he-item-row he-interaction-row">
                            <span className="he-item-bullet">⚡</span>
                            <div className="he-entry-fields">
                                <AutoSizeInput type="text" className="he-label-input" value={inter.interacting_drug} onChange={(e) => onUpdateInteraction(group._id, inter._id, 'interacting_drug', e.target.value)} placeholder="Interacting drug name..." minChars={16} />
                                <AutoSizeTextarea className="he-item-input" minRows={1} value={inter.description || ''} onChange={(e) => onUpdateInteraction(group._id, inter._id, 'description', e.target.value)} placeholder="Description (optional)..." />
                            </div>
                            <button type="button" className="he-item-remove" onClick={() => onRemoveInteraction(group._id, inter._id)} title="Remove interaction">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                            </button>
                        </div>
                    ))}
                    <div className="he-add-bar">
                        <button type="button" className="he-add-child-btn he-add-item-btn" onClick={() => onAddInteraction(group._id)}>
                            <span className="he-plus">+</span> Interaction
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
