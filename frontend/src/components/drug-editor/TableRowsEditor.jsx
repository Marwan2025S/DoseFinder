import { AutoSizeInput, AutoSizeTextarea } from './AutoSizeField';

const uid = (() => { let c = 0; return () => `tr_${++c}_${Date.now()}`; })();

const makeEmptyRow = (columns = []) => Object.fromEntries(columns.map((column) => [column.key, column.defaultValue ?? '']));

export default function TableRowsEditor({ data = [], onChange, columns = [] }) {
    const rows = Array.isArray(data) ? data : [];

    const updateRows = (nextRows) => onChange(nextRows);

    const addRow = () => {
        updateRows([...rows, { ...makeEmptyRow(columns), _id: uid() }]);
    };

    const removeRow = (index) => {
        updateRows(rows.filter((_, rowIndex) => rowIndex !== index));
    };

    const updateCell = (index, key, value) => {
        updateRows(rows.map((row, rowIndex) => (
            rowIndex === index ? { ...row, [key]: value } : row
        )));
    };

    return (
        <div className="tr-root">
            {rows.map((row, index) => (
                <div key={row._id || row.id || `row_${index}`} className="tr-row">
                    <div className="tr-row-header">
                        <span className="he-level-badge">Row {index + 1}</span>
                        <button type="button" className="he-remove-node-btn" onClick={() => removeRow(index)} title="Remove row">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div className="tr-grid">
                        {columns.map((column) => {
                            const value = row[column.key] ?? '';
                            const Field = column.multiline ? AutoSizeTextarea : AutoSizeInput;
                            return (
                                <label key={column.key} className="tr-field">
                                    <span>{column.label}</span>
                                    <Field
                                        className="he-label-input"
                                        type={column.type || 'text'}
                                        minRows={column.multiline ? 2 : undefined}
                                        minChars={column.multiline ? undefined : 14}
                                        value={value}
                                        placeholder={column.placeholder || ''}
                                        onChange={(event) => updateCell(index, column.key, event.target.value)}
                                    />
                                </label>
                            );
                        })}
                    </div>
                </div>
            ))}
            <button type="button" className="he-add-root-btn" onClick={addRow}>
                <span className="he-plus">+</span> Add Row
            </button>
        </div>
    );
}
