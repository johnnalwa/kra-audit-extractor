"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { AssessmentSidebar } from "./components/AssessmentSidebar";
import { AssessmentTable } from "./components/AssessmentTable";
import { RunAssessmentModal } from "./components/RunAssessmentModal";
import { AssessmentFilter, FilterState } from "./components/AssessmentFilter";
import { parse } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Search,
  LayoutGrid,
  List,
  Filter,
  Clock,
  X
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { calculateStatus } from "@/lib/utils/formatters";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

interface Company {
  id: number;
  company_name: string;
  kra_pin: string;
  kra_password?: string;
  acc_client_effective_from?: string;
  acc_client_effective_to?: string;
  audit_client_effective_from?: string;
  audit_client_effective_to?: string;
  sheria_client_effective_from?: string;
  sheria_client_effective_to?: string;
  imm_client_effective_from?: string;
  imm_client_effective_to?: string;
}

interface AssessmentRecord {
  id: string;
  company_id: number;
  sub_process_name: string;
  obligation_id?: string;
  obligation_name?: string;
  ack_no: string;
  ack_date: string;
  status: string;
  file_name: string;
  file_path: string;
  created_at: string;
  document_title?: string;
  period_from?: string;
  period_to?: string;
  total_amount?: string;
  extracted_details?: {
    document_title?: string;
    period_from?: string;
    period_to?: string;
    total_amount?: string;
    extraction_timestamp?: string;
  };
  company?: {
    company_name: string;
    kra_pin: string;
  };
}

