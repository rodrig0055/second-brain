"use client";

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { Columns3, Download, Search } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { MultiSelector } from "@astryxdesign/core/MultiSelector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  Table,
  paginateData,
  pixel,
  proportional,
  useTableColumnResize,
  useTableColumnSettings,
  useTableColumnSettingsState,
  useTablePagination,
  useTableSortable,
  useTableStickyColumns,
  type TableColumn,
  type TablePlugin,
} from "@astryxdesign/core/Table";
import { csvFilename, toCsv } from "@/lib/csv";

/**
 * The table every surface uses to look at a list of things.
 *
 * Sort, search, choose and resize your columns, page through, take it away as
 * CSV, click a row to open it. Astryx Table does the rendering and the header,
 * resize, sticky-column and paging behaviour; this component owns what the
 * callers share: the column model, nulls-last sorting, search, the saved column
 * set and the CSV.
 */

export type DataTableColumn<Row> = {
  key: string;
  label: string;
  /** Raw value: what sorting, searching and the CSV read. null means no data. */
  value: (row: Row) => string | number | null;
  /** Display text for a value. Also what the CSV writes. */
  format?: (value: string | number, row: Row) => string;
  /** Rich cell. Falls back to `format(value)`. */
  render?: (row: Row) => ReactNode;
  align?: "left" | "right";
  numeric?: boolean;
  sortable?: boolean;
  searchable?: boolean;
  defaultVisible?: boolean;
  /** Cannot be hidden: the column that says which row you are looking at. */
  lockVisible?: boolean;
  /** Pinned to the start edge while the rest scroll sideways. */
  sticky?: boolean;
  /** Fixed width in px. Omitted, the column shares the space with a sensible floor. */
  width?: number;
  /** Long free text (a caption, a message): takes the lion's share of spare width. */
  wide?: boolean;
  /** Cost-like column: down is the good direction. Carried for callers that colour on it. */
  lowerIsBetter?: boolean;
};

export type DataTableProps<Row> = {
  /** Persistence key for the column picker. */
  id: string;
  /** What the table lists ("Social posts"). Names its pager, which must be unique on the page. */
  label?: string;
  rows: Row[];
  columns: DataTableColumn<Row>[];
  rowKey: (row: Row) => string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  search?: boolean | { placeholder?: string };
  onRowClick?: (row: Row) => void;
  /** The row open in a side panel, marked as current. */
  activeKey?: string | null;
  csv?: { filename: string } | false;
  toolbar?: ReactNode;
  emptyLabel?: string;
  nullLabel?: string;
  footnote?: ReactNode;
  /** Rows per page; the pager shows only when there is more than one page. false = never page. */
  pageSize?: number | false;
  /** One-time import of a pre-existing localStorage key. */
  legacyStorageKey?: string;
};

/** Astryx Table rows must be records; each wraps one caller row. */
type Item<Row> = { key: string; row: Row } & Record<string, unknown>;

type SortState = Array<{ sortKey: string; direction: "ascending" | "descending" }>;

const PAGE_SIZES = [25, 50, 100];

const styles = stylex.create({
  clickable: { cursor: "pointer" },
});

/**
 * Mounted tables per label, in mount order. A pager is a navigation landmark,
 * and two landmarks with one name are indistinguishable (axe landmark-unique):
 * a chat can show the same tool's table several times.
 */
const mountedLabels = new Map<string, string[]>();

/** `label`, or `label 2`, `label 3`... when other tables on the page already use it. */
function useUniqueLabel(label: string): string {
  const uid = useId();
  const [ordinal, setOrdinal] = useState(0);
  useEffect(() => {
    const list = mountedLabels.get(label) ?? [];
    list.push(uid);
    mountedLabels.set(label, list);
    queueMicrotask(() => setOrdinal(list.indexOf(uid)));
    return () => {
      const current = mountedLabels.get(label) ?? [];
      const rest = current.filter((u) => u !== uid);
      if (rest.length) mountedLabels.set(label, rest);
      else mountedLabels.delete(label);
    };
  }, [label, uid]);
  return ordinal > 0 ? `${label} ${ordinal + 1}` : label;
}

function storageKey(id: string): string {
  return `data-table.${id}`;
}

function readSaved(id: string, legacy?: string): string[] | null {
  try {
    const raw =
      window.localStorage.getItem(storageKey(id)) ??
      (legacy ? window.localStorage.getItem(legacy) : null);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string")) return parsed;
  } catch {
    // Private windows and blocked site data both throw here. A table that
    // cannot remember your columns still has to render.
  }
  return null;
}

const isRight = <Row,>(col: DataTableColumn<Row>) =>
  col.align === "right" || (col.align !== "left" && Boolean(col.numeric));

