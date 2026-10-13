import type { InventoryItem } from "@/lib/types";

export type GachaPrize = { id: string; name: string; description: string; image_url: string; is_active: boolean };
export type GachaCollectionRecord = { prize_key: string; name: string; image_url: string | null; description: string; received_count: number; first_received_at: string; last_received_at: string };
export type AlbumEntry = { key: string; name: string; image_url: string | null; description: string; collected: boolean; retired: boolean; received: number; firstReceived: string | null; owned: InventoryItem[] };
export function isGachaItem(item: InventoryItem) { return Boolean(item.gacha_collection_key || item.gacha_prize_id || item.gacha_description != null); }

export function buildGachaAlbum(prizes: GachaPrize[], records: GachaCollectionRecord[], inventory: InventoryItem[]): AlbumEntry[] {
  const entries = new Map<string, AlbumEntry>();
  for (const prize of prizes.filter(prize => prize.is_active)) entries.set(prize.id, {
    key: prize.id, name: prize.name, image_url: prize.image_url, description: prize.description,
    collected: false, retired: false, received: 0, firstReceived: null, owned: []
  });
  for (const record of records) {
    const existing = entries.get(record.prize_key);
    entries.set(record.prize_key, { key: record.prize_key, name: record.name, image_url: record.image_url,
      description: record.description, collected: true, retired: !existing, received: record.received_count,
      firstReceived: record.first_received_at, owned: [] });
  }
  for (const item of inventory.filter(isGachaItem)) {
    const key = item.gacha_collection_key || item.gacha_prize_id || `snapshot:${item.product_name}|${item.product_image_url || ""}`;
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, name: item.product_name, image_url: item.product_image_url, description: item.gacha_description || "",
        collected: true, retired: true, received: 0, firstReceived: item.purchased_at, owned: [] };
      entries.set(key, entry);
    }
    entry.collected = true;
    if (!entry.received) entry.received = 1;
    if (!entry.firstReceived) entry.firstReceived = item.purchased_at;
    if (!item.used_at) entry.owned.push(item);
  }
  return Array.from(entries.values());
}
