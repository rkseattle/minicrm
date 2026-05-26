import type React from 'react';

interface PagedListLayoutProps {
  /** Toolbar row: search inputs, filter controls, action buttons. */
  toolbar: React.ReactNode;
  /** When true, renders emptyState instead of children. */
  isEmpty: boolean;
  /** Rendered centred inside the full-height container when isEmpty is true. */
  emptyState: React.ReactNode;
  /** Always rendered below the list container. */
  pagination: React.ReactNode;
  /** The table or card list rendered when isEmpty is false. */
  children: React.ReactNode;
  /** Optional className applied to the outer wrapper. */
  className?: string;
}

export function PagedListLayout({
  toolbar,
  isEmpty,
  emptyState,
  pagination,
  children,
  className,
}: PagedListLayoutProps) {
  const outerClass = ['flex flex-col flex-1 min-h-0 gap-4', className].filter(Boolean).join(' ');

  return (
    <div className={outerClass}>
      {/* Toolbar row — omitted when null so gap-4 does not add dead space */}
      {toolbar != null && <div>{toolbar}</div>}

      {/* List container: fills all remaining vertical space */}
      <div className="flex-1 min-h-0 overflow-auto border border-gray-200 rounded-lg bg-white">
        {isEmpty ? (
          <div className="flex items-center justify-center h-full">{emptyState}</div>
        ) : (
          children
        )}
      </div>

      {/* Pagination: always at the bottom, never floats */}
      {pagination}
    </div>
  );
}
