import { useState } from 'react';
import { AutoSizeInput, AutoSizeTextarea } from './AutoSizeField';

/**
 * HierarchyEditor – Reusable tree editor for tables with:
 *   topic → sub_topic → list_header → text
 *
 * Props:
 *   data       – array of topic nodes (see shape below)
 *   onChange   – (newData) => void
 *   levels     – config per level, e.g.
 *                [{ key:'topic', label:'Topic', placeholder:'e.g. Storage' },
 *                 { key:'sub_topic', label:'Sub-Topic', placeholder:'' },
 *                 { key:'list_header', label:'List Header', placeholder:'' }]
 *                The final leaf level is always "text" items (array of strings).
 *   maxDepth   – optional, limits how many sub-levels are available (default = levels.length)
 *
 * Data shape  (3-level example):
 * [
 *   { topic: "storage", children: [
 *       { sub_topic: "", children: [
 *           { list_header: "", items: ["Store at 20-25°C", "Protect from light"] }
 *       ]}
 *   ]}
 * ]
 *
 * For simple 1-level tables (topic + text only), pass levels=[{key:'topic',...}]
 * and the data is: [{ topic: "general", items: ["text1","text2"] }]
 */

const uid = (() => { let c = 0; return () => `he_${++c}_${Date.now()}`; })();

export default function HierarchyEditor({ data = [], onChange, levels = [], maxDepth }) {
    const depth = maxDepth ?? levels.length;

    const update = (newData) => onChange(newData);

    /* ── Level 0: topics ── */
    const addTopic = () => {
        const cfg = levels[0];
        if (depth === 0) {
            // items-only mode (shouldn't happen but safety)
            return;
        }
        const node = { [cfg.key]: '', _id: uid() };
        if (depth > 1) node.children = [];
        else node.items = [''];
        update([...data, node]);
    };

    const removeTopic = (index) => {
        update(data.filter((_, i) => i !== index));
    };

    const updateTopicLabel = (index, value) => {
        const next = [...data];
        next[index] = { ...next[index], [levels[0].key]: value };
        update(next);
    };

    /* ── Generic child operations ── */
    const addChild = (path) => {
        const next = JSON.parse(JSON.stringify(data));
        let node = next;
        for (const idx of path) node = node[idx].children;

        const level = path.length; // 0-indexed parent depth → child is level+1
        const cfg = levels[level + 1]; // +1 because path.length=1 means we're inside a level-0 node

        // Wait, let me re-think. path gives the chain of indices to reach the parent.
        // path.length tells us how deep the parent is (0 = root array, 1 = inside a topic, etc.)
        // The parent is at depth = path.length (since path[0] goes into depth-0 nodes).
        // So the child will be at depth = path.length.
        // But path.length=0 shouldn't happen here – that would be addTopic.
        // Actually let me reconsider. parent chain: data[path[0]].children[path[1]].children ...
        // The final .children is where we push. The child's depth = path.length.

        const childDepth = path.length;
        if (childDepth >= depth) return; // shouldn't happen

        const childCfg = levels[childDepth];
        const child = { [childCfg.key]: '', _id: uid() };
        if (childDepth + 1 < depth) child.children = [];
        else child.items = [''];
        node.push(child);
        update(next);
    };

    const removeChild = (path) => {
        const next = JSON.parse(JSON.stringify(data));
        const parentPath = path.slice(0, -1);
        const childIndex = path[path.length - 1];
        let arr = next;
        for (const idx of parentPath) {
            if (parentPath.length === 0) break;
            arr = arr[idx].children;
        }
        // If parentPath is empty, arr = next (root array)
        if (parentPath.length === 0) {
            arr.splice(childIndex, 1);
        } else {
            let node = next;
            for (let i = 0; i < parentPath.length - 1; i++) node = node[parentPath[i]].children;
            node[parentPath[parentPath.length - 1]].children.splice(childIndex, 1);
        }
        update(next);
    };

    const updateChildLabel = (path, value) => {
        const next = JSON.parse(JSON.stringify(data));
        let node = next;
        for (let i = 0; i < path.length - 1; i++) node = node[path[i]].children;
        const childDepth = path.length - 1;
        const cfg = levels[childDepth];
        node[path[path.length - 1]][cfg.key] = value;
        update(next);
    };

    /* ── Item operations ── */
    const addItem = (path) => {
        const next = JSON.parse(JSON.stringify(data));
        let node = next;
        for (let i = 0; i < path.length - 1; i++) node = node[path[i]].children;
        const target = node[path[path.length - 1]];
        if (!target.items) target.items = [];
        target.items.push('');
        update(next);
    };

    const removeItem = (path, itemIndex) => {
        const next = JSON.parse(JSON.stringify(data));
        let node = next;
        for (let i = 0; i < path.length - 1; i++) node = node[path[i]].children;
        node[path[path.length - 1]].items.splice(itemIndex, 1);
        update(next);
    };

    const updateItem = (path, itemIndex, value) => {
        const next = JSON.parse(JSON.stringify(data));
        let node = next;
        for (let i = 0; i < path.length - 1; i++) node = node[path[i]].children;
        node[path[path.length - 1]].items[itemIndex] = value;
        update(next);
    };

    return (
        <div className="he-root">
            {data.map((topicNode, topicIdx) => (
                <TreeNode
                    key={topicNode._id || `t_${topicIdx}`}
                    node={topicNode}
                    path={[topicIdx]}
                    depthLevel={0}
                    levels={levels}
                    maxDepth={depth}
                    onUpdateLabel={updateChildLabel}
                    onRemove={removeChild}
                    onAddChild={addChild}
                    onAddItem={addItem}
                    onRemoveItem={removeItem}
                    onUpdateItem={updateItem}
                />
            ))}
            <button type="button" className="he-add-root-btn" onClick={addTopic}>
                <span className="he-plus">+</span> Add {levels[0]?.label || 'Topic'}
            </button>
        </div>
    );
}