export function DataTable<Row>({
  id,
  label = "Table",
  rows,
  columns,
  rowKey,
  defaultSort,
  search = true,
  onRowClick,
  activeKey,
  csv,
  toolbar,
  emptyLabel = "Nothing in this window.",
  nullLabel = "—",
  footnote,
  pageSize: initialPageSize = 50,
  legacyStorageKey,
}: DataTableProps<Row>) {
  const name = useUniqueLabel(label);
  const defaultVisible = useMemo(
    () => columns.filter((c) => c.defaultVisible !== false).map((c) => c.key),
    [columns],
  );
  const [visible, setVisible] = useState<string[]>(defaultVisible);
  const [sort, setSort] = useState<SortState>(
    defaultSort
      ? [{ sortKey: defaultSort.key, direction: defaultSort.dir === "asc" ? "ascending" : "descending" }]
      : [],
  );
  const [query, setQuery] = useState("");
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize || 0);

  // Restore the saved columns after mount. queueMicrotask keeps the state
  // update out of the effect body, which the React Compiler lint forbids; the
  // server and the first client render therefore agree on the defaults.
  useEffect(() => {
    queueMicrotask(() => {
      const saved = readSaved(id, legacyStorageKey);
      if (saved?.length) setVisible(saved);
    });
  }, [id, legacyStorageKey]);

  const persist = useCallback(
    (next: string[]) => {
      setVisible(next);
      try {
        window.localStorage.setItem(storageKey(id), JSON.stringify(next));
      } catch {
        // Not being able to remember is not a reason to fail the click.
      }
    },
    [id],
  );

  // Locked columns are always on, and the order is always the declared one.
  const activeKeys = useMemo(
    () => columns.filter((c) => c.lockVisible || visible.includes(c.key)).map((c) => c.key),
    [columns, visible],
  );

  const searchable = useMemo(
    () => columns.filter((c) => c.searchable ?? typeof c.value === "function"),
    [columns],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      searchable.some((col) => {
        const v = col.value(row);
        return v !== null && String(v).toLowerCase().includes(q);
      }),
    );
  }, [rows, query, searchable]);

  const sorted = useMemo(() => {
    const current = sort[0];
    const col = current && columns.find((c) => c.key === current.sortKey);
    if (!col) return filtered;
    const dir = current.direction === "ascending" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      // Nulls sort last in both directions: "no data" is not a small number,
      // and a column of dashes at the top tells you nothing.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sort, columns]);

  // A new search, sort or page size starts again from the first page. Reset
  // during render when the inputs change, not in an effect.
  const pageKey = `${query}|${JSON.stringify(sort)}|${pageSize}|${rows.length}`;
  const [seenPageKey, setSeenPageKey] = useState(pageKey);
  if (pageKey !== seenPageKey) {
    setSeenPageKey(pageKey);
    setPage(1);
  }

  const isPaged = pageSize > 0 && sorted.length > pageSize;
  const pageRows = isPaged ? paginateData(sorted, page, pageSize) : sorted;

  const items = useMemo<Item<Row>[]>(
    () => pageRows.map((row) => ({ key: rowKey(row), row })),
    [pageRows, rowKey],
  );

  function cellText(col: DataTableColumn<Row>, row: Row): string {
    const v = col.value(row);
    if (v === null || v === undefined) return "";
    return col.format ? col.format(v, row) : String(v);
  }

  const tableColumns = useMemo<TableColumn<Item<Row>>[]>(
    () =>
      columns.map((col) => ({
        key: col.key,
        header: col.label,
        align: isRight(col) ? "end" : "start",
        // Only a sortable, titled column gets a sort control: an empty header
        // would make a button with no name.
        sortable: col.sortable !== false && Boolean(col.label),
        // Floors, not shares: past them the table scrolls sideways (with the
        // sticky column held) instead of squeezing names and wrapping numbers.
        width: col.width
          ? pixel(col.width)
          : col.wide
            ? proportional(4, { minWidth: 240 })
            : col.lockVisible || col.sticky
              ? proportional(3, { minWidth: 240 })
              : col.numeric
                ? proportional(1, { minWidth: 104 })
                : proportional(1, { minWidth: 120 }),
        renderCell: ({ row }: Item<Row>) => {
          const raw = col.value(row);
          const content = col.render ? (
            col.render(row)
          ) : raw === null ? (
            <Text type="inherit" color="disabled">
              {nullLabel}
            </Text>
          ) : (
            cellText(col, row)
          );
          // A number reads as one token: "402.98 USD" never breaks across lines.
          return isRight(col) || col.numeric ? (
            <Text type="inherit" className="whitespace-nowrap tabular-nums">
              {content}
            </Text>
          ) : (
            content
          );
        },
      })),
    // cellText reads only col and row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, nullLabel],
  );

  // The sort cycle is ours: the same column flips direction (never back to
  // unsorted, which Astryx would emit after descending), and a new column opens
  // on its biggest values when it is a number, A to Z otherwise. Functional
  // update, because the plugin may hold an older copy of this callback.
  const onSortChange = useCallback(
    (next: SortState) => {
      setSort((prev) => {
        const current = prev[0];
        const key = next[0]?.sortKey ?? current?.sortKey;
        if (!key) return next;
        if (key === current?.sortKey) {
          return [{ sortKey: key, direction: current.direction === "descending" ? "ascending" : "descending" }];
        }
        const col = columns.find((c) => c.key === key);
        return [{ sortKey: key, direction: col?.numeric ? "descending" : "ascending" }];
      });
    },
    [columns],
  );

  const sortPlugin = useTableSortable<Item<Row>>({ sort, onSortChange });

  const settings = useTableColumnSettingsState({
    columns: columns.map((c) => ({
      key: c.key,
      label: c.label || c.key,
      isAlwaysVisible: c.lockVisible === true,
    })),
    activeColumnKeys: activeKeys,
    onChangeActiveColumnKeys: (keys) => persist([...keys]),
    defaultColumnKeys: defaultVisible,
  });
  const settingsPlugin = useTableColumnSettings<Item<Row>>(settings.columnSettingsConfig);

  const resizePlugin = useTableColumnResize<Item<Row>>({
    columnWidths: widths,
    onColumnResizeEnd: (updates) => setWidths((prev) => ({ ...prev, ...updates })),
    // The resize config is typed for plain records; the columns are ours.
    columns: tableColumns as unknown as TableColumn<Record<string, unknown>>[],
  });

  const stickyKeys = useMemo(() => columns.filter((c) => c.sticky).map((c) => c.key), [columns]);
  const stickyPlugin = useTableStickyColumns<Item<Row>>({ startKeys: stickyKeys });

  const pagePlugin = useTablePagination<Item<Row>>({
    page,
    onPageChange: setPage,
    totalItems: sorted.length,
    pageSize: pageSize || sorted.length || 1,
    onPageSizeChange: setPageSize,
    pageSizeOptions: PAGE_SIZES,
    variant: "count",
    align: "end",
    label: `${name} pages`,
  });

  /**
   * Opens the clicked row. Astryx has no first-class row activation, so this
   * reaches the <tr> through transformBodyRow, the way its table-filter
   * template does: a click anywhere but on a control inside the row, or Enter
   * and Space while the row itself has focus.
   */
  const rowPlugin = useMemo<TablePlugin<Item<Row>>>(
    () => ({
      transformBodyRow: (props, item) => {
        if (!onRowClick) return props;
        return {
          ...props,
          htmlProps: {
            ...props.htmlProps,
            tabIndex: 0,
            "aria-current": item.key === activeKey ? true : undefined,
            onClick: (event) => {
              if ((event.target as HTMLElement).closest("input, button, a, select, textarea")) return;
              onRowClick(item.row);
            },
            onKeyDown: (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onRowClick(item.row);
              }
            },
          },
          xstyle: [...props.xstyle, styles.clickable],
        };
      },
    }),
    [onRowClick, activeKey],
  );

  const plugins = useMemo(
    () => ({
      columnSettings: settingsPlugin,
      sortable: sortPlugin,
      resize: resizePlugin,
      ...(stickyKeys.length ? { sticky: stickyPlugin } : null),
      row: rowPlugin,
      ...(isPaged ? { pagination: pagePlugin } : null),
    }),
    [settingsPlugin, sortPlugin, resizePlugin, stickyKeys.length, stickyPlugin, rowPlugin, isPaged, pagePlugin],
  );

  function exportCsv() {
    if (!csv) return;
    const shown = columns.filter((c) => activeKeys.includes(c.key));
    const header = shown.map((c) => c.label);
    const body = sorted.map((row) => shown.map((col) => cellText(col, row)));
    const blob = new Blob([toCsv(header, body)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvFilename(csv.filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const searchOpts = typeof search === "object" ? search : {};

  return (
    <VStack gap={3} width="100%">
      <HStack gap={2} wrap="wrap" vAlign="center">
        {toolbar}
        <HStack gap={2} wrap="wrap" vAlign="center" className="ml-auto">
          {search !== false && (
            <TextInput
              type="search"
              label="Search this table"
              isLabelHidden
              size="sm"
              startIcon={Search}
              hasClear
              value={query}
              onChange={setQuery}
              placeholder={searchOpts.placeholder ?? "Search"}
              width={192}
            />
          )}
          <MultiSelector
            label="Columns"
            isLabelHidden
            size="sm"
            variant="secondary"
            startIcon={<Icon icon={Columns3} size="sm" />}
            options={columns.map((c) => ({
              value: c.key,
              label: c.label || c.key,
              disabled: c.lockVisible === true,
            }))}
            value={[...activeKeys]}
            onChange={(keys) => persist(keys)}
            formatValue={() => "Columns"}
            placeholder="Columns"
          />
          {csv !== false && (
            <Button
              label="CSV"
              size="sm"
              onClick={exportCsv}
              icon={<Icon icon={Download} />}
              tooltip={`Download ${sorted.length} rows as CSV`}
              endContent={
                <Text type="inherit" color="secondary" className="tabular-nums">
                  {sorted.length}
                </Text>
              }
            />
          )}
        </HStack>
      </HStack>

      <Card padding={0} width="100%">
        <Table
          data={items}
          columns={tableColumns}
          idKey="key"
          density="compact"
          hasHover
          plugins={plugins}
          emptyState={
            <EmptyState isCompact title={query ? `Nothing matches "${query}".` : emptyLabel} />
          }
        />
      </Card>

      {footnote && (
        <Text as="p" type="supporting" color="secondary">
          {footnote}
        </Text>
      )}
    </VStack>
  );
}
