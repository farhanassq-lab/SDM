-- RQ SDM Tahap 8: indikator awal dan penyimpanan penilaian secara transaksional.
-- Prasyarat: skema awal RQ SDM sudah diterapkan dan tabel performance_* tersedia.
-- Aman untuk dijalankan ulang: seed memakai ON CONFLICT, fungsi/policy memakai CREATE OR REPLACE/DROP IF EXISTS.

-- Indikator umum berlaku lintas unit. Bobot adalah bobot relatif, tidak wajib berjumlah tepat 100.
INSERT INTO public.performance_indicators (code, name, description, scope, unit_id, position_id, weight, is_active)
VALUES
  ('GLOBAL_DISCIPLINE', 'Kedisiplinan dan ketepatan waktu', 'Mematuhi jadwal, aturan kerja, dan kesepakatan unit. Kehadiran menjadi salah satu bukti, bukan satu-satunya penentu.', 'global', NULL, NULL, 20, TRUE),
  ('GLOBAL_RESPONSIBILITY', 'Tanggung jawab dan amanah', 'Menuntaskan tanggung jawab penugasan, menjaga amanah, dan dapat diandalkan.', 'global', NULL, NULL, 20, TRUE),
  ('GLOBAL_QUALITY', 'Kualitas pelaksanaan tugas', 'Ketelitian, mutu hasil, dan kesesuaian pekerjaan dengan standar yang ditetapkan.', 'global', NULL, NULL, 20, TRUE),
  ('GLOBAL_TARGETS', 'Pencapaian target kerja', 'Pencapaian target atau rencana kerja yang disepakati untuk periode penilaian.', 'global', NULL, NULL, 20, TRUE),
  ('GLOBAL_TEAMWORK', 'Komunikasi dan kerja sama', 'Komunikasi yang baik, sikap profesional, dan kontribusi positif kepada tim.', 'global', NULL, NULL, 20, TRUE)
ON CONFLICT (code) DO NOTHING;

