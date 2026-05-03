import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ColumnFilterRow } from './ColumnFilterRow.js';
import type { ColumnDef, FilterDef } from '@shared/store-meta.js';

const cols: ColumnDef[] = [
  { key: 'id',     label: 'ID',     type: 'string', noFilter: true },
  { key: 'name',   label: 'Name',   type: 'string' },
  { key: 'status', label: 'Status', type: 'enum',   enumOptions: ['open', 'closed'] },
  { key: 'count',  label: 'Count',  type: 'number' },
  { key: 'when',   label: 'When',   type: 'timestamp' },
];

const filters: FilterDef[] = [
  { key: 'name', type: 'string' },
  { key: 'count', type: 'number-range' },
  { key: 'when', type: 'date-range' },
  // status enum — exempt; enumOptions directly on ColumnDef is enough
];

function renderRow(props: Partial<React.ComponentProps<typeof ColumnFilterRow>> = {}) {
  // Wrap in <table><thead> so the <tr> is valid HTML
  return render(
    <table><thead>
      <ColumnFilterRow columns={cols} filters={filters}
        value={{}} onChange={() => {}} onApplyRange={() => {}} {...props} />
    </thead></table>
  );
}

describe('ColumnFilterRow', () => {
  it('renders one cell per column, empty for noFilter', () => {
    const { container } = renderRow();
    const cells = container.querySelectorAll('td');
    expect(cells).toHaveLength(5);
    // The noFilter cell should be empty (no input)
    expect(cells[0].querySelector('input, select, button')).toBeNull();
  });

  it('fires onChange immediately for enum select', () => {
    const onChange = vi.fn();
    const { getByDisplayValue } = renderRow({ onChange });
    const select = getByDisplayValue('all') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'open' } });
    expect(onChange).toHaveBeenCalledWith({ status: 'open' });
  });

  it('fires onChange immediately for text input (parent handles debounce)', () => {
    const onChange = vi.fn();
    const { getByPlaceholderText } = renderRow({ onChange });
    const input = getByPlaceholderText('filter name…');
    fireEvent.change(input, { target: { value: 'foo' } });
    expect(onChange).toHaveBeenCalledWith({ name: 'foo' });
  });

  it('does NOT fire onApplyRange while typing into date inputs', () => {
    const onApplyRange = vi.fn();
    const { container } = renderRow({ onApplyRange });
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-01-01' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-01-31' } });
    expect(onApplyRange).not.toHaveBeenCalled();
  });

  it('fires onApplyRange when Apply is clicked for date range', () => {
    const onApplyRange = vi.fn();
    const { container, getAllByText } = renderRow({ onApplyRange });
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-01-01' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-01-31' } });
    // Two Apply buttons exist (one per range column); click the date one
    const dateApply = getAllByText('Apply').find((el) => {
      const cell = el.closest('td');
      return cell?.querySelector('input[type="date"]') !== null;
    });
    fireEvent.click(dateApply!);
    const fromEpoch = new Date('2026-01-01T00:00:00').getTime();
    const toEpoch   = new Date('2026-01-31T23:59:59.999').getTime();
    expect(onApplyRange).toHaveBeenCalledWith('when', [String(fromEpoch), String(toEpoch)]);
  });

  it('does not render filter input for columns without a matching FilterDef', () => {
    const colsLocal: ColumnDef[] = [
      { key: 'free', label: 'Free', type: 'string' }, // no filter def
    ];
    const { container } = render(
      <table><thead>
        <ColumnFilterRow columns={colsLocal} filters={[]} value={{}}
          onChange={() => {}} onApplyRange={() => {}} />
      </thead></table>
    );
    const cells = container.querySelectorAll('td');
    expect(cells).toHaveLength(1);
    expect(cells[0].querySelector('input, select')).toBeNull();
  });

  it('uses open-ended bounds when only one date input is filled', () => {
    const onApplyRange = vi.fn();
    const { container, getAllByText } = renderRow({ onApplyRange });
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-01-01' } });
    // leave 'to' empty
    const dateApply = getAllByText('Apply').find((el) => {
      const cell = el.closest('td');
      return cell?.querySelector('input[type="date"]') !== null;
    });
    fireEvent.click(dateApply!);
    const fromEpoch = new Date('2026-01-01T00:00:00').getTime();
    expect(onApplyRange).toHaveBeenCalledWith('when', [String(fromEpoch), '8640000000000000']);
  });

  it('uses open-ended bounds when only one number input is filled', () => {
    const onApplyRange = vi.fn();
    const { container, getAllByText } = renderRow({ onApplyRange });
    const numInputs = container.querySelectorAll('input[type="number"]');
    fireEvent.change(numInputs[0], { target: { value: '5' } });
    // leave 'to' empty
    const numApply = getAllByText('Apply').find((el) => {
      const cell = el.closest('td');
      return cell?.querySelector('input[type="number"]') !== null;
    });
    fireEvent.click(numApply!);
    expect(onApplyRange).toHaveBeenCalledWith('count', ['5', String(Number.MAX_SAFE_INTEGER)]);
  });

  it('fires onApplyRange with null when both number range inputs are cleared', () => {
    const onApplyRange = vi.fn();
    const { container, getAllByText } = renderRow({
      value: { count: ['5', '10'] },
      onApplyRange,
    });
    const numInputs = container.querySelectorAll('input[type="number"]');
    fireEvent.change(numInputs[0], { target: { value: '' } });
    fireEvent.change(numInputs[1], { target: { value: '' } });
    const numApply = getAllByText('Apply').find((el) => {
      const cell = el.closest('td');
      return cell?.querySelector('input[type="number"]') !== null;
    });
    fireEvent.click(numApply!);
    expect(onApplyRange).toHaveBeenCalledWith('count', null);
  });
});
