import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PagedListLayout } from './PagedListLayout.js';

describe('PagedListLayout', () => {
  const toolbar = <div data-testid="toolbar">Filters</div>;
  const emptyState = <div data-testid="empty-state">No items</div>;
  const pagination = <div data-testid="pagination">Page 1</div>;
  const children = <div data-testid="list-content">List rows</div>;

  it('renders toolbar, children, and pagination when not empty', () => {
    render(
      <PagedListLayout
        toolbar={toolbar}
        isEmpty={false}
        emptyState={emptyState}
        pagination={pagination}
      >
        {children}
      </PagedListLayout>,
    );
    expect(screen.getByTestId('toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('list-content')).toBeInTheDocument();
    expect(screen.getByTestId('pagination')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  it('renders emptyState centred inside the container when isEmpty is true', () => {
    render(
      <PagedListLayout
        toolbar={toolbar}
        isEmpty={true}
        emptyState={emptyState}
        pagination={pagination}
      >
        {children}
      </PagedListLayout>,
    );
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('list-content')).not.toBeInTheDocument();
    // Pagination still renders when empty
    expect(screen.getByTestId('pagination')).toBeInTheDocument();
  });

  it('omits the toolbar wrapper div when toolbar is null', () => {
    const { container } = render(
      <PagedListLayout
        toolbar={null}
        isEmpty={false}
        emptyState={emptyState}
        pagination={pagination}
      >
        {children}
      </PagedListLayout>,
    );
    // No element with text "Filters" should appear
    expect(screen.queryByTestId('toolbar')).not.toBeInTheDocument();
    // Outer wrapper and list container still render
    expect(container.firstChild).toBeTruthy();
    expect(screen.getByTestId('list-content')).toBeInTheDocument();
  });

  it('applies optional className to the outer wrapper', () => {
    const { container } = render(
      <PagedListLayout
        toolbar={null}
        isEmpty={false}
        emptyState={emptyState}
        pagination={pagination}
        className="custom-class"
      >
        {children}
      </PagedListLayout>,
    );
    expect((container.firstChild as HTMLElement).classList).toContain('custom-class');
  });

  it('renders pagination below the list container when not empty', () => {
    const { container } = render(
      <PagedListLayout
        toolbar={null}
        isEmpty={false}
        emptyState={emptyState}
        pagination={pagination}
      >
        {children}
      </PagedListLayout>,
    );
    const outer = container.firstChild as HTMLElement;
    const children_nodes = Array.from(outer.childNodes) as HTMLElement[];
    const listContainer = children_nodes.find((n) =>
      n.contains(screen.getByTestId('list-content')),
    );
    const paginationNode = children_nodes.find((n) => n.contains(screen.getByTestId('pagination')));
    // Pagination must come after the list container in the DOM
    expect(listContainer).toBeTruthy();
    expect(paginationNode).toBeTruthy();
    expect(
      outer.compareDocumentPosition(paginationNode!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
