"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase";

type ShopProduct = {
  id: string;
  name: string;
  price: number;
};

type GiftMember = {
  id: string;
  username: string;
  character_name: string;
  sport: string | null;
};

type GiftInventory = {
  id: string;
  product_name: string;
  purchased_at: string;
  used_at: string | null;
  gift_from_name: string | null;
};

export default function StoreActionEnhancer() {
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [members, setMembers] = useState<GiftMember[]>([]);
  const [inventory, setInventory] = useState<GiftInventory[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [giftProduct, setGiftProduct] = useState<ShopProduct | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [recipientQuery, setRecipientQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const showNotice = useCallback((text: string, error = false) => {
    setNotice({ text, error });
    window.setTimeout(() => setNotice(null), 3200);
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id || null;
    setCurrentUserId(userId);
    if (!userId) return;

    const [productsRes, membersRes, inventoryRes] = await Promise.all([
      supabase.from("products").select("id,name,price").eq("is_active", true),
      supabase.from("profiles").select("id,username,character_name,sport").order("character_name"),
      supabase.from("inventory").select("id,product_name,purchased_at,used_at,gift_from_name").eq("user_id", userId).order("purchased_at", { ascending: false })
    ]);

    if (productsRes.data) setProducts(productsRes.data as ShopProduct[]);
    if (membersRes.data) setMembers(membersRes.data as GiftMember[]);
    if (inventoryRes.data) setInventory(inventoryRes.data as GiftInventory[]);
  }, [supabase]);

  useEffect(() => {
    loadData();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange(() => loadData());
    return () => data.subscription.unsubscribe();
  }, [supabase, loadData]);

  const availableMembers = useMemo(
    () => members.filter(member => member.id !== currentUserId),
    [members, currentUserId]
  );

  const recipientSuggestions = useMemo(() => {
    const raw = recipientQuery.trim().toLowerCase();
    if (!raw) return [];
    const usernameQuery = raw.replace(/^@/, "");
    return availableMembers
      .filter(member =>
        member.character_name.toLowerCase().includes(raw) ||
        member.username.toLowerCase().includes(usernameQuery)
      )
      .slice(0, 8);
  }, [recipientQuery, availableMembers]);

  const buyNow = useCallback(async (product: ShopProduct) => {
    if (!supabase) return;
    if (!window.confirm(`${product.name}을(를) 바로 구매할까요?\n구매 즉시 내 보관함으로 이동합니다.`)) return;
    const { error } = await supabase.rpc("purchase_product", { target_product_id: product.id });
    if (error) return showNotice(error.message, true);
    showNotice("바로 구매가 완료되었습니다.");
    window.setTimeout(() => window.location.reload(), 450);
  }, [supabase, showNotice]);

  const openGift = useCallback((product: ShopProduct) => {
    setGiftProduct(product);
    setRecipientId("");
    setRecipientQuery("");
  }, []);

  const chooseRecipient = useCallback((member: GiftMember) => {
    setRecipientId(member.id);
    setRecipientQuery(member.character_name);
  }, []);

  const sendGift = useCallback(async () => {
    if (!supabase || !giftProduct) return;

    let recipient = recipientId ? availableMembers.find(member => member.id === recipientId) : undefined;
    if (!recipient) {
      const raw = recipientQuery.trim();
      const rawLower = raw.toLowerCase();
      const usernameQuery = rawLower.replace(/^@/, "");
      const exactMatches = availableMembers.filter(member =>
        member.character_name.trim().toLowerCase() === rawLower ||
        member.username.toLowerCase() === usernameQuery
      );

      if (exactMatches.length === 1) recipient = exactMatches[0];
      else if (exactMatches.length > 1) return showNotice("같은 닉네임이 있습니다. @아이디를 입력해주세요.", true);
      else return showNotice("일치하는 캐릭터를 찾을 수 없습니다. 닉네임이나 @아이디를 확인해주세요.", true);
    }

    setSending(true);
    const { error } = await supabase.rpc("gift_product", {
      target_product_id: giftProduct.id,
      recipient_id: recipient.id
    });
    setSending(false);
    if (error) return showNotice(error.message, true);
    setGiftProduct(null);
    setRecipientId("");
    setRecipientQuery("");
    showNotice(`${recipient.character_name}에게 선물을 보냈습니다.`);
    window.setTimeout(() => window.location.reload(), 450);
  }, [supabase, giftProduct, recipientId, recipientQuery, availableMembers, showNotice]);

  useEffect(() => {
    if (!products.length) return;

    function enhanceProductCards() {
      document.querySelectorAll<HTMLElement>(".product-card").forEach(card => {
        if (card.dataset.storeActionsEnhanced === "true") return;
        const productName = card.querySelector("h3")?.textContent?.trim();
        const product = products.find(item => item.name === productName);
        if (!product) return;
        const body = card.querySelector<HTMLElement>(".product-body");
        const originalAdd = card.querySelector<HTMLButtonElement>(".icon-button.dark");
        if (!body || !originalAdd) return;

        card.dataset.storeActionsEnhanced = "true";
        const actions = document.createElement("div");
        actions.className = "store-extra-actions";

        const cartButton = document.createElement("button");
        cartButton.type = "button";
        cartButton.className = "store-action-button cart";
        cartButton.textContent = "장바구니 담기";
        cartButton.disabled = originalAdd.disabled;
        cartButton.addEventListener("click", () => originalAdd.click());

        const buyButton = document.createElement("button");
        buyButton.type = "button";
        buyButton.className = "store-action-button buy";
        buyButton.textContent = "바로 구매";
        buyButton.disabled = originalAdd.disabled;
        buyButton.addEventListener("click", () => buyNow(product));

        const giftButton = document.createElement("button");
        giftButton.type = "button";
        giftButton.className = "store-action-button gift";
        giftButton.textContent = "선물하기";
        giftButton.disabled = originalAdd.disabled;
        giftButton.addEventListener("click", () => openGift(product));

        actions.append(cartButton, buyButton, giftButton);
        body.append(actions);
      });
    }

    function annotateGiftInventory() {
      const activeInventory = inventory.filter(item => !item.used_at);
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".inventory-card"));
      cards.forEach((card, index) => {
        card.querySelector(".gift-received-label")?.remove();
        const item = activeInventory[index];
        if (!item?.gift_from_name) return;
        const label = document.createElement("span");
        label.className = "gift-received-label";
        label.textContent = `${item.gift_from_name}에게 선물 받음`;
        const button = card.querySelector("button");
        if (button) card.insertBefore(label, button);
        else card.append(label);
      });
    }

    let queued = false;
    const scan = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        enhanceProductCards();
        annotateGiftInventory();
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, [products, inventory, buyNow, openGift]);

  if (!supabase) return null;

  return <>
    {notice && <div className={`store-action-notice ${notice.error ? "error" : ""}`}>{notice.text}</div>}
    {giftProduct && <div className="gift-modal-backdrop" onMouseDown={() => !sending && setGiftProduct(null)}>
      <section className="gift-modal" role="dialog" aria-modal="true" aria-labelledby="gift-modal-title" onMouseDown={event => event.stopPropagation()}>
        <div className="gift-modal-eyebrow">GIFT ITEM</div>
        <h2 id="gift-modal-title">{giftProduct.name} 선물하기</h2>
        <p>상품 가격 <strong>{giftProduct.price.toLocaleString("ko-KR")} P</strong>가 내 포인트에서 차감되고 상대방 보관함으로 바로 지급됩니다.</p>
        <label>선물 받을 캐릭터
          <div className="gift-recipient-search">
            <input
              value={recipientQuery}
              onChange={event => { setRecipientQuery(event.target.value); setRecipientId(""); }}
              placeholder="닉네임 또는 @아이디 입력"
              autoComplete="off"
              disabled={sending}
            />
            {recipientQuery.trim() && !recipientId && <div className="gift-suggestions">
              {recipientSuggestions.length ? recipientSuggestions.map(member => <button type="button" key={member.id} onClick={() => chooseRecipient(member)}>
                <strong>{member.character_name}</strong>
                <span>@{member.username}{member.sport ? ` · ${member.sport}` : ""}</span>
              </button>) : <div className="gift-no-result">일치하는 캐릭터가 없습니다.</div>}
            </div>}
          </div>
        </label>
        {recipientId && <div className="gift-selected">받는 사람: <strong>{availableMembers.find(member => member.id === recipientId)?.character_name}</strong></div>}
        <div className="gift-modal-actions">
          <button type="button" className="button ghost" disabled={sending} onClick={() => setGiftProduct(null)}>취소</button>
          <button type="button" className="button primary" disabled={!recipientQuery.trim() || sending} onClick={sendGift}>{sending ? "선물 중…" : "선물 보내기"}</button>
        </div>
      </section>
    </div>}
  </>;
}
