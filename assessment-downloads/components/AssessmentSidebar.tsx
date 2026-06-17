"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Filter } from "lucide-react";
import { ClientCategoryFilter } from "@/app/pin-checker-details/components/ClientCategoryFilter";
import { cn } from "@/lib/utils";
import { calculateStatus } from "@/lib/utils/formatters";
import { useState } from 'react';
import { motion } from "framer-motion";

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

interface AssessmentSidebarProps {
  companies: Company[];
  filteredCompanies: Company[];
  selectedCompany: number | null;
  selectedCompanies: number[];
  setSelectedCompanies: (ids: number[]) => void;
  searchCompany: string;
  setSearchCompany: (value: string) => void;
  filterSettings: any;
  handleFilterSettingsChange: (filters: any) => void;
  setSelectedCompany: (id: number) => void;
  categoryStats: {
    [category: string]: {
      [status: string]: number;
    }
  };
}

const isClientActive = (fromDate?: string, toDate?: string): boolean => {
  return calculateStatus(fromDate, toDate) === 'Active';
};

export function AssessmentSidebar({
  companies,
  filteredCompanies,
  selectedCompany,
  selectedCompanies,
  setSelectedCompanies,
  searchCompany,
  setSearchCompany,
  filterSettings,
  handleFilterSettingsChange,
  setSelectedCompany,
  categoryStats,
}: AssessmentSidebarProps) {
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false);

  const toggleCompanySelection = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedCompanies.includes(id)) {
      setSelectedCompanies(selectedCompanies.filter(cid => cid !== id));
    } else {
      setSelectedCompanies([...selectedCompanies, id]);
    }
  };

  const selectAll = () => {
    setSelectedCompanies(filteredCompanies.map(c => c.id));
  };

  const clearSelection = () => {
    setSelectedCompanies([]);
  };
  
  return (
    <div className="flex flex-col h-full bg-white shadow-sm overflow-hidden select-none">
      <div className="p-4 space-y-3 flex-shrink-0 border-b border-gray-100 bg-gray-50/10">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Companies</h3>
          <div className="flex items-center gap-1">
            <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 text-[10px] uppercase font-bold text-blue-600 hover:bg-blue-50"
                onClick={selectAll}
            >
                All
            </Button>
            <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 text-[10px] uppercase font-bold text-gray-400 hover:bg-gray-50"
                onClick={clearSelection}
            >
                None
            </Button>
            <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 w-7 p-0 hover:bg-white hover:shadow-sm" 
                onClick={() => setCategoryFilterOpen(true)}
                title="Filter categories"
            >
                <Filter className="h-3.5 w-3.5 text-gray-500" />
            </Button>
          </div>
        </div>

        <div className="px-1">
           <ClientCategoryFilter
                    isOpen={categoryFilterOpen}
                    onClose={() => setCategoryFilterOpen(false)}
                    onApplyFilters={handleFilterSettingsChange}
                    onClearFilters={() => handleFilterSettingsChange({})}
                    selectedFilters={filterSettings}
                    counts={categoryStats}
                />
        </div>

        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <Input
            placeholder="Search..."
            value={searchCompany}
            onChange={(e) => setSearchCompany(e.target.value)}
            className="h-8 pl-9 bg-white border-gray-200 focus:bg-white focus:ring-1 focus:ring-blue-100 placeholder-gray-400 text-xs rounded-md"
          />
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-tight flex justify-between items-center bg-gray-50/50 border-b border-gray-100">
          <span>{filteredCompanies.length} result{filteredCompanies.length !== 1 ? 's' : ''}</span>
          {selectedCompanies.length > 0 && (
            <Badge variant="secondary" className="bg-blue-100 text-blue-700 h-4 px-1.5 text-[9px]">{selectedCompanies.length} selected</Badge>
          )}
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {filteredCompanies.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center mb-2">
                  <Search className="h-4 w-4 text-gray-300" />
                </div>
                <p className="text-xs font-medium text-gray-500">No companies found</p>
                <p className="text-[10px] text-gray-400 mt-1">Adjust search or filters</p>
              </div>
            ) : (
              filteredCompanies.map((company) => (
                <div
                    key={company.id}
                    className={cn(
                        "w-full flex items-center p-2 rounded-lg transition-all duration-200 text-left relative overflow-hidden group mb-0.5",
                        selectedCompany === company.id
                          ? "bg-blue-50/80 ring-1 ring-blue-200/50 shadow-sm"
                          : "hover:bg-gray-50"
                      )}
                >
                    <div 
                        className="flex-shrink-0 mr-3 z-10"
                        onClick={(e) => toggleCompanySelection(company.id, e)}
                    >
                        <div className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                            selectedCompanies.includes(company.id) 
                                ? "bg-blue-600 border-blue-600 text-white" 
                                : "bg-white border-gray-300 group-hover:border-gray-400"
                        )}>
                            {selectedCompanies.includes(company.id) && (
                                <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 20 20">
                                    <path d="M0 11l2-2 5 5L18 3l2 2L7 18z"/>
                                </svg>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={() => setSelectedCompany(company.id)}
                        className="flex-1 flex flex-col items-start text-left min-w-0"
                    >
                        <div className="flex items-center justify-between w-full">
                            <span className={cn(
                                "text-xs font-semibold truncate",
                                selectedCompany === company.id ? "text-blue-900" : "text-gray-700 group-hover:text-gray-900"
                            )}>
                            {company.company_name}
                            </span>
                        </div>
                        
                        {selectedCompany === company.id && (
                            <motion.div 
                                layoutId="activeSideTab"
                                className="absolute left-0 top-0 bottom-0 w-1 bg-blue-600"
                            />
                        )}
                    </button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
