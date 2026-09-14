import { useLayoutEffect, useRef } from 'react';

const toText = (value) => String(value ?? '');

const getAutoWidth = (value, placeholder, minChars) => {
    const content = toText(value) || toText(placeholder);
    const chars = Math.max(minChars, content.length + 1);
    return `min(100%, ${chars}ch)`;
};

const getAutoTextareaWidth = (value, placeholder, minChars) => {
    const content = toText(value) || toText(placeholder);
    const longestLine = content
        .split(/\r?\n/)
        .reduce((max, line) => Math.max(max, line.length), 0);
    const chars = Math.max(minChars, longestLine + 1);
    return `min(100%, ${chars}ch)`;
};

const resizeTextarea = (element, minRows) => {
    if (!element || typeof window === 'undefined') return;

    const styles = window.getComputedStyle(element);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const padding =
        (Number.parseFloat(styles.paddingTop) || 0)
        + (Number.parseFloat(styles.paddingBottom) || 0);
    const border =
        (Number.parseFloat(styles.borderTopWidth) || 0)
        + (Number.parseFloat(styles.borderBottomWidth) || 0);
    const minHeight = (lineHeight * minRows) + padding + border;

    element.style.height = '0px';
    element.style.height = `${Math.max(element.scrollHeight, minHeight)}px`;
};

export function AutoSizeInput({
    minChars = 10,
    placeholder = '',
    style,
    value = '',
    ...props
}) {
    return (
        <input
            {...props}
            value={value ?? ''}
            placeholder={placeholder}
            data-autosize-input="true"
            style={{ ...style, width: getAutoWidth(value, placeholder, minChars) }}
        />
    );
}

export function AutoSizeTextarea({
    minChars = 18,
    minRows = 1,
    onInput,
    style,
    value = '',
    ...props
}) {
    const textareaRef = useRef(null);

    useLayoutEffect(() => {
        resizeTextarea(textareaRef.current, minRows);
    }, [minRows, value]);

    const handleInput = (event) => {
        resizeTextarea(event.currentTarget, minRows);
        onInput?.(event);
    };

    return (
        <textarea
            {...props}
            ref={textareaRef}
            rows={minRows}
            value={value ?? ''}
            data-autosize-textarea="true"
            onInput={handleInput}
            style={{ ...style, width: getAutoTextareaWidth(value, props.placeholder, minChars) }}
        />
    );
}