function TreeNode({ node, path, depthLevel, levels, maxDepth, onUpdateLabel, onRemove, onAddChild, onAddItem, onRemoveItem, onUpdateItem }) {
    const [collapsed, setCollapsed] = useState(false);
    const cfg = levels[depthLevel];
    const label = node[cfg.key] || '';
    const hasChildren = depthLevel + 1 < maxDepth && Array.isArray(node.children);
    const hasItems = Array.isArray(node.items);
    const childCfg = depthLevel + 1 < maxDepth ? levels[depthLevel + 1] : null;
    const isLeafParent = depthLevel + 1 >= maxDepth; // this node holds items directly

    return (
        <div className={`he-node he-depth-${depthLevel}`}>
            <div className="he-node-header">
                <button type="button" className="he-collapse-btn" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand' : 'Collapse'}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </button>
                <span className="he-level-badge">{cfg.label}</span>
                <AutoSizeInput
                    type="text"
                    className="he-label-input"
                    value={label}
                    placeholder={cfg.placeholder || `Enter ${cfg.label.toLowerCase()}...`}
                    minChars={12}
                    onChange={(e) => onUpdateLabel(path, e.target.value)}
                />
                <button type="button" className="he-remove-node-btn" onClick={() => onRemove(path)} title={`Remove ${cfg.label}`}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {!collapsed && (
                <div className="he-node-body">
                    {/* Children (sub-levels) */}
                    {hasChildren && node.children.map((child, childIdx) => (
                        <TreeNode
                            key={child._id || `c_${childIdx}`}
                            node={child}
                            path={[...path, childIdx]}
                            depthLevel={depthLevel + 1}
                            levels={levels}
                            maxDepth={maxDepth}
                            onUpdateLabel={onUpdateLabel}
                            onRemove={onRemove}
                            onAddChild={onAddChild}
                            onAddItem={onAddItem}
                            onRemoveItem={onRemoveItem}
                            onUpdateItem={onUpdateItem}
                        />
                    ))}

                    {/* Items (leaf text entries) */}
                    {hasItems && node.items.map((item, itemIdx) => (
                        <div key={`item_${itemIdx}`} className="he-item-row">
                            <span className="he-item-bullet">•</span>
                            <AutoSizeTextarea
                                className="he-item-input"
                                minRows={1}
                                value={item}
                                placeholder="Enter text..."
                                onChange={(e) => onUpdateItem(path, itemIdx, e.target.value)}
                            />
                            <button type="button" className="he-item-remove" onClick={() => onRemoveItem(path, itemIdx)} title="Remove item">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M18 6 6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    ))}

                    {/* Add buttons */}
                    <div className="he-add-bar">
                        {hasChildren && childCfg && (
                            <button type="button" className="he-add-child-btn" onClick={() => onAddChild(path)}>
                                <span className="he-plus">+</span> {childCfg.label}
                            </button>
                        )}
                        {(hasItems || isLeafParent) && (
                            <button type="button" className="he-add-child-btn he-add-item-btn" onClick={() => onAddItem(path)}>
                                <span className="he-plus">+</span> Text Entry
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
