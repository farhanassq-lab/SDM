// PostgREST membatasi satu respons (default 1000 baris) tanpa pemberitahuan.
// Helper ini mengambil semua halaman secara berurutan agar data tidak terpotong diam-diam.
type PageResult<T> = { data: T[] | null; error: { message: string } | null }

export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
  maxPages = 100,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = []
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize
    const { data, error } = await buildPage(from, from + pageSize - 1)
    if (error) return { data: all, error }
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < pageSize) return { data: all, error: null }
  }
  return { data: all, error: { message: `Data melebihi ${maxPages * pageSize} baris; hubungi pengembang.` } }
}

/** Memecah daftar panjang menjadi potongan kecil untuk filter .in() agar URL tidak terlalu panjang. */
export function chunk<T>(items: T[], size = 80): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
