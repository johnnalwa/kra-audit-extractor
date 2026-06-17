"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Eye, Download, DownloadCloud, FileText, Loader2, ExternalLink, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Save, Pencil, X, Check, Trash2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

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
  company?: {
    company_name: string;
    kra_pin: string;
  };
}

interface AssessmentTableProps {
  data: AssessmentRecord[];
  loading: boolean;
  showCompanyColumn?: boolean;
  onRecordUpdated?: () => void;
}

function getStatusBadge(status: string) {
  const s = (status || "").toLowerCase();
  
  if (s === "approved" || s === "aprv") {
    return { bg: "bg-green-50 text-green-700 border-green-200", label: "Approved" };
  }
  if (s === "rejected") {
    return { bg: "bg-red-50 text-red-700 border-red-200", label: "Rejected" };
  }
  if (s === "pending") {
    return { bg: "bg-amber-50 text-amber-700 border-amber-200", label: "Pending" };
  }
  if (s === "completed") {
    return { bg: "bg-green-50 text-green-700 border-green-200", label: "Completed" };
  }
  if (s === "cancelled") {
    return { bg: "bg-gray-50 text-gray-500 border-gray-200", label: "Cancelled" };
  }
  
  // Format other statuses nicely (capitalize first letter)
  const formattedLabel = status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : "N/A";
  
  return { bg: "bg-blue-50 text-blue-700 border-blue-200", label: formattedLabel };
}

function isLocalPath(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  return filePath.startsWith('C:\\') || filePath.startsWith('D:\\') ||
    filePath.startsWith('/tmp') || filePath.startsWith('/var') ||
    filePath.includes('\\AppData\\') || filePath.includes('\\Temp\\');
}

function isValidUrl(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  return filePath.startsWith('http://') || filePath.startsWith('https://');
}

async function downloadFile(url: string, fileName: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Download failed");
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName || "document.pdf";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  } catch {
    // Fallback: open in new tab
    window.open(url, "_blank");
  }
}

