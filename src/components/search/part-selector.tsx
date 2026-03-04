import { useState, useRef } from 'preact/hooks';

interface PartOption {
  id: string;
  name: string;
}

interface Props {
  label: string;
  placeholder: string;
  options: PartOption[];
  selected: string[];
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

export function PartSelector({ label, placeholder, options, selected, onSelect, onRemove }: Props) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const available = options.filter(
    (o) => !selected.includes(o.id) && o.name.toLowerCase().includes(query.toLowerCase()),
  );

  const selectedParts = options.filter((o) => selected.includes(o.id));

  return (
    <div class="mb-3">
      <label class="mb-1 block text-xs font-medium text-gray-400">{label}</label>
      <div class="relative">
        <div
          class="flex min-h-[38px] flex-wrap items-center gap-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 focus-within:border-yellow-500 focus-within:ring-1 focus-within:ring-yellow-500"
          onClick={() => inputRef.current?.focus()}
        >
          {selectedParts.map((part) => (
            <span
              key={part.id}
              class="inline-flex items-center gap-1 rounded-md bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-300"
            >
              {part.name}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(part.id);
                }}
                class="ml-0.5 text-yellow-400 hover:text-yellow-200"
              >
                x
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={selected.length === 0 ? placeholder : ''}
            class="min-w-[60px] flex-1 border-0 bg-transparent p-1 text-sm text-white outline-none placeholder:text-gray-500"
            onInput={(e) => {
              setQuery((e.target as HTMLInputElement).value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          />
        </div>

        {isOpen && available.length > 0 && (
          <ul class="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 shadow-lg">
            {available.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  class="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 hover:text-white"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(opt.id);
                    setQuery('');
                    setIsOpen(false);
                  }}
                >
                  {opt.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
