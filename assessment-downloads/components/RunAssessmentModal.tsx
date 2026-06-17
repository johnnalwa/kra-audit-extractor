"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Settings,
  Users,
  Trash2,
  X,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Company {
  id: number;
  company_name: string;
  kra_pin: string;
  kra_password?: string;
}

interface RunAssessmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCompanies: Company[];
  onRun: (config: {
    obligations: string[];
    concurrency: number;
    automationUrl?: string;
    headless?: boolean;
    slowMo?: number;
    companyIds?: number[];
  }) => void;
  isStarting: boolean;
}

const ALL_OBLIGATIONS = [
  { value: "4", label: "Income Tax - Company" },
  { value: "9", label: "Value Added Tax (VAT)" },
  { value: "2", label: "Income Tax - Resident Individual" },
  { value: "7", label: "Income Tax - PAYE" },
  { value: "33", label: "Income Tax - Rent Income (MRI)" },
  { value: "3", label: "Income Tax - Non-Resident Individual" },
  { value: "5", label: "Income Tax - Partnership" },
  { value: "6", label: "Income Tax - Trust" },
  { value: "8", label: "Income Tax - Turnover Tax (TOT)" },
  { value: "10", label: "Excise Duty" },
  { value: "11", label: "Capital Gains Tax (CGT)" },
  { value: "12", label: "Withholding Tax" },
  { value: "13", label: "Withholding VAT" },
  { value: "14", label: "Advance Tax" },
  { value: "15", label: "Installment Tax" },
  { value: "16", label: "Agency Revenue" },
  { value: "17", label: "Stamp Duty" },
  { value: "18", label: "Betting & Gaming" },
  { value: "19", label: "Traffic Offence" },
  { value: "20", label: "Housing Fund (NHDF)" },
  { value: "21", label: "NHIF" },
  { value: "22", label: "NSSF" },
  { value: "23", label: "Air Passenger Service Charge" },
  { value: "24", label: "Catering Training Levy" },
  { value: "25", label: "Export Levy" },
  { value: "26", label: "Import Declaration Fee (IDF)" },
  { value: "27", label: "Railway Development Levy (RDL)" },
  { value: "28", label: "Sugar Development Levy" },
  { value: "29", label: "Petroleum Development Levy" },
  { value: "30", label: "Standards Levy" },
  { value: "31", label: "Minimum Tax" },
  { value: "32", label: "Digital Service Tax (DST)" },
  { value: "34", label: "Significant Economic Presence Tax" },
];

