import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type FocusEvent,
  type InputHTMLAttributes,
  type MouseEvent,
} from 'react';

const DEFAULT_CLASS =
  'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';

export interface DimensionInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'onChange'
  > {
  value: string;
  onValueChange: (value: string) => void;
  /** Text mode permits formulas such as `=50/2`; numeric mode is the default. */
  allowExpressions?: boolean;
  /**
   * Focus and select this field whenever the command-specific key changes.
   * Use the completed selection (profile, edge, face, and so on) as the key
   * so a modeling command is immediately ready for keyboard replacement.
   */
  autoSelectKey?: string | number | boolean | null;
}

/**
 * Shared controlled field for CAD measurements, counts, coordinates, and
 * angles. Keyboard/programmatic focus selects the complete value so a newly
 * opened command is ready for replacement. The first pointer activation also
 * selects the complete value; a later single click places a precise native
 * caret, while a double-click selects the complete value again.
 */
export const DimensionInput = forwardRef<HTMLInputElement, DimensionInputProps>(
  function DimensionInput(
    {
      value,
      onValueChange,
      allowExpressions = false,
      className,
      inputMode,
      onFocus,
      onClick,
      onDoubleClick,
      onMouseDown,
      onBlur,
      autoSelectKey,
      ...inputProps
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const pointerFocusRef = useRef(false);
    useImperativeHandle(ref, () => inputRef.current!, []);

    useEffect(() => {
      if (
        autoSelectKey === undefined
        || autoSelectKey === null
        || autoSelectKey === false
      ) return;
      const frame = requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input || input.disabled) return;
        input.focus({ preventScroll: true });
        input.select();
      });
      return () => cancelAnimationFrame(frame);
    }, [autoSelectKey]);

    const selectOnFocus = (event: FocusEvent<HTMLInputElement>) => {
      if (!pointerFocusRef.current) event.currentTarget.select();
      onFocus?.(event);
    };
    const selectOnClick = (event: MouseEvent<HTMLInputElement>) => {
      pointerFocusRef.current = false;
      onClick?.(event);
    };
    const selectOnDoubleClick = (event: MouseEvent<HTMLInputElement>) => {
      event.preventDefault();
      event.currentTarget.select();
      onDoubleClick?.(event);
    };
    const handlePointerActivation = (event: MouseEvent<HTMLInputElement>) => {
      const wasFocused = document.activeElement === event.currentTarget;
      // A click inside an already active field should retain the browser's
      // precise native caret placement. The first click that activates a
      // field selects the whole value for immediate replacement.
      pointerFocusRef.current = wasFocused;
      onMouseDown?.(event);
      if (wasFocused || event.defaultPrevented) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.select();
    };
    const resetPointerFocus = (event: FocusEvent<HTMLInputElement>) => {
      pointerFocusRef.current = false;
      onBlur?.(event);
    };

    return (
      <input
        {...inputProps}
        ref={inputRef}
        data-dimension-input
        type={allowExpressions ? 'text' : 'number'}
        inputMode={inputMode ?? (allowExpressions ? 'text' : 'decimal')}
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        onFocus={selectOnFocus}
        onBlur={resetPointerFocus}
        onMouseDown={handlePointerActivation}
        onClick={selectOnClick}
        onDoubleClick={selectOnDoubleClick}
        className={className ?? DEFAULT_CLASS}
      />
    );
  },
);
