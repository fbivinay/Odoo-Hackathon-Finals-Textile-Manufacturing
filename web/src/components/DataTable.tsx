import { Inbox } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { useState, type ReactNode } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props<T> {
  columns: ColumnDef<T, any>[]
  data: T[]
  loading?: boolean
  skeletonRows?: number
  empty?: ReactNode
  onRowClick?: (row: T) => void
  initialSorting?: SortingState
}

export function DataTable<T>({
  columns,
  data,
  loading = false,
  skeletonRows = 6,
  empty,
  onRowClick,
  initialSorting = [],
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  // Columns may fix their share of the width with `meta: { width: '25%' }`, so tables stacked on
  // one page line up. Without any, the browser sizes columns to their content as before.
  const widthOf = (def: ColumnDef<T, any>) => (def.meta as { width?: string } | undefined)?.width
  const fixed = columns.some(widthOf)

  // An empty table never shows bare headers: a short line says why there is nothing.
  if (!loading && data.length === 0) {
    return (
      <div className="data-table-wrap">
        {empty === undefined || typeof empty === 'string' ? <EmptyState icon={Inbox} line={empty ?? 'Nothing to show yet.'} /> : empty}
      </div>
    )
  }

  return (
    <div className="data-table-wrap">
      <table className={cn('data-table', fixed && 'table-fixed')}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const sortable = header.column.getCanSort()
                const dir = header.column.getIsSorted()
                return (
                  <th key={header.id} style={{ width: widthOf(header.column.columnDef) }} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}>
                    {header.isPlaceholder ? null : sortable ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-ink"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {dir === 'asc' ? (
                          <ArrowUp className="size-3" />
                        ) : dir === 'desc' ? (
                          <ArrowDown className="size-3" />
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={i}>
                  {columns.map((_c, j) => (
                    <td key={j}>
                      <div className="skel h-3.5 w-full max-w-[140px]" />
                    </td>
                  ))}
                </tr>
              ))
            : table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(onRowClick && 'cursor-pointer')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  )
}
