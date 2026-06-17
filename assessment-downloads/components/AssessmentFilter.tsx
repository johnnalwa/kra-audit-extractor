"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Filter, Calendar as CalendarIcon, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

export interface FilterState {
  dateRange: DateRange | undefined;
  status: string;
  documentTitle: string;
  periodFrom: string;
  periodTo: string;
}

interface AssessmentFilterProps {
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
  uniqueDocumentTitles: string[];
}

export function AssessmentFilter({
  filters,
  onFilterChange,
  onClearFilters,
  hasActiveFilters,
  uniqueDocumentTitles,
}: AssessmentFilterProps) {
  const [open, setOpen] = useState(false);
  const [localFilters, setLocalFilters] = useState<FilterState>(filters);

  // Sync local state when props change
  useEffect(() => {
    setLocalFilters(filters);
  }, [filters, open]);

  const handleApply = () => {
    onFilterChange(localFilters);
    setOpen(false);
  };

  const handleClear = () => {
    onClearFilters();
    setOpen(false);
  };

  const updateFilter = (key: keyof FilterState, value: any) => {
    setLocalFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const activeCount = [
    filters.dateRange?.from,
    filters.status !== "all",
    filters.documentTitle,
    filters.periodFrom,
    filters.periodTo,
  ].filter(Boolean).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-2 border-dashed",
            hasActiveFilters && "border-blue-200 bg-blue-50 text-blue-700"
          )}
        >
          <Filter className="h-4 w-4" />
          Filter
          {activeCount > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 h-5 px-1.5 text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-100"
            >
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-4 bg-white shadow-xl" align="end">
        <div className="grid gap-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium leading-none">Filter Assessments</h4>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto p-0 text-xs text-blue-600"
                onClick={handleClear}
              >
                Clear all
              </Button>
            )}
          </div>
          
          <div className="grid gap-2">
            <Label htmlFor="status" className="text-xs font-semibold text-gray-500">
              Status
            </Label>
            <Select
              value={localFilters.status}
              onValueChange={(val) => updateFilter("status", val)}
            >
              <SelectTrigger id="status" className="h-8">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label className="text-xs font-semibold text-gray-500">
              Acknowledgement Date
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="date"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "w-full justify-start text-left font-normal h-8",
                    !localFilters.dateRange && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-3 w-3" />
                  {localFilters.dateRange?.from ? (
                    localFilters.dateRange.to ? (
                      <>
                        {format(localFilters.dateRange.from, "LLL dd, y")} -{" "}
                        {format(localFilters.dateRange.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(localFilters.dateRange.from, "LLL dd, y")
                    )
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={localFilters.dateRange?.from}
                  selected={localFilters.dateRange}
                  onSelect={(range) => updateFilter("dateRange", range)}
                  numberOfMonths={2}
                  className="bg-white border rounded-md shadow-md"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="doc-title" className="text-xs font-semibold text-gray-500">
              Document Title
            </Label>
            <Select
              value={localFilters.documentTitle}
              onValueChange={(val) => updateFilter("documentTitle", val === "all" ? "" : val)}
            >
              <SelectTrigger id="doc-title" className="h-8">
                <SelectValue placeholder="Select document title" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Titles</SelectItem>
                {uniqueDocumentTitles.map((title) => (
                  <SelectItem key={title} value={title}>
                    {title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
               <Label htmlFor="period-from" className="text-xs font-semibold text-gray-500">
                 Period From
               </Label>
               <Input
                 id="period-from"
                 placeholder="dd/mm/yyyy"
                 className="h-8 text-xs"
                 value={localFilters.periodFrom}
                 onChange={(e) => updateFilter("periodFrom", e.target.value)}
               />
            </div>
            <div className="grid gap-2">
               <Label htmlFor="period-to" className="text-xs font-semibold text-gray-500">
                 Period To
               </Label>
               <Input
                 id="period-to"
                 placeholder="dd/mm/yyyy"
                 className="h-8 text-xs"
                 value={localFilters.periodTo}
                 onChange={(e) => updateFilter("periodTo", e.target.value)}
               />
            </div>
          </div>

          <Button onClick={handleApply} className="mt-2 text-xs bg-blue-600 hover:bg-blue-700">
            Apply Filters
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