export function RunAssessmentModal({
  open,
  onOpenChange,
  selectedCompanies,
  onRun,
  isStarting,
}: RunAssessmentModalProps) {
  const [concurrency, setConcurrency] = useState("4");
  const [selectedObligations, setSelectedObligations] = useState<string[]>(["4", "9"]);
  const [automationUrl, setAutomationUrl] = useState("http://localhost:4000");
  const [headless, setHeadless] = useState(true);
  const [slowMo, setSlowMo] = useState("100");
  const [excludedIds, setExcludedIds] = useState<number[]>([]);

  useEffect(() => {
    fetch("/api/automation-settings")
      .then((response) => response.json())
      .then((payload) => {
        const settings = payload?.settings;
        if (!settings) return;
        setConcurrency(String(settings.concurrency ?? 4));
        setHeadless(Boolean(settings.headless));
        setSlowMo(String(settings.slowMo ?? 100));
      })
      .catch(() => {});
  }, []);

  const activeCompanies = selectedCompanies.filter(c => !excludedIds.includes(c.id));

  const toggleObligation = (value: string) => {
    setSelectedObligations(prev =>
      prev.includes(value)
        ? prev.filter(v => v !== value)
        : [...prev, value]
    );
  };

  // Show top obligations with checkboxes, rest in a collapsible
  const primaryObligations = ALL_OBLIGATIONS.slice(0, 5);
  const secondaryObligations = ALL_OBLIGATIONS.slice(5);
  const [showAllObligations, setShowAllObligations] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1024px] max-h-[95vh] flex flex-col p-0 overflow-hidden border border-slate-200 shadow-2xl rounded-none">
        <DialogHeader className="p-8 bg-white border-b border-slate-100 relative">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <DialogTitle className="text-2xl font-serif font-bold text-[#000080] tracking-tight">
                Run Assessment Downloads
              </DialogTitle>
            </div>
            <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="text-[#000080] hover:bg-slate-50 rounded-none h-8 w-8"
            >
                <X className="h-6 w-6 stroke-[3px]" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden grid grid-cols-12 bg-white">
            {/* Left Panel: Settings */}
            <div className="col-span-5 border-r border-slate-100 bg-slate-50/30 p-8 flex flex-col gap-6 overflow-y-auto">
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-[#000080] uppercase tracking-widest flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Download Settings
                </h3>
              </div>

              <div className="space-y-6">
                {/* Setting: Obligations (multi-select) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-slate-700">Tax Obligations</Label>
                    <Badge variant="outline" className="text-[10px] font-bold text-[#000080] border-[#000080] px-1.5 py-0">
                      {selectedObligations.length} selected
                    </Badge>
                  </div>
                  <div className="space-y-2 bg-white border border-slate-200 p-3 max-h-[240px] overflow-y-auto">
                    {primaryObligations.map((ob) => (
                      <label
                        key={ob.value}
                        className={cn(
                          "flex items-center gap-2.5 p-2 rounded cursor-pointer transition-colors",
                          selectedObligations.includes(ob.value)
                            ? "bg-blue-50/80"
                            : "hover:bg-slate-50"
                        )}
                      >
                        <Checkbox
                          checked={selectedObligations.includes(ob.value)}
                          onCheckedChange={() => toggleObligation(ob.value)}
                          className="data-[state=checked]:bg-[#000080] data-[state=checked]:border-[#000080]"
                        />
                        <span className={cn(
                          "text-sm",
                          selectedObligations.includes(ob.value) ? "font-semibold text-slate-900" : "text-slate-600"
                        )}>
                          {ob.label}
                        </span>
                      </label>
                    ))}

                    {showAllObligations && secondaryObligations.map((ob) => (
                      <label
                        key={ob.value}
                        className={cn(
                          "flex items-center gap-2.5 p-2 rounded cursor-pointer transition-colors",
                          selectedObligations.includes(ob.value)
                            ? "bg-blue-50/80"
                            : "hover:bg-slate-50"
                        )}
                      >
                        <Checkbox
                          checked={selectedObligations.includes(ob.value)}
                          onCheckedChange={() => toggleObligation(ob.value)}
                          className="data-[state=checked]:bg-[#000080] data-[state=checked]:border-[#000080]"
                        />
                        <span className={cn(
                          "text-sm",
                          selectedObligations.includes(ob.value) ? "font-semibold text-slate-900" : "text-slate-600"
                        )}>
                          {ob.label}
                        </span>
                      </label>
                    ))}
                  </div>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-[10px] font-bold text-blue-600 uppercase tracking-widest"
                    onClick={() => setShowAllObligations(!showAllObligations)}
                  >
                    {showAllObligations ? `Hide ${secondaryObligations.length} more` : `Show ${secondaryObligations.length} more obligations`}
                  </Button>
                </div>

                {/* Setting: Concurrency */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">Simultaneous Windows</Label>
                  <Select value={concurrency} onValueChange={setConcurrency}>
                    <SelectTrigger className="h-12 border-slate-300 rounded-none focus:ring-0 focus:border-[#000080] bg-white">
                      <SelectValue placeholder="Quantity" />
                    </SelectTrigger>
                    <SelectContent className="rounded-none">
                      {[1, 2, 4, 8, 12].map(val => (
                        <SelectItem key={val} value={val.toString()}>{val} Windows at once</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Setting: Server Address */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">Server Address</Label>
                  <Input
                    value={automationUrl}
                    onChange={(e) => setAutomationUrl(e.target.value)}
                    className="h-12 border-slate-300 rounded-none focus:ring-0 focus:border-[#000080] bg-white"
                  />
                </div>

                {/* Setting: Delay & Mode */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">Delay (ms)</Label>
                    <Input
                      type="number"
                      value={slowMo}
                      onChange={(e) => setSlowMo(e.target.value)}
                      className="h-12 border-slate-300 rounded-none focus:ring-0 focus:border-[#000080] bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700">Background</Label>
                    <div className="flex items-center justify-between h-12 px-4 border border-slate-300 rounded-none bg-white">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Run</span>
                      <Switch
                        checked={headless}
                        onCheckedChange={setHeadless}
                        className="data-[state=checked]:bg-[#000080] scale-90"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Panel: Companies List */}
            <div className="col-span-7 flex flex-col p-8 gap-6 bg-white overflow-hidden">
               <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#000080] uppercase tracking-widest flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Companies to Process
                </h3>
                <Badge variant="outline" className="text-[#000080] border-[#000080] rounded-none px-3 py-1 font-bold">
                  {activeCompanies.length} TOTAL
                </Badge>
              </div>

              <div className="flex-1 overflow-hidden border border-slate-200">
                <ScrollArea className="h-full max-h-[400px]">
                  <Table>
                    <TableHeader className="bg-slate-50 sticky top-0 z-10">
                      <TableRow className="border-slate-200">
                        <TableHead className="w-[60px] text-center text-[10px] font-bold uppercase text-slate-400">#</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase text-slate-400">Company Name</TableHead>
                        <TableHead className="text-[10px] font-bold uppercase text-slate-400">Identity PIN</TableHead>
                        <TableHead className="w-[80px] text-right pr-6"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeCompanies.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="h-64 text-center text-slate-400">
                            No companies in the queue
                          </TableCell>
                        </TableRow>
                      ) : (
                        activeCompanies.map((company, index) => (
                          <TableRow key={company.id} className="group hover:bg-slate-50 border-slate-100">
                            <TableCell className="text-center font-mono text-xs text-slate-400">{index + 1}</TableCell>
                            <TableCell>
                              <span className="font-bold text-slate-900 text-sm leading-tight">{company.company_name}</span>
                            </TableCell>
                            <TableCell>
                              <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 text-slate-600 font-bold">
                                {company.kra_pin}
                              </span>
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setExcludedIds((prev: number[]) => [...prev, company.id])}
                                className="h-8 w-8 text-slate-300 hover:text-red-700 hover:bg-transparent opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>

              {excludedIds.length > 0 && (
                <div className="flex justify-end">
                  <Button
                    variant="link"
                    onClick={() => setExcludedIds([])}
                    className="text-[10px] font-bold text-blue-600 uppercase tracking-widest h-auto p-0"
                  >
                    Restore {excludedIds.length} items
                  </Button>
                </div>
              )}
            </div>
          </div>

        <DialogFooter className="p-8 bg-white border-t border-slate-100 justify-start sm:justify-start gap-4">
          <Button
            onClick={() => onRun({
              obligations: selectedObligations,
              concurrency: Math.min(12, Math.max(1, parseInt(concurrency))),
              automationUrl,
              headless,
              slowMo: parseInt(slowMo),
              companyIds: activeCompanies.map(c => c.id)
            })}
            disabled={isStarting || activeCompanies.length === 0 || selectedObligations.length === 0}
            className="h-14 px-10 bg-[#000080] hover:bg-[#000066] text-white font-bold tracking-[2px] rounded-none uppercase flex items-center gap-3 min-w-[200px]"
          >
            {isStarting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Processing...
              </>
            ) : (
              `Start Downloads (${selectedObligations.length} obligation${selectedObligations.length !== 1 ? 's' : ''})`
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-14 px-8 font-bold text-slate-400 uppercase tracking-widest hover:text-slate-900 rounded-none"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
