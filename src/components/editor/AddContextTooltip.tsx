'use client';

import { createPortal } from 'react-dom';

interface AddContextTooltipProps {
  selectionRect: DOMRect;
  onAddContext: () => void;
  onDismiss: () => void;
}

const TOOLTIP_HEIGHT = 30;
const GAP = 8;
const VIEWPORT_MARGIN = 8;

export function AddContextTooltip({ selectionRect, onAddContext, onDismiss }: AddContextTooltipProps) {
  const top = selectionRect.top - GAP - TOOLTIP_HEIGHT;

  // Don't render if not enough space above
  if (top < VIEWPORT_MARGIN) return null;

  const left = Math.max(
    VIEWPORT_MARGIN,
    selectionRect.left + selectionRect.width / 2 - 55,
  );

  return createPortal(
    <button
      type="button"
      className="add-context-tooltip"
      style={{ position: 'fixed', top, left, zIndex: 10000 }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onAddContext();
        onDismiss();
      }}
    >
      + Add Context
    </button>,
    document.body,
  );
}