-- Validasi hubungan penilaian dengan penugasan, kewenangan unit, dan indikator.
-- Semua mutasi lewat RPC ini agar pembuatan review + skor berada dalam satu transaksi.
CREATE OR REPLACE FUNCTION public.save_performance_review(
  p_review_id uuid,
  p_assignment_id uuid,
  p_period_type text,
  p_period_start date,
  p_period_end date,
  p_comments text,
  p_finalize boolean,
  p_scores jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_assignment record;
  v_review record;
  v_review_id uuid;
  v_item jsonb;
  v_indicator record;
  v_indicator_id uuid;
  v_score numeric(2,1);
  v_item_count integer;
  v_distinct_count integer;
  v_expected_count integer;
  v_weight_total numeric := 0;
  v_weighted_total numeric := 0;
  v_final_score numeric(3,2);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Login diperlukan untuk menyimpan penilaian.';
  END IF;
  IF p_period_type NOT IN ('monthly', 'quarterly', 'semester', 'annual') THEN
    RAISE EXCEPTION 'Jenis periode penilaian tidak valid.';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Rentang periode penilaian tidak valid.';
  END IF;
  IF p_scores IS NULL OR jsonb_typeof(p_scores) <> 'array' THEN
    RAISE EXCEPTION 'Daftar skor harus berupa array JSON.';
  END IF;

  SELECT ea.id, ea.employee_id, ea.unit_id, ea.position_id, ea.assignment_title,
         ea.status, ea.start_date, ea.end_date
    INTO v_assignment
    FROM public.employee_assignments ea
   WHERE ea.id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Penugasan tidak ditemukan.';
  END IF;
  IF NOT public.can_manage_unit(v_assignment.unit_id) THEN
    RAISE EXCEPTION 'Akun tidak berwenang mengelola penilaian unit ini.';
  END IF;
  IF v_assignment.start_date > p_period_end OR (v_assignment.end_date IS NOT NULL AND v_assignment.end_date < p_period_start) THEN
    RAISE EXCEPTION 'Periode penilaian berada di luar masa penugasan.';
  END IF;

  SELECT count(*) INTO v_expected_count
    FROM public.performance_indicators pi
   WHERE pi.is_active = TRUE
     AND (
       pi.scope = 'global'
       OR (pi.scope = 'unit' AND pi.unit_id = v_assignment.unit_id)
       OR (pi.scope = 'position' AND pi.position_id = v_assignment.position_id
           AND (pi.unit_id IS NULL OR pi.unit_id = v_assignment.unit_id))
     );
  SELECT count(*), count(DISTINCT value->>'indicator_id')
    INTO v_item_count, v_distinct_count
    FROM jsonb_array_elements(p_scores);
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Minimal satu indikator harus dinilai.';
  END IF;
  IF v_item_count <> v_distinct_count THEN
    RAISE EXCEPTION 'Daftar skor memuat indikator duplikat.';
  END IF;
  IF v_item_count <> v_expected_count THEN
    RAISE EXCEPTION 'Semua indikator aktif yang berlaku untuk penugasan ini harus dinilai. Indikator berlaku: %, skor dikirim: %.', v_expected_count, v_item_count;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_scores)
  LOOP
    IF COALESCE(v_item->>'indicator_id', '') = '' THEN
      RAISE EXCEPTION 'Setiap skor harus memiliki indicator_id.';
    END IF;
    v_indicator_id := (v_item->>'indicator_id')::uuid;
    SELECT pi.id, pi.scope, pi.unit_id, pi.position_id, pi.weight, pi.is_active
      INTO v_indicator
      FROM public.performance_indicators pi
     WHERE pi.id = v_indicator_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Indikator tidak ditemukan.';
    END IF;
    IF v_indicator.is_active IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Indikator sudah nonaktif.';
    END IF;
    IF NOT (
      v_indicator.scope = 'global'
      OR (v_indicator.scope = 'unit' AND v_indicator.unit_id = v_assignment.unit_id)
      OR (v_indicator.scope = 'position' AND v_indicator.position_id = v_assignment.position_id
          AND (v_indicator.unit_id IS NULL OR v_indicator.unit_id = v_assignment.unit_id))
    ) THEN
      RAISE EXCEPTION 'Indikator tidak berlaku untuk unit atau jabatan penugasan ini.';
    END IF;
    IF COALESCE(v_item->>'score', '') !~ '^[1-5](\.0)?$' THEN
      RAISE EXCEPTION 'Nilai indikator harus berada pada skala 1 sampai 5.';
    END IF;
    v_score := (v_item->>'score')::numeric(2,1);
    IF v_score < 1 OR v_score > 5 THEN
      RAISE EXCEPTION 'Nilai indikator harus berada pada skala 1 sampai 5.';
    END IF;
    v_weight_total := v_weight_total + v_indicator.weight;
    v_weighted_total := v_weighted_total + (v_score * v_indicator.weight);
  END LOOP;
  IF v_weight_total <= 0 THEN
    RAISE EXCEPTION 'Total bobot indikator yang berlaku harus lebih dari nol.';
  END IF;
  v_final_score := round(v_weighted_total / v_weight_total, 2);

  IF p_review_id IS NULL THEN
    INSERT INTO public.performance_reviews (
      employee_id, assignment_id, unit_id, period_type, period_start, period_end,
      reviewer_user_id, status, overall_score, comments, finalized_at
    ) VALUES (
      v_assignment.employee_id, v_assignment.id, v_assignment.unit_id, p_period_type,
      p_period_start, p_period_end, v_user_id, 'draft', NULL, NULLIF(trim(p_comments), ''), NULL
    ) RETURNING id INTO v_review_id;
  ELSE
    SELECT * INTO v_review
      FROM public.performance_reviews r
     WHERE r.id = p_review_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Penilaian yang akan diperbarui tidak ditemukan.';
    END IF;
    IF v_review.assignment_id <> v_assignment.id OR v_review.employee_id <> v_assignment.employee_id OR v_review.unit_id <> v_assignment.unit_id THEN
      RAISE EXCEPTION 'Penugasan penilaian tidak boleh diganti saat mengedit draft.';
    END IF;
    IF v_review.status = 'final' AND NOT public.is_hr_admin() THEN
      RAISE EXCEPTION 'Penilaian final terkunci. Hanya Sekjen/Super Admin yang dapat memperbaruinya.';
    END IF;
    UPDATE public.performance_reviews
       SET period_type = p_period_type,
           period_start = p_period_start,
           period_end = p_period_end,
           reviewer_user_id = v_user_id,
           status = 'draft',
           overall_score = NULL,
           comments = NULLIF(trim(p_comments), ''),
           finalized_at = NULL,
           updated_at = now()
     WHERE id = p_review_id
     RETURNING id INTO v_review_id;
  END IF;

  DELETE FROM public.performance_review_scores WHERE review_id = v_review_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_scores)
  LOOP
    INSERT INTO public.performance_review_scores (review_id, indicator_id, score, comments, evidence_url)
    VALUES (
      v_review_id,
      (v_item->>'indicator_id')::uuid,
      (v_item->>'score')::numeric(2,1),
      NULLIF(trim(v_item->>'comments'), ''),
      NULLIF(trim(v_item->>'evidence_url'), '')
    );
  END LOOP;

  UPDATE public.performance_reviews
     SET overall_score = v_final_score,
         status = CASE WHEN COALESCE(p_finalize, FALSE) THEN 'final' ELSE 'draft' END,
         finalized_at = CASE WHEN COALESCE(p_finalize, FALSE) THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = v_review_id;

  RETURN v_review_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_performance_review(uuid, uuid, text, date, date, text, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_performance_review(uuid, uuid, text, date, date, text, boolean, jsonb) TO authenticated;

-- Mutasi dari UI harus melewati RPC tervalidasi. Sekjen/Super Admin tetap dapat
-- melakukan administrasi langsung; kepala unit menyimpan lewat save_performance_review.
DROP POLICY IF EXISTS reviews_insert_scoped ON public.performance_reviews;
DROP POLICY IF EXISTS reviews_update_scoped ON public.performance_reviews;
DROP POLICY IF EXISTS reviews_admin_insert ON public.performance_reviews;
DROP POLICY IF EXISTS reviews_admin_update ON public.performance_reviews;
CREATE POLICY reviews_admin_insert ON public.performance_reviews
  FOR INSERT TO authenticated WITH CHECK (public.is_hr_admin());
CREATE POLICY reviews_admin_update ON public.performance_reviews
  FOR UPDATE TO authenticated USING (public.is_hr_admin()) WITH CHECK (public.is_hr_admin());

DROP POLICY IF EXISTS review_scores_insert_scoped ON public.performance_review_scores;
DROP POLICY IF EXISTS review_scores_update_scoped ON public.performance_review_scores;
DROP POLICY IF EXISTS review_scores_admin_insert ON public.performance_review_scores;
DROP POLICY IF EXISTS review_scores_admin_update ON public.performance_review_scores;
CREATE POLICY review_scores_admin_insert ON public.performance_review_scores
  FOR INSERT TO authenticated WITH CHECK (public.is_hr_admin());
CREATE POLICY review_scores_admin_update ON public.performance_review_scores
  FOR UPDATE TO authenticated USING (public.is_hr_admin()) WITH CHECK (public.is_hr_admin());

-- Policy read dan delete admin yang sudah ada dipertahankan.
