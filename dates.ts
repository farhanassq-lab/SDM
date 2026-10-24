// Semua tanggal "hari ini" mengikuti zona waktu WIB (Asia/Jakarta), bukan UTC.
// toISOString() memakai UTC sehingga antara 00.00 dan 07.00 WIB hasilnya masih tanggal kemarin.
const wibFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Tanggal hari ini di WIB, format YYYY-MM-DD. */
export const todayWib = (): string => wibFormatter.format(new Date())

/** Bulan berjalan di WIB, format YYYY-MM. */
export const currentMonthWib = (): string => todayWib().slice(0, 7)

const pad = (n: number) => String(n).padStart(2, '0')

/** Hari pertama, hari terakhir, dan jumlah hari dari bulan berformat YYYY-MM. */
export function monthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const days = new Date(year, monthNumber, 0).getDate()
  return { first: `${month}-01`, last: `${month}-${pad(days)}`, days }
}

/** Jumlah hari dalam satu bulan yang bukan hari libur mingguan (default: bukan Minggu). */
export function countWorkingDays(month: string, offWeekdays: number[] = [0]): number {
  const [year, monthNumber] = month.split('-').map(Number)
  const days = new Date(year, monthNumber, 0).getDate()
  let total = 0
  for (let day = 1; day <= days; day += 1) {
    if (!offWeekdays.includes(new Date(year, monthNumber - 1, day).getDay())) total += 1
  }
  return total
}
