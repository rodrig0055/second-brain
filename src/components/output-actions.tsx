"use client";

import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";

export function OutputActions({
  output,
  filename,
}: {
  output: string;
  filename: string;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function download() {
    const blob = new Blob([output], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex items-center gap-4 text-xs">
      <Button
        label={copied ? "Copied ✓" : "Copy"}
        variant="ghost"
        size="sm"
        onClick={copy}
      />
      <Button
        label="Download .md"
        variant="ghost"
        size="sm"
        onClick={download}
      />
    </div>
  );
}
