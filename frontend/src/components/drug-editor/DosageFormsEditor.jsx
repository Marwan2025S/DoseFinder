import { useState } from 'react';
import { AutoSizeInput } from './AutoSizeField';

/**
 * DosageFormsEditor – Population-grouped, form_name → strengths
 *
 * Data shape:
 * [
 *   { population: "adult", _id: "...", forms: [
 *       { form_name: "tablets", _id: "...", strengths: ["100mg", "250mg"] }
 *   ]}
 * ]
 */

const uid = (() => { let c = 0; return () => `df_${++c}_${Date.now()}`; })();

const POP_PRESETS = ['adult', 'pediatric', 'default'];

export default function DosageFormsEditor({ data = [], onChange }) {
    const [activeTab, setActiveTab] = useState(data[0]?._id || '');

    const update = (next) => onChange(next);

    const addPopulation = () => {
        const used = new Set(data.map((p) => p.population));
        const name = POP_PRESETS.find((p) => !used.has(p)) || `pop_${data.length + 1}`;
        const node = { population: name, _id: uid(), forms: [] };
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

    const active = data.find((p) => p._id === activeTab) || null;

    /* Form ops */
    const addForm = () => {
        update(data.map((p) => {
            if (p._id !== activeTab) return p;
            return { ...p, forms: [...p.forms, { form_name: '', _id: uid(), strengths: [''] }] };
        }));
    };

    const removeForm = (formId) => {
        update(data.map((p) => {
            if (p._id !== activeTab) return p;
            return { ...p, forms: p.forms.filter((f) => f._id !== formId) };
        }));
    };

    const updateFormName = (formId, value) => {
        update(data.map((p) => {
            if (p._id !== activeTab) return p;
            return { ...p, forms: p.forms.map((f) => f._id === formId ? { ...f, form_name: value } : f) };
        }));
    };

    /* Strength ops */
    const addStrength = (formId) => {
        update(data.map((p) => {
            if (p._id !== activeTab) return p;
            return {
                ...p, forms: p.forms.map((f) => {
                    if (f._id !== formId) return f;
                    return { ...f, strengths: [...f.strengths, ''] };
                }),
            };
        }));
    };

    const removeStrength = (formId, idx) => {
        update(data.map((p) => {
            if (p._id !== activeTab) return p;
            return {
                ...p, forms: p.forms.map((f) => {
                    if (f._id !== formId) return f;
                    return { ...f, strengths: f.strengths.filter((_, i) => i !== idx) };
                }),
            };
        }));
    };

    const updateStrength = (formId, idx, value) => {
        update(data.map((p) => {
            if (p._id !== activeTab) return p;
            return {
                ...p, forms: p.forms.map((f) => {
                    if (f._id !== formId) return f;
                    const next = [...f.strengths];
                    next[idx] = value;
                    return { ...f, strengths: next };
                }),
            };
        }));
    };

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

                    {active.forms.map((form) => (
                        <div key={form._id} className="he-node he-depth-0">
                            <FormNode form={form}
                                onRemove={removeForm} onUpdateName={updateFormName}
                                onAddStrength={addStrength} onRemoveStrength={removeStrength} onUpdateStrength={updateStrength}
                            />
                        </div>
                    ))}

                    <button type="button" className="he-add-root-btn" onClick={addForm}>
                        <span className="he-plus">+</span> Add Form
                    </button>
                </div>
            )}

            {data.length === 0 && (
                <p className="he-empty">No populations. Click "+ Population" to add one.</p>
            )}
        </div>
    );
}

function FormNode({ form, onRemove, onUpdateName, onAddStrength, onRemoveStrength, onUpdateStrength }) {
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
                <span className="he-level-badge">Form</span>
                <AutoSizeInput type="text" className="he-label-input" value={form.form_name} onChange={(e) => onUpdateName(form._id, e.target.value)} placeholder="e.g. tablets, syrup, injectable..." minChars={14} />
                <button type="button" className="he-remove-node-btn" onClick={() => onRemove(form._id)} title="Remove form">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
            </div>
            {!collapsed && (
                <div className="he-node-body">
                    {form.strengths.map((strength, idx) => (
                        <div key={`s_${idx}`} className="he-item-row">
                            <span className="he-item-bullet">◆</span>
                            <AutoSizeInput type="text" className="he-item-input he-strength-input" value={strength} onChange={(e) => onUpdateStrength(form._id, idx, e.target.value)} placeholder="e.g. 100mg, 250mg/mL..." minChars={10} />
                            <button type="button" className="he-item-remove" onClick={() => onRemoveStrength(form._id, idx)} title="Remove strength">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                            </button>
                        </div>
                    ))}
                    <div className="he-add-bar">
                        <button type="button" className="he-add-child-btn he-add-item-btn" onClick={() => onAddStrength(form._id)}>
                            <span className="he-plus">+</span> Strength
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
