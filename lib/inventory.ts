import type { SupabaseClient } from "@supabase/supabase-js";
import type { InventoryItem } from "@/lib/types";

// Page through the API's response limit; storage has no item-count ceiling.
export async function fetchAllInventory(client: SupabaseClient, userId: string) {
  const rows: InventoryItem[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("inventory").select("*").eq("user_id", userId)
      .order("purchased_at", { ascending: false }).order("id")
      .range(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []) as InventoryItem[]);
    if ((data || []).length < pageSize) return { data: rows, error: null };
  }
}
