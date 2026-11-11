"use client";

import { useState } from "react";

/**
 * Folder picker for the template forms: an existing folder, none, or a new one typed in place so
 * filing a template never means leaving the form. The action resolves "__new__" + newFolder.
 */
export function FolderField({
  folders,
  defaultValue,
  className,
}: {
  folders: { id: string; name: string }[];
  defaultValue?: string | null;
  className: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");

  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-600">
      Folder
      <select
        name="folderId"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={className}
      >
        <option value="">Unfiled</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
        <option value="__new__">+ New folder…</option>
      </select>
      {value === "__new__" && (
        <input
          name="newFolder"
          required
          autoFocus
          maxLength={60}
          placeholder="e.g. Meta ads"
          className={className}
        />
      )}
    </label>
  );
}
