"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase";

type Prize = { id: string; name: string; description: string; image_url: string; weight: number; is_active: boolean };
type Edit = Omit<Prize, "id"> & { id?: string };
const imageTypes: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const maxImageSize = 5 * 1024 * 1024;
const blank: Edit = { name: "", description: "", image_url: "", weight: 1, is_active: true };

export default function GachaPrizeManager() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [items, setItems] = useState<Prize[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!imageFile) { setImagePreview(""); return; }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  function openEdit(value: Edit) { setImageFile(null); setError(""); setEdit({ ...value }); }
  function closeEdit() { setImageFile(null); setEdit(null); }
  function clearFile() { setImageFile(null); if (fileInput.current) fileInput.current.value = ""; }
  function selectImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!imageTypes[file.type] || file.size === 0 || file.size > maxImageSize) {
      clearFile(); setError("PNG, JPG, WEBP, GIF 형식의 5MB 이하 이미지 파일을 선택해주세요."); return;
    }
    setError(""); setImageFile(file);
  }

  const request = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!supabase) throw new Error("로그인이 필요합니다.");
    const { data } = await supabase.auth.getSession();
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` },
      body: JSON.stringify({ action, payload })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "물품 정보를 처리하지 못했습니다.");
    return result;
  }, [supabase]);

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { const data = await request("list_gacha_prizes"); setItems(data.items || []); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "물품을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { void reload(); }, [reload]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!edit || lock.current) return;
    lock.current = true; setSaving(true); setError(""); setNotice("");
    try {
      let imageUrl = edit.image_url;
      if (imageFile) {
        if (!supabase) throw new Error("로그인이 필요합니다.");
        setUploading(true);
        const path = `gacha/${crypto.randomUUID()}.${imageTypes[imageFile.type]}`;
        const { error: uploadError } = await supabase.storage.from("product-images").upload(path, imageFile, {
          contentType: imageFile.type, cacheControl: "3600", upsert: false
        });
        if (uploadError) throw new Error(`이미지를 업로드하지 못했습니다. ${uploadError.message}`);
        imageUrl = supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
        // Keep the uploaded URL on a failed save so retries do not upload again.
        setEdit(current => current ? { ...current, image_url: imageUrl } : current);
        clearFile(); setUploading(false);
      }
      await request("save_gacha_prize", { ...edit, image_url: imageUrl });
      const data = await request("list_gacha_prizes");
      setItems(data.items || []); closeEdit(); setNotice("가챠 물품 정보를 저장했습니다.");
      window.dispatchEvent(new CustomEvent("gacha-prizes-changed"));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "저장하지 못했습니다."); }
    finally { lock.current = false; setSaving(false); setUploading(false); }
  }

  async function remove(item: Prize) {
    if (lock.current || !window.confirm(`‘${item.name}’ 물품을 뽑기 목록에서 삭제할까요?\n이미 뽑힌 아이템과 설명, 하루 뽑기 횟수 기록은 유지됩니다. 삭제는 되돌릴 수 없습니다.`)) return;
    lock.current = true; setSaving(true); setError(""); setNotice("");
    try {
      await request("delete_gacha_prize", { id: item.id });
      setItems(current => current.filter(prize => prize.id !== item.id));
      setNotice(`‘${item.name}’ 물품을 삭제했습니다.`);
      window.dispatchEvent(new CustomEvent("gacha-prizes-changed"));
      const data = await request("list_gacha_prizes");
      setItems(data.items || []);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "삭제하지 못했습니다."); }
    finally { lock.current = false; setSaving(false); }
  }

  const enabled = items.filter(item => item.is_active);
  const totalWeight = enabled.reduce((sum, item) => sum + item.weight, 0);
  const search = query.trim().toLowerCase();
  const visible = items.filter(item =>
    (filter === "all" || item.is_active === (filter === "active")) &&
    `${item.name} ${item.description}`.toLowerCase().includes(search)
  );

  return <section className="panel gacha-admin-list">
    <div className="panel-heading"><div><div className="eyebrow">GACHA ITEMS</div><h2>잡동사니 뽑기 관리</h2><p className="muted">총 {items.length}종 · 등장 중 {enabled.length}종 · 뽑기 횟수 제한이 없습니다.</p></div>
      <div className="gacha-actions"><button type="button" className="button outline" disabled={loading || saving} onClick={() => void reload()}>새로고침</button><button type="button" className="button primary" disabled={saving} onClick={() => openEdit(blank)}>물품 추가</button></div>
    </div>
    <div className="member-list-controls"><label>물품 검색<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="물품 이름 또는 설명"/></label><label>등장 상태<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">전체</option><option value="active">등장 중</option><option value="inactive">등장 중지</option></select></label></div>
    {!edit && error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="gacha-admin-notice" role="status">{notice}</p>}
    {loading ? <p role="status">가챠 물품을 불러오고 있어요…</p> : <div className="gacha-prize-list">
      {visible.map(item => <article key={item.id}><img src={item.image_url} alt={item.name} loading="lazy"/><div><strong>{item.name}</strong><p>{item.description}</p><small>{item.is_active ? `등장 중 · 확률 ${(item.weight / totalWeight * 100).toFixed(2)}% · 비중 ${item.weight}` : "등장 중지 · 뽑기에서 나오지 않아요"}</small></div><div className="gacha-row-actions"><button type="button" className="button outline small" disabled={saving} onClick={() => openEdit(item)}>수정</button><button type="button" className="button small danger-soft" aria-label={`${item.name} 삭제`} disabled={saving} onClick={() => void remove(item)}>삭제</button></div></article>)}
      {!visible.length && <p className="muted">표시할 가챠 물품이 없습니다.</p>}
    </div>}
    {edit && <div className="gacha-backdrop"><section className="gacha-modal gacha-manager" role="dialog" aria-modal="true" aria-labelledby="gacha-edit-title"><button type="button" className="gacha-close" disabled={saving} onClick={closeEdit} aria-label="닫기">×</button><h2 id="gacha-edit-title">{edit.id ? "가챠 물품 수정" : "가챠 물품 추가"}</h2>
      <form onSubmit={save}><fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <label>이름<input required maxLength={80} value={edit.name} onChange={event => setEdit({ ...edit, name: event.target.value })}/></label>
        <label>설명<textarea required rows={4} maxLength={1000} value={edit.description} onChange={event => setEdit({ ...edit, description: event.target.value })}/></label>
        <label>이미지 파일 업로드<input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={selectImage}/><small>PNG, JPG, WEBP, GIF · 최대 5MB. 파일을 선택하면 저장할 때 업로드됩니다.</small></label>
        {imageFile && <div className="gacha-actions"><small>선택한 파일: {imageFile.name}</small><button type="button" className="button outline small" onClick={clearFile}>파일 선택 취소</button></div>}
        <label>또는 이미지 URL<input required={!imageFile} disabled={Boolean(imageFile)} value={edit.image_url} onChange={event => setEdit({ ...edit, image_url: event.target.value })} placeholder="https://…"/></label>
        {(imagePreview || edit.image_url) && <img className="gacha-edit-preview" src={imagePreview || edit.image_url} alt="물품 이미지 미리보기"/>}
        <label>확률 비중<input type="number" required min={1} max={1000000} value={edit.weight} onChange={event => setEdit({ ...edit, weight: Number(event.target.value) })}/><small>비중 2는 비중 1인 물품보다 두 배 자주 나옵니다. 실제 확률은 등장 중인 모든 물품의 비중에 따라 계산됩니다.</small></label>
        <label className="gacha-check"><input type="checkbox" checked={edit.is_active} onChange={event => setEdit({ ...edit, is_active: event.target.checked })}/>뽑기에서 등장</label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="gacha-actions"><button type="button" className="button outline" disabled={saving} onClick={closeEdit}>취소</button><button className="button primary" disabled={saving}>{uploading ? "이미지 업로드 중…" : saving ? "저장 중…" : "저장"}</button></div>
      </fieldset></form>
    </section></div>}
  </section>;
}