export default function AssessmentPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedGlobalCompany, setSelectedGlobalCompany] = useState<number | null>(null);
  const [selectedCompanies, setSelectedCompanies] = useState<number[]>([]);
  const [searchCompanySidebar, setSearchCompanySidebar] = useState("");
  const [sidebarFilterSettings, setSidebarFilterSettings] = useState<Record<string, Record<string, boolean>>>({});
  const [assessments, setAssessments] = useState<AssessmentRecord[]>([]);
  const [searchRecords, setSearchRecords] = useState("");
  const [loadingAssessments, setLoadingAssessments] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [selectedCompaniesForRun, setSelectedCompaniesForRun] = useState<number[]>([]);
  const [activeObligationTab, setActiveObligationTab] = useState("all");
  const [advancedFilters, setAdvancedFilters] = useState<FilterState>({
    dateRange: undefined,
    status: "all",
    documentTitle: "",
    periodFrom: "",
    periodTo: "",
  });

  // Fetch Companies
  const fetchCompanies = useCallback(async () => {
    const { data, error } = await supabase
      .from('acc_portal_company_duplicate')
      .select('id, company_name, kra_pin, kra_password, acc_client_effective_from, acc_client_effective_to, audit_client_effective_from, audit_client_effective_to, sheria_client_effective_from, sheria_client_effective_to, imm_client_effective_from, imm_client_effective_to')
      .order('company_name', { ascending: true });

    if (error) {
      toast.error("Failed to fetch companies");
      return;
    }
    setCompanies((data as Company[]) || []);
  }, []);

  // Fetch Assessments for selected company
  const fetchAssessments = useCallback(async (companyId: number | null) => {
    setLoadingAssessments(true);
    let query = supabase
      .from('kra_assessment')
      .select('*, company:acc_portal_company_duplicate(company_name, kra_pin)')
      .order('created_at', { ascending: false });

    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const { data, error } = await query;
    if (error) {
      if (error.code === 'PGRST116') {
        setAssessments([]);
      } else {
        toast.error("Failed to fetch assessments");
      }
    } else {
      // Extract extraction_details fields to top-level for table display
      const mapped = (data || []).map((record: any) => {
        const details = record.extracted_details || {};
        return {
          ...record,
          document_title: record.document_title || details.document_title || null,
          period_from: record.period_from || details.period_from || null,
          period_to: record.period_to || details.period_to || null,
          total_amount: record.total_amount || details.total_amount || null,
        };
      });
      setAssessments(mapped);
    }
    setLoadingAssessments(false);
  }, []);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  useEffect(() => {
    fetchAssessments(selectedGlobalCompany);
  }, [selectedGlobalCompany, fetchAssessments]);

  const filteredCompaniesSidebar = useMemo(() => {
    let filtered = companies.filter(c =>
      c.company_name.toLowerCase().includes(searchCompanySidebar.toLowerCase())
    );

    const activeFilterEntries = Object.entries(sidebarFilterSettings).filter(([_, statuses]) =>
      Object.values(statuses).some(v => v)
    );

    if (activeFilterEntries.length > 0) {
      filtered = filtered.filter(company => {
        return activeFilterEntries.some(([catId, statuses]) => {
          let from, to;
          if (catId === 'acc') { from = company.acc_client_effective_from; to = company.acc_client_effective_to; }
          else if (catId === 'imm') { from = company.imm_client_effective_from; to = company.imm_client_effective_to; }
          else if (catId === 'sheria') { from = company.sheria_client_effective_from; to = company.sheria_client_effective_to; }
          else if (catId === 'audit') { from = company.audit_client_effective_from; to = company.audit_client_effective_to; }
          else if (catId === 'all') return true;

          if (!from) return false;

          const status = calculateStatus(from, to).toLowerCase();

          if (statuses.all) return true;
          if (statuses.active && status === 'active') return true;
          if (statuses.inactive && status === 'inactive') return true;

          return false;
        });
      });
    }

    return filtered;
  }, [companies, searchCompanySidebar, sidebarFilterSettings]);

  const categoryStats = useMemo(() => {
    const stats: Record<string, Record<string, number>> = {
      all: { all: 0, active: 0, inactive: 0 },
      acc: { all: 0, active: 0, inactive: 0 },
      imm: { all: 0, active: 0, inactive: 0 },
      sheria: { all: 0, active: 0, inactive: 0 },
      audit: { all: 0, active: 0, inactive: 0 },
    };

    companies.forEach(c => {
      const activeCats = [
        { id: 'acc', from: c.acc_client_effective_from, to: c.acc_client_effective_to },
        { id: 'imm', from: c.imm_client_effective_from, to: c.imm_client_effective_to },
        { id: 'sheria', from: c.sheria_client_effective_from, to: c.sheria_client_effective_to },
        { id: 'audit', from: c.audit_client_effective_from, to: c.audit_client_effective_to }
      ];

      activeCats.forEach(cat => {
        if (cat.from) {
          const status = (calculateStatus(cat.from, cat.to) || 'inactive').toLowerCase();

          stats[cat.id].all++;
          if (status === 'active') stats[cat.id].active++;
          else stats[cat.id].inactive++;

          stats.all.all++;
          if (status === 'active') stats.all.active++;
          else stats.all.inactive++;
        }
      });
    });

    return stats;
  }, [companies]);

  // Derive obligation tabs from assessments data
  const obligationTabs = useMemo(() => {
    const obligationMap = new Map<string, { id: string; name: string; count: number }>();
    assessments.forEach(r => {
      const oblId = r.obligation_id || "unknown";
      const oblName = r.obligation_name || "Unknown";
      if (obligationMap.has(oblId)) {
        obligationMap.get(oblId)!.count++;
      } else {
        obligationMap.set(oblId, { id: oblId, name: oblName, count: 1 });
      }
    });
    return Array.from(obligationMap.values());
  }, [assessments]);

  // Last run timestamp
  const lastRunTimestamp = useMemo(() => {
    if (assessments.length === 0) return null;
    const sorted = [...assessments].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return sorted[0]?.created_at;
  }, [assessments]);

  const formatLastRun = (timestamp: string | null) => {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // Unique document titles for the filter dropdown
  const uniqueDocumentTitles = useMemo(() => {
    const titles = new Set<string>();
    assessments.forEach(r => {
      if (r.document_title) titles.add(r.document_title);
    });
    return Array.from(titles).sort();
  }, [assessments]);

  // Filter assessments by obligation tab AND search
  const filteredAssessments = useMemo(() => {
    let filtered = assessments;

    // Filter by obligation tab
    if (activeObligationTab !== "all") {
      filtered = filtered.filter(r => (r.obligation_id || "unknown") === activeObligationTab);
    }

    // Filter by search
    if (searchRecords) {
      const term = searchRecords.toLowerCase();
      filtered = filtered.filter(r =>
        r.sub_process_name?.toLowerCase().includes(term) ||
        r.ack_no?.toLowerCase().includes(term) ||
        r.company?.company_name?.toLowerCase().includes(term) ||
        r.company?.kra_pin?.toLowerCase().includes(term) ||
        r.obligation_name?.toLowerCase().includes(term)
      );
    }

    // Advanced Filters
    if (advancedFilters.status !== "all") {
      filtered = filtered.filter(r => r.status?.toLowerCase() === advancedFilters.status.toLowerCase());
    }

    if (advancedFilters.documentTitle) {
      const term = advancedFilters.documentTitle.toLowerCase();
      filtered = filtered.filter(r => r.document_title?.toLowerCase().includes(term));
    }

    if (advancedFilters.periodFrom) {
        filtered = filtered.filter(r => r.period_from?.includes(advancedFilters.periodFrom));
    }

    if (advancedFilters.periodTo) {
        filtered = filtered.filter(r => r.period_to?.includes(advancedFilters.periodTo));
    }

    if (advancedFilters.dateRange?.from) {
      const fromTime = advancedFilters.dateRange.from.getTime();
      const toTime = advancedFilters.dateRange.to ? advancedFilters.dateRange.to.getTime() : fromTime;
      
      filtered = filtered.filter(r => {
         if (!r.ack_date) return false;
         // Parse dd/MM/yyyy
         const parts = r.ack_date.split('/');
         if (parts.length !== 3) return false;
         const date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
         const time = date.getTime();
         return time >= fromTime && time <= toTime + 86400000; // Add 1 day buffer for inclusive end date
      });
    }

    return filtered;
  }, [assessments, searchRecords, activeObligationTab, advancedFilters]);

  const handleRunAutomation = async (config: {
    obligations: string[];
    concurrency: number;
    automationUrl?: string;
    headless?: boolean;
    slowMo?: number;
    companyIds?: number[];
  }) => {
    setIsStartingRun(true);
    try {
      const targetIds = config.companyIds || selectedCompaniesForRun;
      const companiesToRun = companies.filter(c => targetIds.includes(c.id));

      const response = await fetch('/api/assessment-downloads/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companies: companiesToRun.map(c => ({
            id: c.id,
            pin: c.kra_pin,
            password: c.kra_password,
            name: c.company_name
          })),
          ...config
        })
      });

      const result = await response.json();
      if (result.success) {
        toast.success(`Started assessment downloads for ${companiesToRun.length} companies (batch ${result.jobId || ''}, concurrency: ${result.concurrency || config.concurrency}). Processing in background.`);
        // Don't close the modal, only refresh data
        // Refresh assessments periodically to show new results
        setTimeout(() => fetchAssessments(selectedGlobalCompany), 30000);
      } else {
        throw new Error(result.error || "Failed to start run");
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsStartingRun(false);
    }
  };

  const selectedCompanyData = companies.find(c => c.id === selectedGlobalCompany);

  return (
    <div className="flex h-screen w-full bg-[#f8f9fa] overflow-hidden font-sans">
      {/* Sidebar Toggle Area */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="flex-shrink-0 border-r bg-white h-full z-20 shadow-xl shadow-gray-200/50"
          >
            <AssessmentSidebar
              companies={companies}
              filteredCompanies={filteredCompaniesSidebar}
              selectedCompany={selectedGlobalCompany}
              selectedCompanies={selectedCompanies}
              setSelectedCompanies={setSelectedCompanies}
              searchCompany={searchCompanySidebar}
              setSearchCompany={setSearchCompanySidebar}
              filterSettings={sidebarFilterSettings}
              handleFilterSettingsChange={setSidebarFilterSettings}
              setSelectedCompany={setSelectedGlobalCompany}
              categoryStats={categoryStats}
            />
          </motion.aside>
        )}
      </AnimatePresence>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Header */}
        <header className="h-16 border-b bg-white flex items-center justify-between px-6 shrink-0 z-10 shadow-sm">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="text-gray-500 hover:bg-gray-100"
            >
              {isSidebarOpen ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
            </Button>
            <div className="flex flex-col">
              <h1 className="text-lg font-bold text-gray-900 tracking-tight">Assessments & Taxpayer Services</h1>
              <div className="flex items-center gap-2">
                 <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-100 py-0 text-[10px] font-bold">KRA PORTAL</Badge>
                 {selectedCompanyData && (
                    <span className="text-xs text-gray-500 font-medium truncate max-w-[200px]">
                      / {selectedCompanyData.company_name}
                    </span>
                 )}
                 {lastRunTimestamp && (
                    <div className="flex items-center gap-1 ml-2 text-[10px] text-gray-400">
                      <Clock className="h-3 w-3" />
                      <span>Last run: {formatLastRun(lastRunTimestamp)}</span>
                    </div>
                 )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
                variant="outline"
                size="sm"
                onClick={() => fetchAssessments(selectedGlobalCompany)}
                className="h-9 gap-2 border-gray-200"
            >
                <RefreshCw className={cn("h-4 w-4", loadingAssessments && "animate-spin")} />
                Refresh
            </Button>

            <Button
                onClick={() => {
                    if (selectedCompanies.length > 0) {
                        setSelectedCompaniesForRun(selectedCompanies);
                        setIsModalOpen(true);
                    } else if (selectedGlobalCompany) {
                        setSelectedCompaniesForRun([selectedGlobalCompany]);
                        setIsModalOpen(true);
                    } else {
                        toast.error("Please select at least one company");
                    }
                }}
                className="h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md shadow-blue-200 transition-all active:scale-95 gap-2"
            >
                <Play className="h-4 w-4 fill-current" />
                Run Assessment ({selectedCompanies.length || (selectedGlobalCompany ? 1 : 0)})
            </Button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden p-6 gap-4">
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest">
                        {selectedGlobalCompany ? "Company Assessments" : "Recent Assessments"}
                    </h2>
                    <Badge variant="secondary" className="bg-gray-200 text-gray-700 font-mono">
                        {filteredAssessments.length}
                    </Badge>
                </div>

                <div className="flex items-center gap-2">
                    <AssessmentFilter
                      filters={advancedFilters}
                      onFilterChange={setAdvancedFilters}
                      onClearFilters={() => setAdvancedFilters({
                        dateRange: undefined,
                        status: "all",
                        documentTitle: "",
                        periodFrom: "",
                        periodTo: "",
                      })}
                      hasActiveFilters={
                        !!advancedFilters.dateRange?.from ||
                        advancedFilters.status !== "all" ||
                        !!advancedFilters.documentTitle ||
                        !!advancedFilters.periodFrom ||
                        !!advancedFilters.periodTo
                      }
                      uniqueDocumentTitles={uniqueDocumentTitles}
                    />
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                            placeholder="Filter records..."
                            className="pl-10 h-9 w-[250px] bg-white border-gray-200"
                            value={searchRecords}
                            onChange={(e) => setSearchRecords(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Active filter chips */}
            {(!!advancedFilters.dateRange?.from ||
              advancedFilters.status !== "all" ||
              !!advancedFilters.documentTitle ||
              !!advancedFilters.periodFrom ||
              !!advancedFilters.periodTo) && (
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Active Filters:</span>
                {advancedFilters.status !== "all" && (
                  <Badge
                    variant="secondary"
                    className="gap-1 px-2 py-0.5 text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 cursor-pointer hover:bg-blue-100 transition-colors"
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, status: "all" }))}
                  >
                    Status: {advancedFilters.status.charAt(0).toUpperCase() + advancedFilters.status.slice(1)}
                    <X className="h-3 w-3 ml-0.5" />
                  </Badge>
                )}
                {advancedFilters.dateRange?.from && (
                  <Badge
                    variant="secondary"
                    className="gap-1 px-2 py-0.5 text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 cursor-pointer hover:bg-purple-100 transition-colors"
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, dateRange: undefined }))}
                  >
                    Date: {advancedFilters.dateRange.from.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    {advancedFilters.dateRange.to && ` \u2013 ${advancedFilters.dateRange.to.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`}
                    <X className="h-3 w-3 ml-0.5" />
                  </Badge>
                )}
                {!!advancedFilters.documentTitle && (
                  <Badge
                    variant="secondary"
                    className="gap-1 px-2 py-0.5 text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200 cursor-pointer hover:bg-amber-100 transition-colors max-w-[260px] truncate"
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, documentTitle: "" }))}
                  >
                    Title: {advancedFilters.documentTitle}
                    <X className="h-3 w-3 ml-0.5 shrink-0" />
                  </Badge>
                )}
                {!!advancedFilters.periodFrom && (
                  <Badge
                    variant="secondary"
                    className="gap-1 px-2 py-0.5 text-[11px] font-medium bg-green-50 text-green-700 border border-green-200 cursor-pointer hover:bg-green-100 transition-colors"
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, periodFrom: "" }))}
                  >
                    From: {advancedFilters.periodFrom}
                    <X className="h-3 w-3 ml-0.5" />
                  </Badge>
                )}
                {!!advancedFilters.periodTo && (
                  <Badge
                    variant="secondary"
                    className="gap-1 px-2 py-0.5 text-[11px] font-medium bg-teal-50 text-teal-700 border border-teal-200 cursor-pointer hover:bg-teal-100 transition-colors"
                    onClick={() => setAdvancedFilters(prev => ({ ...prev, periodTo: "" }))}
                  >
                    To: {advancedFilters.periodTo}
                    <X className="h-3 w-3 ml-0.5" />
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] text-gray-500 hover:text-red-600 hover:bg-red-50"
                  onClick={() => setAdvancedFilters({
                    dateRange: undefined,
                    status: "all",
                    documentTitle: "",
                    periodFrom: "",
                    periodTo: "",
                  })}
                >
                  Clear all
                </Button>
              </div>
            )}

            {/* Obligation Tabs */}
            {obligationTabs.length > 0 && (
              <div className="shrink-0">
                <Tabs value={activeObligationTab} onValueChange={setActiveObligationTab}>
                  <TabsList className="bg-gray-100 h-9 p-1">
                    <TabsTrigger value="all" className="text-xs font-semibold px-3 h-7 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                      All
                      <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[9px] font-mono bg-white/20">
                        {assessments.length}
                      </Badge>
                    </TabsTrigger>
                    {obligationTabs.map(tab => (
                      <TabsTrigger
                        key={tab.id}
                        value={tab.id}
                        className="text-xs font-semibold px-3 h-7 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                      >
                        {tab.name}
                        <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[9px] font-mono bg-white/20">
                          {tab.count}
                        </Badge>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            )}

            <Card className="flex-1 flex flex-col overflow-hidden shadow-2xl shadow-gray-200/40 border-gray-100">
                <AssessmentTable
                    data={filteredAssessments}
                    loading={loadingAssessments}
                    showCompanyColumn={!selectedGlobalCompany}
                    onRecordUpdated={() => fetchAssessments(selectedGlobalCompany)}
                />
            </Card>
        </div>

        {/* Modal */}
        <RunAssessmentModal
            open={isModalOpen}
            onOpenChange={setIsModalOpen}
            selectedCompanies={companies.filter(c => selectedCompaniesForRun.includes(c.id))}
            onRun={handleRunAutomation}
            isStarting={isStartingRun}
        />
      </main>
    </div>
  );
}
