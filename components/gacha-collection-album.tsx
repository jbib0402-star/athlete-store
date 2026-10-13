"use client";

import { useMemo, useState } from "react";
import { Album, Search, Sparkles } from "lucide-react";
import GachaItemDialog from "@/components/gacha-item-dialog";
import { buildGachaAlbum, type AlbumEntry, type GachaPrize, type GachaCollectionRecord } from "@/lib/gacha-collection";
import type { InventoryItem } from "@/lib/types";

export default function GachaCollectionAlbum({ inventory, prizes, records, onUse }: {
  inventory: InventoryItem[]; prizes: GachaPrize[]; records: GachaCollectionRecord[]; onUse: (item: InventoryItem) => void;
}) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AlbumEntry | null>(null);
  const entries = useMemo(() => buildGachaAlbum(prizes, records, inventory), [prizes, records, inventory]);
  const collected = entries.filter(entry => entry.collected).length;
  const owned = entries.reduce((sum, entry) => sum + entry.owned.length, 0);
  const progress = entries.length ? Math.round(collected / entries.length * 100) : 0;
  const visible = entries.filter(entry => (!query.trim() || `${entry.name} ${entry.description}`.toLowerCase().includes(query.trim().toLowerCase())) &&
    (filter === "all" || filter === "collected" && entry.collected || filter === "missing" && !entry.collected || filter === "owned" && entry.owned.length > 0));

  return <section className="gacha-album" aria-labelledby="gacha-album-title">
    <header className="gacha-album-heading"><div><span className="gacha-kicker">MY LITTLE COLLECTION</span><h2 id="gacha-album-title"><Album size={25}/>잡동사니 수집 앨범</h2><p>한 장씩 채워 가는 나만의 잡동사니 도감. 사용하거나 선물해도 수집 기록은 남아요.</p></div><div className="gacha-album-summary"><strong>{collected}<small> / {entries.length}종</small></strong><span>현재 보유 {owned}개</span></div></header>
    <div className="gacha-album-progress" role="progressbar" aria-label="잡동사니 수집률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div style={{ width: `${progress}%` }}/></div>
    <div className="gacha-album-controls"><div className="gacha-album-tabs" aria-label="앨범 필터">{[["all", "전체"], ["collected", "모은 물건"], ["missing", "아직 못 모음"], ["owned", "현재 보유"]].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><label className="search-box"><Search size={16}/><input type="search" aria-label="수집 물건 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="물건 검색"/></label></div>
    <div className="gacha-sticker-grid">{visible.map(entry => <article key={entry.key} className={`gacha-sticker-card ${entry.collected ? "collected" : "missing"}`}>
      <button type="button" className="gacha-sticker-button" disabled={!entry.collected} aria-label={`${entry.name} ${entry.collected ? "자세히 보기" : "미수집"}`} onClick={() => entry.owned.length ? onUse(entry.owned[0]) : setSelected(entry)}>
        <div className="gacha-sticker-art">{entry.collected ? entry.image_url ? <img src={entry.image_url} alt="" loading="lazy"/> : <Sparkles size={40}/> : <span className="gacha-sticker-question">?</span>}{entry.owned.length > 0 && <b className="gacha-sticker-count">×{entry.owned.length}</b>}</div>
        <strong>{entry.name}</strong><span>{!entry.collected ? "아직 못 모았어요" : entry.owned.length ? `보유 ${entry.owned.length}개 · 보기 / 선물` : "수집 완료 · 앨범에 보관 중"}</span>
      </button>
      {entry.collected && <small>누적 획득 {entry.received}개{entry.retired ? " · 지난 물품" : ""}</small>}
    </article>)}</div>
    {!visible.length && <p className="gacha-album-empty">{entries.length ? "조건에 맞는 물건이 없어요." : "첫 잡동사니를 뽑아 앨범을 채워 보세요!"}</p>}
    <p className="gacha-album-footnote">중복 물건은 한 칸에 모아 표시해요. 현재 보유 중인 물건만 선물·사용할 수 있으며, 보관함 칸을 차지해요.</p>
    {selected && <GachaItemDialog readOnly item={{ id: selected.key, product_name: selected.name, product_image_url: selected.image_url, gacha_description: selected.description }} onClose={() => setSelected(null)}/>}
  </section>;
}
