import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

/**
 * Nurse-name picker backed by the skti-nursetrack roster. The underlying
 * field (assignedNurse) is still free text with no foreign key, so a name
 * typed but not found in the roster stays selectable — e.g. a new hire the
 * roster hasn't caught up with yet.
 */
export default function NurseCombobox({
  id,
  value,
  onChange,
  label = "Nurse (optional)",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: roster } = trpc.nurses.roster.useQuery(undefined, {
    staleTime: 60_000,
  });

  const trimmedSearch = search.trim();
  const exactMatch = roster?.some(n => n.name.toLowerCase() === trimmedSearch.toLowerCase());

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="smallcaps-detail text-[#7684A0]">
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-9 w-48 justify-between border-[#D4DFE5] bg-[#F4F7F8] font-normal text-[#1F2A52]"
          >
            <span className="truncate">{value || "Select nurse..."}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0">
          <Command shouldFilter>
            <CommandInput
              placeholder="Search nurses..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No nurse found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChange("");
                    setSearch("");
                    setOpen(false);
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${value === "" ? "opacity-100" : "opacity-0"}`} />
                  None
                </CommandItem>
                {trimmedSearch && !exactMatch && (
                  <CommandItem
                    value={`__custom__${trimmedSearch}`}
                    onSelect={() => {
                      onChange(trimmedSearch);
                      setSearch("");
                      setOpen(false);
                    }}
                  >
                    <Check className="mr-2 h-4 w-4 opacity-0" />
                    Use "{trimmedSearch}"
                  </CommandItem>
                )}
                {roster?.map(nurse => (
                  <CommandItem
                    key={nurse.id}
                    value={nurse.name}
                    onSelect={() => {
                      onChange(nurse.name);
                      setSearch("");
                      setOpen(false);
                    }}
                  >
                    <Check className={`mr-2 h-4 w-4 ${value === nurse.name ? "opacity-100" : "opacity-0"}`} />
                    <span className="truncate">
                      {nurse.name}
                      {nurse.area ? <span className="text-[#7684A0]"> · {nurse.area}</span> : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
