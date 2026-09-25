'use client';

import { Button } from '@/components/ui/button';
import { FileSpreadsheet } from 'lucide-react';

export function ExportButton({ data, disabled }: { data: any, disabled?: boolean }) {
  const handleExportExcel = async () => {
    if (!data?.metrics) return;

    const XLSX = await import('xlsx');
    // Create a comprehensive workbook with multiple sheets
    const wb = XLSX.utils.book_new();

    // 1. Executive Metrics Sheet
    const metricsData = [
      { Metric: 'Total Applications', Value: data.metrics.totalApplications ?? 0 },
      { Metric: 'New This Month', Value: data.metrics.newThisMonth ?? 0 },
      { Metric: 'Pending Applications', Value: data.metrics.pending ?? 0 },
      { Metric: 'Approved Applications', Value: data.metrics.approved ?? 0 },
      { Metric: 'Rejected Applications', Value: data.metrics.rejected ?? 0 },
      { Metric: 'Open Shortfalls', Value: data.metrics.shortfall ?? 0 },
      { Metric: 'Fees Generated (INR)', Value: data.metrics.feesGenerated ?? 0 },
      { Metric: 'Fees Collected (INR)', Value: data.metrics.feesCollected ?? 0 },
      { Metric: 'Average Processing Time (Days)', Value: data.metrics.averageProcessingTime ?? 0 },
      { Metric: 'SLA Breach Percentage', Value: `${data.metrics.slaBreachPercent ?? 0}%` },
    ];
    const wsMetrics = XLSX.utils.json_to_sheet(metricsData);
    XLSX.utils.book_append_sheet(wb, wsMetrics, 'Executive Metrics');

    // 2. Application Trend Sheet
    if (data.trend?.length) {
      const wsTrend = XLSX.utils.json_to_sheet(data.trend.map((t: any) => ({
        Date: t.date,
        'Applications Filed': t.count,
      })));
      XLSX.utils.book_append_sheet(wb, wsTrend, 'Application Trend');
    }

    // 3. Status Distribution Sheet
    if (data.distribution?.length) {
      const wsDist = XLSX.utils.json_to_sheet(data.distribution.map((d: any) => ({
        Status: d.name,
        Count: d.value,
      })));
      XLSX.utils.book_append_sheet(wb, wsDist, 'Status Distribution');
    }

    // 4. Officer Workload Sheet
    if (data.workload?.length) {
      const wsWorkload = XLSX.utils.json_to_sheet(data.workload.map((w: any) => ({
        'Officer Name': w.officer,
        'Pending Tasks': w.pendingTasks,
      })));
      XLSX.utils.book_append_sheet(wb, wsWorkload, 'Officer Workload');
    }

    XLSX.writeFile(wb, `BBAS_Analytics_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleExportExcel}
      disabled={disabled}
      className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-medium border-emerald-600"
    >
      <FileSpreadsheet className="size-4 text-emerald-200" />
      Export to Excel (.xlsx)
    </Button>
  );
}
