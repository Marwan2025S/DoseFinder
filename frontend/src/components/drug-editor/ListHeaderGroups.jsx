import { AutoSizeInput, AutoSizeTextarea } from './AutoSizeField';

const normalizeHeaderKey = (value) => String(value ?? '').trim();

export function getListHeaderGroups(entries = []) {
    const groups = [];
    const map = new Map();

    entries.forEach((entry) => {
        const key = normalizeHeaderKey(entry?.list_header);

        if (!map.has(key)) {
            const group = {
                key,
                listHeader: key === '' ? '' : String(entry?.list_header ?? ''),
                entries: [],
            };
            map.set(key, group);
            groups.push(group);
        }

        map.get(key).entries.push(entry);
    });

    return groups;
}

export function ListHeaderGroups({
    addHeaderLabel = 'Add List Header',
    addTextLabel,
    entries = [],
    onAddHeader,
    onAddText,
    onRemoveGroup,
    onRemoveText,
    onUpdateHeader,
    onUpdateText,
    textField,
    textPlaceholder,
}) {
    const groups = getListHeaderGroups(entries);
    const hasBlankGroup = groups.some((group) => group.key === '');

    return (
        <div className="he-list-header-groups">
            {groups.map((group) => (
                <div key={group.key || '__blank_list_header__'} className={`he-header-group${group.key === '' ? ' he-header-group--blank' : ''}`}>
                    <div className="he-header-group-top">
                        <span className="he-header-group-badge">{group.key === '' ? 'No Header' : 'List Header'}</span>
                        <AutoSizeInput
                            type="text"
                            className="he-entry-header-input"
                            value={group.listHeader}
                            onChange={(event) => onUpdateHeader(group.key, event.target.value)}
                            placeholder="List header (optional)"
                            minChars={14}
                        />
                        <button
                            type="button"
                            className="he-remove-node-btn"
                            onClick={() => onRemoveGroup(group.key)}
                            title="Remove list header group"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div className="he-header-group-items">
                        {group.entries.map((entry) => (
                            <div key={entry._id} className="he-item-row he-entry-row">
                                <span className="he-item-bullet">•</span>
                                <AutoSizeTextarea
                                    className="he-item-input"
                                    minRows={1}
                                    value={entry?.[textField] || ''}
                                    onChange={(event) => onUpdateText(entry._id, event.target.value)}
                                    placeholder={textPlaceholder}
                                />
                                <button
                                    type="button"
                                    className="he-item-remove"
                                    onClick={() => onRemoveText(entry._id)}
                                    title="Remove text"
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <path d="M18 6 6 18M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="he-add-bar">
                        <button type="button" className="he-add-child-btn he-add-item-btn" onClick={() => onAddText(group.listHeader)}>
                            <span className="he-plus">+</span> {addTextLabel}
                        </button>
                    </div>
                </div>
            ))}

            {!hasBlankGroup && (
                <div className="he-add-bar">
                    <button type="button" className="he-add-child-btn" onClick={onAddHeader}>
                        <span className="he-plus">+</span> {addHeaderLabel}
                    </button>
                </div>
            )}
        </div>
    );
}

export { normalizeHeaderKey };
