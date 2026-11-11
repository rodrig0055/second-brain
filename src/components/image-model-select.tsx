"use client";

import { MultiSelector } from "@astryxdesign/core/MultiSelector";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { IMAGE_MODEL_OPTIONS } from "@/lib/image-model-options";

/**
 * Multi-select for image models. The selection is controlled (the studio owns
 * it), and every row carries its "when to pick this" line so the models can be
 * compared without closing the list.
 */
export function ImageModelSelect({
  selected,
  onChange,
  isAvailable = () => true,
  unavailableNote,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  /** Models the current output type can't use are shown but disabled. */
  isAvailable?: (id: string) => boolean;
  unavailableNote?: string;
}) {
  // Rebuild from the canonical order so the selection (and therefore the job
  // order and the summary below) doesn't depend on the click sequence.
  const change = (next: string[]) =>
    onChange(IMAGE_MODEL_OPTIONS.filter((m) => next.includes(m.id)).map((m) => m.id));

  const anyUnavailable = IMAGE_MODEL_OPTIONS.some((m) => !isAvailable(m.id));

  return (
    <VStack gap={1.5}>
      <MultiSelector
        label="Model"
        size="sm"
        options={IMAGE_MODEL_OPTIONS.map((m) => ({
          value: m.id,
          label: m.label,
          description: isAvailable(m.id) ? m.hint : (unavailableNote ?? m.hint),
          disabled: !isAvailable(m.id),
        }))}
        value={selected}
        onChange={change}
        placeholder="Select a model"
        triggerDisplay="labels"
        formatValue={(items) => {
          const chosen = IMAGE_MODEL_OPTIONS.filter((m) => items.some((i) => i.value === m.id));
          return chosen.length === 1 ? chosen[0].label : chosen.map((m) => m.short).join(", ");
        }}
        renderOption={(option) => (
          <VStack gap={0.5}>
            <Text>{option.label}</Text>
            <Text type="supporting" color="secondary">
              {option.description}
            </Text>
          </VStack>
        )}
        description={anyUnavailable && unavailableNote ? unavailableNote : undefined}
        width="100%"
      />
      {selected.length > 1 && (
        <Text type="supporting" color="secondary">
          Each format is generated once per model.
        </Text>
      )}
    </VStack>
  );
}
