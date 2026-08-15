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
 * angles. Keyboard focus and mouse clicks select the complete value so the
 * next typed character replaces it.
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
      onMouseDown,
      autoSelectKey,
      ...inputProps
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
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
      event.currentTarget.select();
      onFocus?.(event);
    };
    const selectOnClick = (event: MouseEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      input.select();
      // Text inputs can restore the pointer caret as the click's default
      // action completes. Reapply at the microtask boundary so formula and
      // numeric modes share the same replacement behavior.
      queueMicrotask(() => {
        if (document.activeElement === input) input.select();
      });
      onClick?.(event);
    };
    const preserveTextSelection = (event: MouseEvent<HTMLInputElement>) => {
      if (allowExpressions) {
        // Prevent the text input's pointer-default caret placement. Numeric
        // inputs keep their native spinner behavior and do not need this.
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.select();
      }
      onMouseDown?.(event);
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
        onMouseDown={preserveTextSelection}
        onClick={selectOnClick}
        className={className ?? DEFAULT_CLASS}
      />
    );
  },
);
