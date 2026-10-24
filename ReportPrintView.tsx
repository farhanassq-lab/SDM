import "./ReportPrintView.css";

export type ReportStat = {
  label: string;
  value: string | number;
};

export type AttendanceReportRow = {
  employeeName: string;
  unitName?: string;
  assignmentTitle?: string;
  workDays: number | null;
  present: number | null;
  late: number | null;
  excused: number | null;
  sick: number | null;
  leave: number | null;
  alpha: number | null;
  lateMinutes: number | null;
  percentText: string;
  status: string;
};

export type PerformanceReportRow = {
  employeeName: string;
  unitName?: string;
  assignmentTitle?: string;
  periodLabel?: string;
  score?: number | string | null;
  status?: string;
  notes?: string | null;
};

export type UnitSummaryReportRow = {
  unit: string;
  activeAssignments: number;
  filledAssignments: number;
  workDays: number;
  hadir: number;
  terlambat: number;
  sakit: number;
  cuti: number;
  izin: number;
  alpa: number;
  totalLateMinutes: number;
  finalReviews: number;
  averageScore: number | null;
};

export type ReportPrintViewProps = {
  title: string;
  institutionName?: string;
  periodLabel: string;
  unitName?: string;
  generatedAt?: string;
  summaryStats?: ReportStat[];
  attendanceRows?: AttendanceReportRow[];
  performanceRows?: PerformanceReportRow[];
  unitSummaryRows?: UnitSummaryReportRow[];
  logoSrc?: string;
  showPerformanceColumns?: boolean;
};

const formatDateTime = (value?: string) => {
  if (!value) return new Date().toLocaleString("id-ID");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("id-ID");
};

const display = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

export default function ReportPrintView({
  title,
  institutionName = "Dayah Ruhul Qurani",
  periodLabel,
  unitName = "Semua Unit",
  generatedAt,
  summaryStats = [],
  attendanceRows = [],
  performanceRows = [],
  unitSummaryRows = [],
  logoSrc = "/rq-logo.png",
  showPerformanceColumns = true,
}: ReportPrintViewProps) {
  const handlePrint = () => window.print();

  return (
    <section className="rq-report-page">
      <div className="rq-report-toolbar no-print">
        <div>
          <strong>Pratinjau laporan</strong>
          <p>Gunakan cetak browser, lalu pilih “Save as PDF” untuk menyimpan PDF.</p>
        </div>
        <button type="button" onClick={handlePrint} className="rq-print-button">
          Cetak / Simpan PDF
        </button>
      </div>

      <article className="rq-report-sheet">
        <header className="rq-report-header">
          <div className="rq-report-brand">
            {logoSrc ? (
              <img className="rq-report-logo" src={logoSrc} alt="Logo Dayah Ruhul Qurani" />
            ) : null}
            <div>
              <h1>{institutionName}</h1>
              <p>Sistem Monitoring Sumber Daya Manusia</p>
            </div>
          </div>
          <div className="rq-report-heading">
            <h2>{title}</h2>
            <p>Periode: {periodLabel}</p>
            <p>Unit: {unitName}</p>
          </div>
        </header>

        {summaryStats.length > 0 && (
          <section className="rq-report-summary">
            {summaryStats.map((stat, index) => (
              <div className="rq-report-stat" key={`${stat.label}-${index}`}>
                <span>{stat.label}</span>
                <strong>{display(stat.value)}</strong>
              </div>
            ))}
          </section>
        )}

        {unitSummaryRows.length > 0 && (
          <section className="rq-report-section">
            <h3>Ringkasan per Unit</h3>
            <div className="rq-table-wrap">
              <table className="rq-summary-table">
                <thead><tr><th>No.</th><th>Unit</th><th>Rekap terisi</th><th>Hari wajib</th><th>Hadir</th><th>Terlambat</th><th>Sakit</th><th>Izin</th><th>Cuti</th><th>Alpa</th><th>Menit terlambat</th>{showPerformanceColumns && <><th>Review final</th><th>Rata-rata nilai</th></>}</tr></thead>
                <tbody>{unitSummaryRows.map((row, index) => (
                  <tr key={`${row.unit}-${index}`}><td>{index + 1}</td><td>{row.unit}</td><td>{row.filledAssignments}/{row.activeAssignments}</td><td>{row.workDays}</td><td>{row.hadir}</td><td>{row.terlambat}</td><td>{row.sakit}</td><td>{row.izin}</td><td>{row.cuti}</td><td>{row.alpa}</td><td>{row.totalLateMinutes}</td>{showPerformanceColumns && <><td>{row.finalReviews}</td><td>{row.averageScore === null ? "—" : Number(row.averageScore).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></>}</tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        )}

        {attendanceRows.length > 0 && (
          <section className="rq-report-section">
            <h3>Rekap Absensi Bulanan</h3>
            <div className="rq-table-wrap">
              <table className="rq-attendance-table">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Nama SDM</th>
                    <th>Unit</th>
                    <th>Penugasan</th>
                    <th>Wajib</th>
                    <th>Hadir</th>
                    <th>Telat</th>
                    <th>Izin</th>
                    <th>Sakit</th>
                    <th>Cuti</th>
                    <th>Alpa</th>
                    <th>% Hadir</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceRows.map((row, index) => (
                    <tr key={`${row.employeeName}-${row.unitName ?? ""}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{row.employeeName}</td>
                      <td>{display(row.unitName)}</td>
                      <td>{display(row.assignmentTitle)}</td>
                      <td>{display(row.workDays)}</td>
                      <td>{display(row.present)}</td>
                      <td>{display(row.late)}</td>
                      <td>{display(row.excused)}</td>
                      <td>{display(row.sick)}</td>
                      <td>{display(row.leave)}</td>
                      <td>{display(row.alpha)}</td>
                      <td>{row.percentText}</td>
                      <td>{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rq-report-count">Jumlah penugasan: {attendanceRows.length}</p>
          </section>
        )}

        {performanceRows.length > 0 && (
          <section className="rq-report-section">
            <h3>Rekap Penilaian Kinerja</h3>
            <div className="rq-table-wrap">
              <table className="rq-performance-table">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Nama SDM</th>
                    <th>Unit</th>
                    <th>Penugasan</th>
                    <th>Periode</th>
                    <th>Nilai</th>
                    <th>Status</th>
                    <th>Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {performanceRows.map((row, index) => (
                    <tr key={`${row.employeeName}-${row.periodLabel ?? ""}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{row.employeeName}</td>
                      <td>{display(row.unitName)}</td>
                      <td>{display(row.assignmentTitle)}</td>
                      <td>{display(row.periodLabel)}</td>
                      <td>{display(row.score)}</td>
                      <td>{display(row.status)}</td>
                      <td>{display(row.notes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rq-report-count">Jumlah baris penilaian: {performanceRows.length}</p>
          </section>
        )}

        {summaryStats.length === 0 && unitSummaryRows.length === 0 && attendanceRows.length === 0 && performanceRows.length === 0 && (
          <div className="rq-report-empty">
            Belum ada data untuk ditampilkan. Pilih periode/unit dan hubungkan data laporan sebelum mencetak.
          </div>
        )}

        <footer className="rq-report-footer">
          <span>Dibuat pada: {formatDateTime(generatedAt)}</span>
          <span>Dokumen administrasi internal — Dayah Ruhul Qurani</span>
        </footer>
      </article>
    </section>
  );
}