export function AssessmentTable({ data, loading, showCompanyColumn = true, onRecordUpdated }: AssessmentTableProps) {
  const [viewingRecord, setViewingRecord] = useState<AssessmentRecord | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    document_title: '',
    period_from: '',
    period_to: '',
    total_amount: '',
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isExtractingAll, setIsExtractingAll] = useState(false);
  const [extractProgress, setExtractProgress] = useState('');

  const startEditing = () => {
    if (!viewingRecord) return;
    setEditForm({
      document_title: viewingRecord.document_title || '',
      period_from: viewingRecord.period_from || '',
      period_to: viewingRecord.period_to || '',
      total_amount: viewingRecord.total_amount || '',
    });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const saveDetails = async () => {
    if (!viewingRecord) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('kra_assessment')
        .update({
          extracted_details: {
            ...(viewingRecord as any).extracted_details,
            document_title: editForm.document_title || null,
            period_from: editForm.period_from || null,
            period_to: editForm.period_to || null,
            total_amount: editForm.total_amount || null,
            extraction_timestamp: new Date().toISOString(),
          }
        })
        .eq('id', viewingRecord.id);

      if (error) throw error;

      // Update local state
      setViewingRecord({
        ...viewingRecord,
        document_title: editForm.document_title || undefined,
        period_from: editForm.period_from || undefined,
        period_to: editForm.period_to || undefined,
        total_amount: editForm.total_amount || undefined,
      });
      setIsEditing(false);
      toast.success('Details saved successfully');
      onRecordUpdated?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save details');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteRecord = async () => {
    if (!viewingRecord) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('kra_assessment')
        .delete()
        .eq('id', viewingRecord.id);
      if (error) throw error;
      toast.success('Record deleted successfully');
      setViewingRecord(null);
      setIsEditing(false);
      onRecordUpdated?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete record');
    } finally {
      setIsDeleting(false);
    }
  };

  const reExtract = async (recordIds: string[]) => {
    try {
      const res = await fetch('/api/assessment-downloads/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Extraction failed' }));
        throw new Error(err.error || 'Extraction failed');
      }
      return await res.json();
    } catch (err: any) {
      throw err;
    }
  };

  const handleReExtract = async () => {
    if (!viewingRecord) return;
    setIsExtracting(true);
    try {
      const result = await reExtract([viewingRecord.id]);
      if (result.extracted > 0 && result.results?.[0]?.details) {
        const d = result.results[0].details;
        setViewingRecord({
          ...viewingRecord,
          document_title: d.document_title || undefined,
          period_from: d.period_from || undefined,
          period_to: d.period_to || undefined,
          total_amount: d.total_amount || undefined,
        });
      }
      toast.success(`Extracted: ${result.extracted}/${result.processed}`);
      onRecordUpdated?.();
    } catch (err: any) {
      toast.error(err.message || 'Re-extraction failed');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleReExtractAll = async () => {
    const withFiles = data.filter(r => r.file_path && isValidUrl(r.file_path));
    if (withFiles.length === 0) {
      toast.info('No records with downloadable files');
      return;
    }
    setIsExtractingAll(true);
    setExtractProgress(`0/${withFiles.length}`);
    try {
      // Process in batches of 10 for UI progress
      const batchSize = 10;
      let totalExtracted = 0;
      let totalProcessed = 0;
      for (let i = 0; i < withFiles.length; i += batchSize) {
        const batch = withFiles.slice(i, i + batchSize);
        const ids = batch.map(r => r.id);
        const result = await reExtract(ids);
        totalExtracted += result.extracted || 0;
        totalProcessed += result.processed || 0;
        setExtractProgress(`${totalProcessed}/${withFiles.length}`);
      }
      toast.success(`Re-extracted ${totalExtracted}/${totalProcessed} records`);
      onRecordUpdated?.();
    } catch (err: any) {
      toast.error(err.message || 'Batch re-extraction failed');
    } finally {
      setIsExtractingAll(false);
      setExtractProgress('');
    }
  };

  const recordsWithFiles = data.filter(r => r.file_path && isValidUrl(r.file_path));

  const handleSort = (key: string) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const sortedData = [...data].sort((a, b) => {
    if (!sortConfig) return 0;

    let aValue: any = a[sortConfig.key as keyof AssessmentRecord];
    let bValue: any = b[sortConfig.key as keyof AssessmentRecord];

    if (sortConfig.key === 'company.company_name') {
      aValue = a.company?.company_name || '';
      bValue = b.company?.company_name || '';
    }

    if (typeof aValue === 'string') aValue = aValue.toLowerCase();
    if (typeof bValue === 'string') bValue = bValue.toLowerCase();

    if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
    return 0;
  });

  const handleDownloadAll = async () => {
    if (recordsWithFiles.length === 0) {
      toast.info("No downloadable files available");
      return;
    }
    setDownloadingAll(true);
    toast.info(`Creating zip with ${recordsWithFiles.length} files...`);

    try {
      // Prepare file list for zip
      const filesToZip = recordsWithFiles.map(record => ({
        fileUrl: record.file_path,
        fileName: record.file_name || `${record.ack_no}.pdf`,
        ackNo: record.ack_no,
        obligationName: record.obligation_name,
        subProcessName: record.sub_process_name,
        srNo: record.id // Use record id or sr_no if available
      }));

      // Generate a meaningful zip name
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const zipName = `assessments-${dateStr}.zip`;

      // Call the bulk download API
      const response = await fetch('/api/assessment-downloads/bulk-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filesToZip, zipName })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Failed to create zip (${response.statusText})`);
      }

      // Download the zip file
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = zipName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);

      toast.success(`Downloaded ${recordsWithFiles.length} files as ${zipName}`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create zip file');
      console.error('Error creating zip:', error);
    } finally {
      setDownloadingAll(false);
    }
  };

  const renderSortIcon = (columnKey: string) => {
    if (sortConfig?.key !== columnKey) return <ArrowUpDown className="ml-2 h-3 w-3 text-gray-400" />;
    return sortConfig.direction === "asc" ? 
      <ArrowUp className="ml-2 h-3 w-3 text-blue-600" /> : 
      <ArrowDown className="ml-2 h-3 w-3 text-blue-600" />;
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm text-gray-500 font-medium">Loading assessments...</p>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white p-8 text-center text-gray-500">
        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
          <FileText className="h-8 w-8 text-gray-300" />
        </div>
        <h3 className="text-base font-semibold text-gray-900">No assessments found</h3>
        <p className="text-sm mt-1 max-w-xs">
          Select a company or run the automation to see assessment records.
        </p>
      </div>
    );
  }

  const canViewFile = (record: AssessmentRecord) => record.file_path && isValidUrl(record.file_path);
  const hasLocalFile = (record: AssessmentRecord) => record.file_path && isLocalPath(record.file_path);

  return (
    <>
      <div className="flex-1 flex flex-col overflow-hidden bg-white border rounded-md shadow-sm">
        {/* Table toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50/50 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              {data.length} record{data.length !== 1 ? "s" : ""}
            </span>
            {recordsWithFiles.length > 0 && (
              <Badge variant="outline" className="text-[10px] font-bold bg-blue-50 text-blue-600 border-blue-100 px-1.5 py-0">
                {recordsWithFiles.length} with files
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {recordsWithFiles.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs font-semibold border-green-200 text-green-700 hover:bg-green-50"
                onClick={handleReExtractAll}
                disabled={isExtractingAll}
              >
                {isExtractingAll ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {isExtractingAll ? `Extracting ${extractProgress}` : `Re-extract All (${recordsWithFiles.length})`}
              </Button>
            )}
            {recordsWithFiles.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs font-semibold border-blue-200 text-blue-700 hover:bg-blue-50"
                onClick={handleDownloadAll}
                disabled={downloadingAll}
              >
                {downloadingAll ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <DownloadCloud className="h-3.5 w-3.5" />
                )}
                Download All ({recordsWithFiles.length})
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <Table>
            <TableHeader className="sticky top-0 bg-gray-50 z-10 shadow-sm border-b">
              <TableRow className="hover:bg-transparent border-b border-gray-200">
                <TableHead className="w-[50px] text-center font-semibold text-gray-600 h-9 border-r last:border-0 border-gray-100">#</TableHead>
                {showCompanyColumn && (
                  <TableHead 
                    className="w-[160px] font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 h-9 border-r last:border-0 border-gray-100"
                    onClick={() => handleSort('company.company_name')}
                  >
                    <div className="flex items-center gap-1">
                      Company
                      {renderSortIcon('company.company_name')}
                    </div>
                  </TableHead>
                )}
                <TableHead 
                  className="w-[140px] font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 h-9 border-r last:border-0 border-gray-100"
                  onClick={() => handleSort('obligation_name')}
                >
                  <div className="flex items-center gap-1">
                    Obligation
                    {renderSortIcon('obligation_name')}
                  </div>
                </TableHead>
                <TableHead 
                  className="w-[180px] font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 h-9 border-r last:border-0 border-gray-100"
                  onClick={() => handleSort('sub_process_name')}
                >
                  <div className="flex items-center gap-1">
                    Sub Process
                    {renderSortIcon('sub_process_name')}
                  </div>
                </TableHead>
                <TableHead
                  className="w-[130px] font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 h-9 border-r last:border-0 border-gray-100"
                  onClick={() => handleSort('ack_no')}
                >
                  <div className="flex items-center gap-1">
                    Ack No.
                    {renderSortIcon('ack_no')}
                  </div>
                </TableHead>
                <TableHead
                  className="w-[130px] font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 h-9 border-r last:border-0 border-gray-100"
                  onClick={() => handleSort('ack_date')}
                >
                  <div className="flex items-center gap-1">
                    Ack Date
                    {renderSortIcon('ack_date')}
                  </div>
                </TableHead>
                <TableHead
                  className="w-[140px] font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 h-9 border-r last:border-0 border-gray-100"
                  onClick={() => handleSort('document_title')}
                >
                  <div className="flex items-center gap-1">
                    Document Title
                    {renderSortIcon('document_title')}
                  </div>
                </TableHead>
                <TableHead 
                  className="w-[130px] font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 h-9 border-r last:border-0 border-gray-100"
                  onClick={() => handleSort('period_from')}
                >
                  <div className="flex items-center gap-1">
                    Period From
                    {renderSortIcon('period_from')}
                  </div>
                </TableHead>
                <TableHead 
                  className="w-[130px] font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 h-9 border-r last:border-0 border-gray-100"
                  onClick={() => handleSort('period_to')}
                >
                  <div className="flex items-center gap-1">
                    Period To
                    {renderSortIcon('period_to')}
                  </div>
                </TableHead>
                <TableHead 
                  className="w-[140px] font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 h-9 border-r last:border-0 border-gray-100"
                  onClick={() => handleSort('total_amount')}
                >
                  <div className="flex items-center gap-1">
                    Total Amount
                    {renderSortIcon('total_amount')}
                  </div>
                </TableHead>
                <TableHead
                  className="w-[120px] font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 h-9 border-r last:border-0 border-gray-100"
                  onClick={() => handleSort('status')}
                >
                  <div className="flex items-center gap-1">
                    Status
                    {renderSortIcon('status')}
                  </div>
                </TableHead>
                <TableHead className="w-[100px] text-right font-semibold text-gray-600 h-9">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedData.map((record, idx) => {
                const badge = getStatusBadge(record.status);
                const fileIsLocal = hasLocalFile(record);
                const fileIsUrl = canViewFile(record);
                return (
                  <TableRow key={record.id} className="group hover:bg-blue-50/40 transition-colors border-b border-gray-100 last:border-0">
                    <TableCell className="text-center text-xs text-gray-400 font-mono py-2 border-r last:border-0 border-gray-50">{idx + 1}</TableCell>
                    {showCompanyColumn && (
                      <TableCell className="w-[160px] py-2 border-r last:border-0 border-gray-50">
                        <div className="flex flex-col">
                          <span className="font-semibold text-gray-900 truncate max-w-[150px] text-xs">
                            {record.company?.company_name || "Unknown"}
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">
                            {record.company?.kra_pin}
                          </span>
                        </div>
                      </TableCell>
                    )}
                    <TableCell className="w-[140px] py-2 border-r last:border-0 border-gray-50">
                      {record.obligation_name ? (
                        <Badge variant="outline" className="text-[10px] font-medium px-1.5 py-0 bg-indigo-50/50 text-indigo-700 border-indigo-100 truncate max-w-[130px]">
                          {record.obligation_name}
                        </Badge>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="w-[180px] font-medium text-gray-700 text-xs py-2 border-r last:border-0 border-gray-50 truncate" title={record.sub_process_name}>
                        {record.sub_process_name}
                    </TableCell>
                    <TableCell className="w-[130px] font-mono text-xs py-2 border-r last:border-0 border-gray-50 text-gray-600 truncate">{record.ack_no}</TableCell>
                    <TableCell className="w-[130px] text-gray-500 text-xs py-2 border-r last:border-0 border-gray-50">{record.ack_date}</TableCell>
                    <TableCell className="w-[140px] text-gray-600 text-xs py-2 border-r last:border-0 border-gray-50 truncate">
                      {record.document_title || <span className="text-gray-300">-</span>}
                    </TableCell>
                    <TableCell className="w-[130px] text-gray-600 text-xs py-2 border-r last:border-0 border-gray-50 truncate">
                      {record.period_from || <span className="text-gray-300">-</span>}
                    </TableCell>
                    <TableCell className="w-[130px] text-gray-600 text-xs py-2 border-r last:border-0 border-gray-50 truncate">
                      {record.period_to || <span className="text-gray-300">-</span>}
                    </TableCell>
                    <TableCell className="w-[140px] text-gray-600 text-xs py-2 border-r last:border-0 border-gray-50 font-semibold truncate">
                      {record.total_amount ? <span className="text-green-700">{record.total_amount}</span> : <span className="text-gray-300">-</span>}
                    </TableCell>
                    <TableCell className="w-[120px] py-2 border-r last:border-0 border-gray-50">
                      <Badge
                        variant="outline"
                        className={cn("px-1.5 py-0 text-[10px] font-semibold uppercase tracking-tight", getStatusBadge(record.status).bg)}
                      >
                        {getStatusBadge(record.status).label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right py-2 px-2">
                       <div className="flex items-center justify-end gap-1 opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-blue-600 hover:bg-blue-100 hover:text-blue-700 transition-colors"
                          onClick={() => setViewingRecord(record)}
                          title="View details"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                          onClick={() => {
                            if (fileIsUrl) {
                              downloadFile(record.file_path, record.file_name || `${record.ack_no}.pdf`);
                            }
                          }}
                          disabled={!fileIsUrl}
                          title={fileIsLocal ? "File is on server only" : fileIsUrl ? "Download File" : "No file"}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>

      {/* PDF Viewer + Details Dialog */}
      <Dialog open={!!viewingRecord} onOpenChange={(open) => { if (!open) { setViewingRecord(null); setIsEditing(false); } }}>
        <DialogContent className="max-w-[95vw] w-[1400px] h-[92vh] flex flex-col p-0 overflow-hidden">
          {/* Header */}
          <DialogHeader className="px-6 py-3 border-b bg-white shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <DialogTitle className="text-base font-bold text-gray-900 truncate">
                  {viewingRecord?.ack_no} — {viewingRecord?.sub_process_name}
                </DialogTitle>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  {viewingRecord?.company?.company_name && (
                    <span className="font-medium">{viewingRecord.company.company_name}</span>
                  )}
                  {viewingRecord?.obligation_name && (
                    <Badge variant="outline" className="text-[10px] font-bold px-1.5 py-0 bg-indigo-50 text-indigo-700 border-indigo-100">
                      {viewingRecord.obligation_name}
                    </Badge>
                  )}
                  {viewingRecord?.ack_date && <span>{viewingRecord.ack_date}</span>}
                  {viewingRecord?.status && (
                    <Badge variant="outline" className={cn("text-[10px] font-bold uppercase px-1.5 py-0", getStatusBadge(viewingRecord.status).bg)}>
                      {getStatusBadge(viewingRecord.status).label}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => {
                    if (viewingRecord?.file_path && isValidUrl(viewingRecord.file_path)) {
                      downloadFile(viewingRecord.file_path, viewingRecord.file_name || `${viewingRecord.ack_no}.pdf`);
                    }
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => viewingRecord?.file_path && window.open(viewingRecord.file_path, "_blank")}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </Button>
              </div>
            </div>
          </DialogHeader>

          {/* Split: Details Panel + PDF Viewer */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Details Panel */}
            <div className="w-[360px] shrink-0 border-r bg-gray-50/50 flex flex-col overflow-hidden">
              {/* Panel header with action buttons */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b bg-white">
                <h3 className="text-sm font-semibold text-gray-900">Record Details</h3>
                <div className="flex items-center gap-1">
                  {!isEditing ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        onClick={startEditing}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs text-green-600 hover:text-green-700 hover:bg-green-50"
                        onClick={handleReExtract}
                        disabled={isExtracting || !viewingRecord?.file_path || !isValidUrl(viewingRecord?.file_path || '')}
                        title={!viewingRecord?.file_path || !isValidUrl(viewingRecord?.file_path || '') ? 'No file URL to extract from' : 'Re-extract details from PDF'}
                      >
                        {isExtracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Re-extract
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={deleteRecord}
                        disabled={isDeleting}
                      >
                        {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        Delete
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600" onClick={cancelEditing}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" className="h-7 gap-1 text-xs bg-blue-600 hover:bg-blue-700" onClick={saveDetails} disabled={isSaving}>
                        {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Save
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <ScrollArea className="flex-1">
                {/* Details as table rows */}
                <table className="w-full text-sm">
                  <tbody>
                    {/* Record Info Section */}
                    <tr className="bg-gray-100/80">
                      <td colSpan={2} className="px-4 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Record Info</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500 w-[120px] align-top">Company</td>
                      <td className="px-4 py-2 text-xs text-gray-900 font-medium">
                        {viewingRecord?.company?.company_name || '-'}
                        {viewingRecord?.company?.kra_pin && (
                          <span className="block text-[10px] text-gray-400 font-mono mt-0.5">{viewingRecord.company.kra_pin}</span>
                        )}
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500">Obligation</td>
                      <td className="px-4 py-2 text-xs text-gray-700">{viewingRecord?.obligation_name || '-'}</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500">Sub Process</td>
                      <td className="px-4 py-2 text-xs text-gray-700">{viewingRecord?.sub_process_name || '-'}</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500">Ack No.</td>
                      <td className="px-4 py-2 text-xs text-gray-700 font-mono">{viewingRecord?.ack_no || '-'}</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500">Ack Date</td>
                      <td className="px-4 py-2 text-xs text-gray-700">{viewingRecord?.ack_date || '-'}</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500">Status</td>
                      <td className="px-4 py-2">
                        {viewingRecord?.status ? (
                          <Badge variant="outline" className={cn("text-[10px] font-bold uppercase px-2 py-0.5", getStatusBadge(viewingRecord.status).bg)}>
                            {getStatusBadge(viewingRecord.status).label}
                          </Badge>
                        ) : '-'}
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500">File</td>
                      <td className="px-4 py-2 text-xs text-gray-700 break-all">{viewingRecord?.file_name || '-'}</td>
                    </tr>

                    {/* Extracted Details Section */}
                    <tr className="bg-gray-100/80">
                      <td colSpan={2} className="px-4 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Extracted Details</td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500 align-middle">Document Title</td>
                      <td className="px-4 py-2">
                        {isEditing ? (
                          <Input
                            value={editForm.document_title}
                            onChange={(e) => setEditForm(f => ({ ...f, document_title: e.target.value }))}
                            className="h-7 text-xs"
                            placeholder="Enter document title..."
                          />
                        ) : (
                          <span className="text-xs text-gray-700">{viewingRecord?.document_title || <span className="text-gray-300 italic">Not set</span>}</span>
                        )}
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500 align-middle">Period From</td>
                      <td className="px-4 py-2">
                        {isEditing ? (
                          <Input
                            value={editForm.period_from}
                            onChange={(e) => setEditForm(f => ({ ...f, period_from: e.target.value }))}
                            className="h-7 text-xs"
                            placeholder="dd/mm/yyyy"
                          />
                        ) : (
                          <span className="text-xs text-gray-700">{viewingRecord?.period_from || <span className="text-gray-300 italic">-</span>}</span>
                        )}
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500 align-middle">Period To</td>
                      <td className="px-4 py-2">
                        {isEditing ? (
                          <Input
                            value={editForm.period_to}
                            onChange={(e) => setEditForm(f => ({ ...f, period_to: e.target.value }))}
                            className="h-7 text-xs"
                            placeholder="dd/mm/yyyy"
                          />
                        ) : (
                          <span className="text-xs text-gray-700">{viewingRecord?.period_to || <span className="text-gray-300 italic">-</span>}</span>
                        )}
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100">
                      <td className="px-4 py-2 text-xs font-medium text-gray-500 align-middle">Total Amount</td>
                      <td className="px-4 py-2">
                        {isEditing ? (
                          <Input
                            value={editForm.total_amount}
                            onChange={(e) => setEditForm(f => ({ ...f, total_amount: e.target.value }))}
                            className="h-7 text-xs"
                            placeholder="0.00"
                          />
                        ) : (
                          <span className={cn("text-xs font-semibold", viewingRecord?.total_amount ? "text-green-700" : "text-gray-300 italic font-normal")}>
                            {viewingRecord?.total_amount || '-'}
                          </span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </ScrollArea>
            </div>

            {/* Right: PDF Viewer */}
            <div className="flex-1 bg-gray-100 overflow-hidden">
              {viewingRecord?.file_path && isValidUrl(viewingRecord.file_path) ? (
                <iframe
                  src={`${viewingRecord.file_path}#toolbar=1`}
                  className="w-full h-full border-0"
                  title={`PDF Viewer - ${viewingRecord.ack_no}`}
                />
              ) : viewingRecord?.file_path && isLocalPath(viewingRecord.file_path) ? (
                <div className="flex-1 flex items-center justify-center h-full">
                  <div className="text-center text-amber-600 max-w-sm">
                    <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-amber-400" />
                    <p className="font-semibold text-base">File saved locally on server</p>
                    <p className="text-sm mt-2 text-gray-500">
                      This file was saved to the server's local filesystem and hasn't been uploaded to cloud storage yet.
                      Re-run the automation to upload files to Supabase Storage.
                    </p>
                    <p className="text-xs mt-3 font-mono text-gray-400 break-all">
                      {viewingRecord.file_path}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center h-full">
                  <div className="text-center text-gray-400">
                    <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No file available</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
