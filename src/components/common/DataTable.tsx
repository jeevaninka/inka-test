"use client";

import * as React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ArrowUpDown, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ColumnDef<T> {
  id: string;
  header: React.ReactNode;
  accessor: (row: T, index: number) => React.ReactNode;
  sortValue?: (row: T) => string | number | boolean;
  sortable?: boolean;
  className?: string;
  hideHeaderBelowXl?: boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  getId: (row: T) => string;
  pagination?: {
    pageSize?: number;
  } | false;
  emptyComponent?: React.ReactNode;
  loading?: boolean;
  className?: string;
  tableClassName?: string;
  checkboxCellClassName?: string;
  hideHeader?: boolean;
  rowDraggable?: boolean;
  onRowDragStart?: (e: React.DragEvent, row: T) => void;
  onRowDrop?: (e: React.DragEvent, targetRow: T) => void;
}

export function DataTable<T>({
  data,
  columns,
  onRowClick,
  selectable,
  selectedIds = new Set(),
  onSelectionChange,
  getId,
  pagination,
  emptyComponent,
  loading,
  className,
  tableClassName,
  checkboxCellClassName,
  hideHeader = false,
  rowDraggable,
  onRowDragStart,
  onRowDrop,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('asc');
  const [internalPage, setInternalPage] = React.useState(0);
  const [selectAll, setSelectAll] = React.useState(false);
  const [dragOverRowId, setDragOverRowId] = React.useState<string | null>(null);

  const isPaginationEnabled = pagination !== false;
  const pageSize = pagination && typeof pagination === 'object' ? (pagination.pageSize ?? 10) : 10;
  const pageIndex = internalPage;

  const handleSort = (columnId: string) => {
    if (sortKey === columnId) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(columnId);
      setSortDirection('asc');
    }
  };

  const paginatedData = React.useMemo(() => {
    let processed = [...data];
    if (sortKey) {
      const column = columns.find((c) => c.id === sortKey);
      if (column) {
        processed.sort((a, b) => {
          let aVal: any;
          let bVal: any;
          if (column.sortValue) {
            aVal = column.sortValue(a);
            bVal = column.sortValue(b);
          } else {
            aVal = column.accessor(a, 0);
            bVal = column.accessor(b, 0);
            if (typeof aVal === 'object' && aVal !== null) aVal = '';
            if (typeof bVal === 'object' && bVal !== null) bVal = '';
          }
          if (aVal === bVal) return 0;
          if (aVal === null || aVal === undefined || aVal === '') return 1;
          if (bVal === null || bVal === undefined || bVal === '') return -1;
          const comparison = aVal < bVal ? -1 : 1;
          return sortDirection === 'asc' ? comparison : -comparison;
        });
      }
    }
    if (!isPaginationEnabled) {
      return processed;
    }
    const start = pageIndex * pageSize;
    return processed.slice(start, start + pageSize);
  }, [data, sortKey, sortDirection, pageIndex, pageSize, columns, isPaginationEnabled]);

  const totalPages = isPaginationEnabled ? Math.ceil(data.length / pageSize) : 1;
  const startRow = pageIndex * pageSize + 1;
  const endRow = Math.min((pageIndex + 1) * pageSize, data.length);

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      onSelectionChange?.(new Set(paginatedData.map(getId)));
    } else {
      onSelectionChange?.(new Set());
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    const newSet = new Set(selectedIds);
    if (checked) {
      newSet.add(id);
    } else {
      newSet.delete(id);
    }
    onSelectionChange?.(newSet);
  };

  if (loading) {
    return (
      <div className={cn('rounded-md border', className)}>
        <Table>
          <TableHeader>
            <TableRow>
              {selectable && <TableHead className="w-10" />}
              {columns.map((column) => (
                <TableHead key={column.id} className={column.className}>{column.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: pageSize }).map((_, i) => (
              <TableRow key={i}>
                {selectable && (
                  <TableCell>
                    <div className="h-4 w-4 animate-pulse rounded bg-muted" />
                  </TableCell>
                )}
                {columns.map((column) => (
                  <TableCell key={column.id}>
                    <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (data.length === 0 && emptyComponent) {
    return <div className={className}>{emptyComponent}</div>;
  }

  return (
    <div className={cn('w-full flex-1 min-h-0 flex flex-col', className)}>
      <div className="relative w-full overflow-auto flex-1">
        <Table className={tableClassName}>
          {!hideHeader && (
            <TableHeader>
              <TableRow className="group">
                {selectable && (
                  <TableHead className={cn("w-12", checkboxCellClassName)}>
                    <Checkbox
                      checked={selectAll || (selectedIds.size === paginatedData.length && paginatedData.length > 0)}
                      onCheckedChange={handleSelectAll}
                      className={cn(
                        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
                        (selectAll || selectedIds.size > 0) && "opacity-100"
                      )}
                    />
                  </TableHead>
                )}
                {columns.map((column) => {
                  const isCenter = column.className?.includes('text-center');
                  const isRight = column.className?.includes('text-right');
                  return (
                    <TableHead key={column.id} className={column.className}>
                      {column.sortable ? (
                        <button
                          className={cn(
                            "inline-flex items-center gap-1 uppercase tracking-wider text-[11px] font-semibold hover:text-foreground",
                            isCenter && "justify-center w-full",
                            isRight && "justify-end w-full",
                            column.hideHeaderBelowXl && "hidden xl:inline-flex"
                          )}
                          onClick={() => handleSort(column.id)}
                        >
                          {column.header}
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      ) : column.hideHeaderBelowXl ? (
                        <span className="hidden xl:inline">{column.header}</span>
                      ) : (
                        column.header
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
          )}
          <TableBody>
            {paginatedData.map((row, idx) => {
              const id = getId(row);
              const isSelected = selectedIds.has(id);
              const isDragOver = dragOverRowId === id;
              return (
                <TableRow
                  key={id}
                  className={cn(
                    'group',
                    onRowClick && 'cursor-pointer',
                    rowDraggable && 'cursor-grab active:cursor-grabbing hover:bg-primary/[0.06] dark:hover:bg-white/[0.05] transition-colors',
                    isDragOver && 'bg-primary/10 border-t-2 border-t-primary'
                  )}
                  onClick={() => onRowClick?.(row)}
                  draggable={rowDraggable}
                  onDragStart={(e) => onRowDragStart?.(e, row)}
                  onDragOver={
                    rowDraggable && onRowDrop
                      ? (e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          if (dragOverRowId !== id) setDragOverRowId(id);
                        }
                      : undefined
                  }
                  onDragLeave={
                    rowDraggable && onRowDrop
                      ? () => {
                          if (dragOverRowId === id) setDragOverRowId(null);
                        }
                      : undefined
                  }
                  onDrop={
                    rowDraggable && onRowDrop
                      ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverRowId(null);
                          onRowDrop(e, row);
                        }
                      : undefined
                  }
                  onDragEnd={() => setDragOverRowId(null)}
                  data-state={isSelected ? 'selected' : undefined}
                >
                  {selectable && (
                    <TableCell className={cn("w-12", checkboxCellClassName)} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        {rowDraggable && (
                          <GripVertical
                            className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0 cursor-grab active:cursor-grabbing -ml-1"
                            aria-hidden="true"
                          />
                        )}
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => handleSelectRow(id, checked as boolean)}
                          className={cn(
                            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0",
                            isSelected && "opacity-100"
                          )}
                        />
                      </div>
                    </TableCell>
                  )}
                  {columns.map((column) => (
                    <TableCell key={column.id} className={column.className}>
                      {column.accessor(row, idx)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {isPaginationEnabled && totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-2">
          <span className="text-sm text-muted-foreground">
            Showing {startRow}–{endRow} of {data.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setInternalPage(pageIndex - 1)}
              disabled={pageIndex === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              Page {pageIndex + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setInternalPage(pageIndex + 1)}
              disabled={pageIndex >= totalPages - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}