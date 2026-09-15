"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft, BadgeCheck, CalendarCheck, ChevronRight, ClipboardList, Dumbbell,
  Gift, History, LayoutDashboard, LockKeyhole, LogOut, Menu, Minus, PackageCheck,
  Plus, Search, Settings, ShieldCheck, ShoppingBag, ShoppingCart, Store, Trash2,
  UserRound, UsersRound, WalletCards, X
} from "lucide-react";
import { getSupabaseBrowser, hasSupabaseConfig, usernameToEmail } from "@/lib/supabase";
import {
  AppSettings, CartItem, CATEGORIES, DEFAULT_SETTINGS, InventoryItem, PointLog, Product, Profile
} from "@/lib/types";

type View = "shop" | "locker" | "activity" | "transfer" | "profile" | "admin";
type Toast = { id: number; text: string; tone: "success" | "error" };

const demoProducts: Product[] = [
  { id: "p1", name: "스포츠 드링크", description: "훈련 후 수분 보충을 위한 시원한 이온 음료.", price: 300, image_url: null, category: "음료", stock: null, purchase_limit: null, is_active: true, is_consumable: true, created_at: new Date().toISOString() },
  { id: "p2", name: "프로틴 바", description: "식사 사이에 가볍게 챙기는 고단백 간식.", price: 450, image_url: null, category: "식품", stock: 18, purchase_limit: 3, is_active: true, is_consumable: true, created_at: new Date().toISOString() },
  { id: "p3", name: "귤 아이스크림", description: "매점 냉동고 맨 아래 칸의 인기 상품.", price: 600, image_url: null, category: "식품", stock: 7, purchase_limit: null, is_active: true, is_consumable: true, created_at: new Date().toISOString() },
  { id: "p4", name: "세탁실 우선권", description: "혼잡 시간에도 세탁기 한 대를 우선 사용할 수 있다.", price: 1000, image_url: null, category: "생활용품", stock: null, purchase_limit: 1, is_active: true, is_consumable: true, created_at: new Date().toISOString() },
  { id: "p5", name: "야간 외출권", description: "운영진 확인 후 지정된 시간 동안 외출할 수 있다.", price: 3000, image_url: null, category: "티켓", stock: 4, purchase_limit: 1, is_active: true, is_consumable: true, created_at: new Date().toISOString() },
  { id: "p6", name: "컨디션 회복 키트", description: "테이핑과 쿨링 패치가 들어 있는 응급 회복 세트.", price: 850, image_url: null, category: "훈련용품", stock: 12, purchase_limit: 2, is_active: true, is_consumable: true, created_at: new Date().toISOString() }
];

const demoProfile: Profile = {
  id: "demo-user", username: "athlete01", character_name: "서연후", sport: "야구",
  avatar_url: null, points: 3250, role: "admin", locker_limit: 20, created_at: new Date().toISOString()
};

const demoLogs: PointLog[] = [
  { id: "l1", amount: 150, type: "training", description: "훈련 완료", created_at: new Date().toISOString() },
  { id: "l2", amount: 100, type: "attendance", description: "일일 출석", created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: "l3", amount: -300, type: "purchase", description: "스포츠 드링크 구매", created_at: new Date(Date.now() - 86400000).toISOString() }
];

function formatPoints(value: number) { return new Intl.NumberFormat("ko-KR").format(value); }
function formatDate(value: string, time = false) {
  return new Intl.DateTimeFormat("ko-KR", time ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" } : { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
function productGlyph(category: string) {
  if (category === "음료") return "DRINK";
  if (category === "식품") return "FOOD";
  if (category === "티켓") return "PASS";
  if (category === "훈련용품") return "GEAR";
  return "ITEM";
}

function ToastStack({ items }: { items: Toast[] }) {
  return <div className="toast-stack" aria-live="polite">{items.map(item => <div key={item.id} className={`toast ${item.tone}`}><BadgeCheck size={18}/>{item.text}</div>)}</div>;
}

function ConfirmDialog({ title, detail, confirmLabel = "확인", danger = false, onCancel, onConfirm }: { title: string; detail: string; confirmLabel?: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
    <div className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-icon"><ShieldCheck size={25}/></div>
      <h2 id="confirm-title">{title}</h2><p>{detail}</p>
      <div className="modal-actions"><button className="button ghost" onClick={onCancel}>취소</button><button className={`button ${danger ? "danger" : "primary"}`} onClick={onConfirm}>{confirmLabel}</button></div>
    </div>
  </div>;
}

function Login({ onDemo }: { onDemo: () => void }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const configured = hasSupabaseConfig();
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setLoading(true);
    const supabase = getSupabaseBrowser();
    if (!supabase) { onDemo(); return; }
    const { error: authError } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (authError) setError("아이디 또는 비밀번호를 확인해주세요.");
    setLoading(false);
  }
  return <main className="login-page">
    <section className="login-brand">
      <div className="brand-mark"><Dumbbell size={27}/></div>
      <div className="eyebrow light">NATIONAL TRAINING CENTER · INTERNAL SERVICE</div>
      <h1>선수들의 하루를<br/>한곳에서 관리합니다.</h1>
      <p>매점 이용부터 출석, 훈련 보상과 포인트 양도까지. 선수촌 생활에 필요한 기능을 하나의 내부 시스템으로 묶었습니다.</p>
      <div className="login-metrics"><span><b>24H</b> STORE</span><span><b>DAILY</b> TRAINING</span><span><b>SAFE</b> LEDGER</span></div>
    </section>
    <section className="login-panel">
      <div className="login-card">
        <div className="eyebrow">ATHLETE ACCESS</div><h2>선수 계정 로그인</h2><p className="muted">운영진에게 전달받은 아이디와 비밀번호를 입력해주세요.</p>
        <form onSubmit={submit}>
          <label>아이디<input value={username} onChange={e => setUsername(e.target.value)} placeholder="athlete01" autoComplete="username" required/></label>
          <label>비밀번호<input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="••••••••" autoComplete="current-password" required/></label>
          {error && <p className="form-error">{error}</p>}
          <button className="button primary wide" disabled={loading}>{loading ? "확인 중…" : "로그인"}<ChevronRight size={18}/></button>
        </form>
        {!configured && <button className="demo-link" onClick={onDemo}>데모 화면 둘러보기</button>}
        <p className="security-note"><LockKeyhole size={14}/> 계정 발급과 비밀번호 초기화는 운영진에게 문의해주세요.</p>
      </div>
    </section>
  </main>;
}

function ProductCard({ product, currency, onAdd }: { product: Product; currency: string; onAdd: (product: Product) => void }) {
  const soldOut = product.stock === 0;
  return <article className={`product-card ${soldOut ? "sold-out" : ""}`}>
    <div className="product-visual">
      {product.image_url ? <img src={product.image_url} alt=""/> : <div className="product-placeholder"><span>{productGlyph(product.category)}</span><ShoppingBag size={42}/></div>}
      <div className="category-chip">{product.category}</div>{soldOut && <div className="soldout-label">SOLD OUT</div>}
    </div>
    <div className="product-body"><div><h3>{product.name}</h3><p>{product.description}</p></div>
      <div className="product-meta"><div><strong>{formatPoints(product.price)} {currency}</strong><small>{product.stock == null ? "상시 판매" : `남은 수량 ${product.stock}`}{product.purchase_limit ? ` · 1인 ${product.purchase_limit}개` : ""}</small></div>
        <button className="icon-button dark" onClick={() => onAdd(product)} disabled={soldOut} aria-label={`${product.name} 장바구니 담기`}><Plus size={21}/></button>
      </div>
    </div>
  </article>;
}

function ShopView({ products, profile, settings, onAdd }: { products: Product[]; profile: Profile; settings: AppSettings; onAdd: (product: Product) => void }) {
  const [category, setCategory] = useState("전체"); const [query, setQuery] = useState("");
  const visible = products.filter(p => p.is_active && (category === "전체" || p.category === category) && (!query || `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase())));
  return <>
    <section className="hero-strip">
      <div><div className="eyebrow light">ATHLETE STORE · OPEN 24 HOURS</div><h1>오늘의 컨디션도<br/>필요한 만큼 채워가세요.</h1><p>선수촌 생활에 필요한 식품과 용품을 포인트로 구매할 수 있습니다.</p></div>
      <div className="balance-panel"><span>CURRENT BALANCE</span><strong>{formatPoints(profile.points)} <em>{settings.currency_name}</em></strong><small>{profile.character_name} · {profile.sport || "종목 미등록"}</small></div>
    </section>
    <section className="content-section">
      <div className="section-heading"><div><div className="eyebrow">STORE CATALOG</div><h2>매점 상품</h2></div><label className="search-box"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="상품 검색"/></label></div>
      <div className="category-row">{CATEGORIES.map(c => <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>{c}</button>)}</div>
      {visible.length ? <div className="product-grid">{visible.map(product => <ProductCard key={product.id} product={product} currency={settings.currency_name} onAdd={onAdd}/>)}</div> : <div className="empty-state"><ShoppingBag size={34}/><h3>해당하는 상품이 없습니다.</h3><p>다른 카테고리나 검색어를 확인해주세요.</p></div>}
    </section>
  </>;
}

function LockerView({ cart, inventory, products, profile, settings, onQuantity, onCheckout, onUse }: { cart: CartItem[]; inventory: InventoryItem[]; products: Product[]; profile: Profile; settings: AppSettings; onQuantity: (id: string, qty: number) => void; onCheckout: () => void; onUse: (item: InventoryItem) => void }) {
  const total = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const activeInventory = inventory.filter(i => !i.used_at);
  return <div className="two-column-page">
    <section className="panel cart-panel"><div className="panel-heading"><div><div className="eyebrow">CART</div><h2>장바구니</h2></div><span className="count-pill">{cart.reduce((a, b) => a + b.quantity, 0)}개</span></div>
      {cart.length ? <><div className="cart-list">{cart.map(item => <div className="cart-row" key={item.id}><div className="mini-thumb">{item.product.image_url ? <img src={item.product.image_url} alt=""/> : <ShoppingBag size={21}/>}</div><div className="cart-info"><strong>{item.product.name}</strong><span>{formatPoints(item.product.price)} {settings.currency_name}</span></div><div className="quantity"><button onClick={() => onQuantity(item.id, item.quantity - 1)}><Minus size={14}/></button><b>{item.quantity}</b><button onClick={() => onQuantity(item.id, item.quantity + 1)}><Plus size={14}/></button></div></div>)}</div>
        <div className="checkout-box"><div><span>보유 포인트</span><b>{formatPoints(profile.points)} {settings.currency_name}</b></div><div><span>결제 금액</span><b>- {formatPoints(total)} {settings.currency_name}</b></div><div className="after"><span>결제 후 잔액</span><strong>{formatPoints(profile.points - total)} {settings.currency_name}</strong></div><button className="button primary wide" disabled={profile.points < total} onClick={onCheckout}>전부 구매하기 <ShoppingCart size={18}/></button>{profile.points < total && <p className="form-error center">포인트가 부족합니다.</p>}</div></> : <div className="empty-state compact"><ShoppingCart size={32}/><h3>장바구니가 비어 있습니다.</h3><p>매점에서 필요한 상품을 담아보세요.</p></div>}
    </section>
    <section className="panel"><div className="panel-heading"><div><div className="eyebrow">LOCKER</div><h2>내 보관함</h2></div><span className="count-pill">{activeInventory.length} / {profile.locker_limit || settings.locker_limit}</span></div>
      {activeInventory.length ? <div className="inventory-grid">{activeInventory.map(item => { const isLottery = products.some(product => product.id === item.product_id && product.special_type === "lottery"); return <article className="inventory-card" key={item.id}><div className="inventory-art">{item.product_image_url ? <img src={item.product_image_url} alt=""/> : <PackageCheck size={36}/>}</div><strong>{item.product_name}</strong><span>{formatDate(item.purchased_at)} 구매</span><button className="button outline small" onClick={() => onUse(item)}>{isLottery ? "복권 긁기" : "사용하기"}</button></article>; })}</div> : <div className="empty-state compact"><PackageCheck size={32}/><h3>보관 중인 아이템이 없습니다.</h3><p>구매한 상품은 이곳에 들어옵니다.</p></div>}
    </section>
  </div>;
}

function ActivityView({ attendanceDone, trainingCount, settings, onAttend, onTrain }: { attendanceDone: boolean; trainingCount: number; settings: AppSettings; onAttend: () => void; onTrain: () => void }) {
  const remaining = Math.max(0, settings.daily_training_limit - trainingCount);
  return <div className="activity-page">
    <section className={`activity-card attendance ${attendanceDone ? "completed" : ""}`}><div className="activity-icon"><CalendarCheck/></div><div className="eyebrow light">DAILY CHECK-IN</div><h2>오늘도 선수촌에<br/>입촌했습니다.</h2><p>{new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Seoul" }).format(new Date())}</p><div className="reward">출석 보상 <strong>+{formatPoints(settings.attendance_reward)} {settings.currency_name}</strong></div><button className="button light wide" disabled={attendanceDone} onClick={onAttend}>{attendanceDone ? "오늘 출석 완료" : "출석하기"}<BadgeCheck size={18}/></button></section>
    <section className="activity-card training"><div className="activity-icon"><Dumbbell/></div><div className="eyebrow">TODAY'S TRAINING</div><h2>훈련을 완료하고<br/>포인트를 획득하세요.</h2><div className="training-progress"><div><span>오늘 훈련</span><b>{trainingCount} / {settings.daily_training_limit}</b></div><div className="progress-track"><i style={{ width: `${Math.min(100, trainingCount / settings.daily_training_limit * 100)}%` }}/></div><small>오늘 남은 훈련 {remaining}회</small></div><div className="reward">1회 보상 <strong>+{formatPoints(settings.training_reward)} {settings.currency_name}</strong></div><button className="button primary wide" disabled={!remaining} onClick={onTrain}>{remaining ? "훈련 완료" : "오늘 훈련 완료"}<Dumbbell size={18}/></button></section>
    <section className="activity-guide"><div className="eyebrow">ACTIVITY GUIDE</div><h3>이용 안내</h3><ul><li><BadgeCheck size={17}/> 출석은 한국시간 기준 하루 한 번 참여할 수 있습니다.</li><li><BadgeCheck size={17}/> 훈련은 설정된 일일 횟수만큼 반복할 수 있습니다.</li><li><BadgeCheck size={17}/> 모든 보상은 포인트 내역에 자동으로 기록됩니다.</li></ul></section>
  </div>;
}

function TransferView({ profile, members, settings, onTransfer }: { profile: Profile; members: Profile[]; settings: AppSettings; onTransfer: (receiverId: string, amount: number) => void }) {
  const [receiverId, setReceiverId] = useState(""); const [amount, setAmount] = useState("");
  const receiver = members.find(m => m.id === receiverId); const numeric = Number(amount) || 0;
  return <div className="transfer-layout"><section className="panel transfer-card"><div className="eyebrow">POINT TRANSFER</div><h2>포인트 양도</h2><p className="muted">보낼 캐릭터와 포인트를 확인한 뒤 양도해주세요.</p><div className="my-balance"><WalletCards/><span>내 포인트<strong>{formatPoints(profile.points)} {settings.currency_name}</strong></span></div><label>받을 캐릭터<select value={receiverId} onChange={e => setReceiverId(e.target.value)}><option value="">캐릭터 선택</option>{members.filter(m => m.id !== profile.id).map(m => <option key={m.id} value={m.id}>{m.character_name} · {m.sport || "종목 미등록"}</option>)}</select></label><label>보낼 포인트<div className="amount-input"><input type="number" min="1" max={profile.points} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"/><span>{settings.currency_name}</span></div></label><div className="transfer-preview"><span>양도 후 잔액</span><strong>{formatPoints(profile.points - numeric)} {settings.currency_name}</strong></div><button className="button primary wide" disabled={!receiver || numeric <= 0 || numeric > profile.points} onClick={() => onTransfer(receiverId, numeric)}>{receiver ? `${receiver.character_name}에게 보내기` : "받을 캐릭터를 선택해주세요"}<ArrowRightLeft size={18}/></button></section><aside className="notice-card"><ShieldCheck size={27}/><h3>양도 전 확인해주세요</h3><p>완료된 양도는 사용자가 직접 취소할 수 없습니다. 캐릭터와 금액을 반드시 다시 확인해주세요.</p></aside></div>;
}

function ProfileView({ profile, logs, inventory, attendanceDone, trainingCount, settings }: { profile: Profile; logs: PointLog[]; inventory: InventoryItem[]; attendanceDone: boolean; trainingCount: number; settings: AppSettings }) {
  return <div className="profile-page"><section className="profile-hero"><div className="avatar-large">{profile.avatar_url ? <img src={profile.avatar_url} alt=""/> : <UserRound/>}</div><div><div className="eyebrow light">ATHLETE PROFILE</div><h1>{profile.character_name}</h1><p>@{profile.username} · {profile.sport || "종목 미등록"}</p></div><div className="profile-balance"><span>보유 포인트</span><strong>{formatPoints(profile.points)} {settings.currency_name}</strong></div></section><section className="quick-stats"><article><CalendarCheck/><span>오늘 출석<b>{attendanceDone ? "완료" : "미완료"}</b></span></article><article><Dumbbell/><span>오늘 훈련<b>{trainingCount} / {settings.daily_training_limit}</b></span></article><article><PackageCheck/><span>보유 아이템<b>{inventory.filter(i => !i.used_at).length}개</b></span></article></section><section className="panel history-panel"><div className="panel-heading"><div><div className="eyebrow">POINT HISTORY</div><h2>포인트 내역</h2></div><History size={21}/></div>{logs.length ? <div className="history-list">{logs.map(log => <div className="history-row" key={log.id}><div className={`history-sign ${log.amount >= 0 ? "plus" : "minus"}`}>{log.amount >= 0 ? <Plus/> : <Minus/>}</div><div><strong>{log.description}</strong><span>{formatDate(log.created_at, true)}</span></div><b className={log.amount >= 0 ? "positive" : "negative"}>{log.amount >= 0 ? "+" : ""}{formatPoints(log.amount)} {settings.currency_name}</b></div>)}</div> : <div className="empty-state compact"><History size={30}/><h3>아직 포인트 내역이 없습니다.</h3></div>}</section></div>;
}

function AdminView({ profiles, products, settings, currency, onAdmin }: { profiles: Profile[]; products: Product[]; settings: AppSettings; currency: string; onAdmin: (action: string, payload: Record<string, unknown>, file?: File) => Promise<void> }) {
  const [tab, setTab] = useState<"members" | "products" | "settings">("members");
  const [memberForm, setMemberForm] = useState({ username: "", password: "", character_name: "", sport: "", points: settings.welcome_points });
  const [productForm, setProductForm] = useState({ name: "", description: "", price: 0, category: "식품", stock: "", purchase_limit: "", is_consumable: true, image_url: "" });
  const [productFile, setProductFile] = useState<File | undefined>();
  const [settingsForm, setSettingsForm] = useState(settings);
  const [adjustments, setAdjustments] = useState<Record<string, string>>({});
  useEffect(() => setSettingsForm(settings), [settings]);

  async function createMember(e: React.FormEvent) { e.preventDefault(); await onAdmin("create_member", memberForm); setMemberForm({ username: "", password: "", character_name: "", sport: "", points: settings.welcome_points }); }
  async function createProduct(e: React.FormEvent) { e.preventDefault(); await onAdmin("create_product", { ...productForm, stock: productForm.stock === "" ? null : Number(productForm.stock), purchase_limit: productForm.purchase_limit === "" ? null : Number(productForm.purchase_limit) }, productFile); setProductForm({ name: "", description: "", price: 0, category: "식품", stock: "", purchase_limit: "", is_consumable: true, image_url: "" }); setProductFile(undefined); }

  return <div className="admin-page">
    <section className="admin-banner"><div><div className="eyebrow light">ADMIN CONTROL</div><h1>운영 관리</h1><p>회원, 포인트, 상품과 사이트 운영 규칙을 관리합니다.</p></div><ShieldCheck size={48}/></section>
    <div className="admin-tabs"><button className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}><UsersRound/>회원 · 포인트</button><button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}><Store/>상품 관리</button><button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Settings/>운영 설정</button></div>
    {tab === "members" && <div className="admin-grid"><section className="panel admin-form"><div className="panel-heading"><div><div className="eyebrow">NEW ACCOUNT</div><h2>선수 계정 발급</h2></div></div><form onSubmit={createMember}><label>아이디<input value={memberForm.username} onChange={e => setMemberForm(v => ({ ...v, username: e.target.value }))} placeholder="athlete01" pattern="[A-Za-z0-9._-]+" required/></label><label>초기 비밀번호<input type="password" minLength={8} value={memberForm.password} onChange={e => setMemberForm(v => ({ ...v, password: e.target.value }))} placeholder="8자 이상" required/></label><div className="form-row"><label>캐릭터명<input value={memberForm.character_name} onChange={e => setMemberForm(v => ({ ...v, character_name: e.target.value }))} required/></label><label>종목<input value={memberForm.sport} onChange={e => setMemberForm(v => ({ ...v, sport: e.target.value }))} placeholder="야구"/></label></div><label>시작 포인트<input type="number" min="0" value={memberForm.points} onChange={e => setMemberForm(v => ({ ...v, points: Number(e.target.value) }))}/></label><button className="button primary wide">계정 만들기 <UserRound size={18}/></button></form></section><section className="panel admin-list"><div className="panel-heading"><div><div className="eyebrow">ATHLETES</div><h2>회원 목록</h2></div><span className="count-pill">{profiles.length}명</span></div><div className="member-list">{profiles.map(member => <div className="member-row" key={member.id}><div className="avatar-small">{member.avatar_url ? <img src={member.avatar_url} alt=""/> : member.character_name.slice(0, 1)}</div><div><strong>{member.character_name}{member.role === "admin" && <small className="admin-badge">운영진</small>}</strong><span>@{member.username} · {member.sport || "종목 미등록"}</span></div><b>{formatPoints(member.points)} {currency}</b><div className="point-adjust"><input type="number" placeholder="포인트" value={adjustments[member.id] || ""} onChange={e => setAdjustments(v => ({ ...v, [member.id]: e.target.value }))}/><button aria-label="포인트 지급" onClick={() => onAdmin("adjust_points", { user_id: member.id, amount: Math.abs(Number(adjustments[member.id] || 0)), description: "운영진 지급" })}><Plus/></button><button aria-label="포인트 차감" onClick={() => onAdmin("adjust_points", { user_id: member.id, amount: -Math.abs(Number(adjustments[member.id] || 0)), description: "운영진 차감" })}><Minus/></button></div></div>)}</div></section></div>}
    {tab === "products" && <div className="admin-grid"><section className="panel admin-form"><div className="panel-heading"><div><div className="eyebrow">NEW PRODUCT</div><h2>상품 등록</h2></div></div><form onSubmit={createProduct}><label>상품명<input value={productForm.name} onChange={e => setProductForm(v => ({ ...v, name: e.target.value }))} required/></label><label>설명<textarea value={productForm.description} onChange={e => setProductForm(v => ({ ...v, description: e.target.value }))} rows={3} required/></label><div className="form-row"><label>가격<input type="number" min="0" value={productForm.price} onChange={e => setProductForm(v => ({ ...v, price: Number(e.target.value) }))} required/></label><label>카테고리<select value={productForm.category} onChange={e => setProductForm(v => ({ ...v, category: e.target.value }))}>{CATEGORIES.filter(c => c !== "전체").map(c => <option key={c}>{c}</option>)}</select></label></div><div className="form-row"><label>재고<input type="number" min="0" value={productForm.stock} onChange={e => setProductForm(v => ({ ...v, stock: e.target.value }))} placeholder="비우면 무제한"/></label><label>1인 구매 제한<input type="number" min="1" value={productForm.purchase_limit} onChange={e => setProductForm(v => ({ ...v, purchase_limit: e.target.value }))} placeholder="비우면 제한 없음"/></label></div><label>상품 이미지<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => setProductFile(e.target.files?.[0])}/></label><label>또는 이미지 URL<input value={productForm.image_url} onChange={e => setProductForm(v => ({ ...v, image_url: e.target.value }))} placeholder="https://..."/></label><label className="check-label"><input type="checkbox" checked={productForm.is_consumable} onChange={e => setProductForm(v => ({ ...v, is_consumable: e.target.checked }))}/>사용 가능한 소비 아이템</label><button className="button primary wide">상품 등록 <Plus size={18}/></button></form></section><section className="panel admin-list"><div className="panel-heading"><div><div className="eyebrow">PRODUCTS</div><h2>등록 상품</h2></div><span className="count-pill">{products.length}개</span></div><div className="product-admin-list">{products.map(product => <div className="product-admin-row" key={product.id}><div className="mini-thumb">{product.image_url ? <img src={product.image_url} alt=""/> : <ShoppingBag/>}</div><div><strong>{product.name}</strong><span>{product.category} · {formatPoints(product.price)} {currency} · {product.stock == null ? "무제한" : `${product.stock}개`}</span></div><button className={`status-toggle ${product.is_active ? "on" : ""}`} onClick={() => onAdmin("toggle_product", { id: product.id, is_active: !product.is_active })}>{product.is_active ? "판매 중" : "숨김"}</button><button className="icon-button danger-soft" aria-label="상품 삭제" onClick={() => onAdmin("delete_product", { id: product.id })}><Trash2/></button></div>)}</div></section></div>}
    {tab === "settings" && <section className="panel settings-panel"><div className="panel-heading"><div><div className="eyebrow">SYSTEM SETTINGS</div><h2>운영 규칙</h2></div></div><form onSubmit={async e => { e.preventDefault(); await onAdmin("update_settings", settingsForm as unknown as Record<string, unknown>); }}><div className="settings-grid"><label>사이트 이름<input value={settingsForm.site_name} onChange={e => setSettingsForm(v => ({ ...v, site_name: e.target.value }))}/></label><label>포인트 단위<input value={settingsForm.currency_name} onChange={e => setSettingsForm(v => ({ ...v, currency_name: e.target.value }))}/></label><label>신규 가입 포인트<input type="number" min="0" value={settingsForm.welcome_points} onChange={e => setSettingsForm(v => ({ ...v, welcome_points: Number(e.target.value) }))}/></label><label>출석 보상<input type="number" min="0" value={settingsForm.attendance_reward} onChange={e => setSettingsForm(v => ({ ...v, attendance_reward: Number(e.target.value) }))}/></label><label>훈련 1회 보상<input type="number" min="0" value={settingsForm.training_reward} onChange={e => setSettingsForm(v => ({ ...v, training_reward: Number(e.target.value) }))}/></label><label>하루 훈련 횟수<input type="number" min="1" value={settingsForm.daily_training_limit} onChange={e => setSettingsForm(v => ({ ...v, daily_training_limit: Number(e.target.value) }))}/></label><label>기본 보관함 칸<input type="number" min="1" value={settingsForm.locker_limit} onChange={e => setSettingsForm(v => ({ ...v, locker_limit: Number(e.target.value) }))}/></label></div><button className="button primary">설정 저장 <Settings size={18}/></button></form></section>}
  </div>;
}

const navItems: { id: View; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "shop", label: "매점", icon: Store },
  { id: "locker", label: "장바구니 · 보관함", icon: ShoppingCart },
  { id: "activity", label: "출석 · 훈련", icon: Dumbbell },
  { id: "transfer", label: "포인트 양도", icon: ArrowRightLeft },
  { id: "profile", label: "내 정보", icon: UserRound }
];

export default function AthleteStore() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [view, setView] = useState<View>("shop");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [logs, setLogs] = useState<PointLog[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [attendanceDone, setAttendanceDone] = useState(false);
  const [trainingCount, setTrainingCount] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [busy, setBusy] = useState(true);
  const [demo, setDemo] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<null | { title: string; detail: string; label?: string; danger?: boolean; action: () => void }>(null);
  const supabase = useMemo(() => getSupabaseBrowser(), []);

  const toast = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = Date.now(); setToasts(v => [...v, { id, text, tone }]);
    window.setTimeout(() => setToasts(v => v.filter(item => item.id !== id)), 3200);
  }, []);

  const loadAll = useCallback(async (userId?: string) => {
    if (!supabase) return;
    const id = userId || (await supabase.auth.getUser()).data.user?.id;
    if (!id) return;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
    const [profileRes, productsRes, cartRes, inventoryRes, logsRes, membersRes, settingsRes, attendanceRes, trainingRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", id).single(),
      supabase.from("products").select("*").order("created_at", { ascending: false }),
      supabase.from("cart_items").select("id,quantity,product:products(*)").eq("user_id", id),
      supabase.from("inventory").select("*").eq("user_id", id).order("purchased_at", { ascending: false }),
      supabase.from("point_logs").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(100),
      supabase.from("profiles").select("*").order("character_name"),
      supabase.from("app_settings").select("key,value"),
      supabase.from("attendance").select("id").eq("user_id", id).eq("attendance_date", today).maybeSingle(),
      supabase.from("training_logs").select("id", { count: "exact", head: true }).eq("user_id", id).eq("training_date", today)
    ]);
    if (profileRes.data) setProfile(profileRes.data as Profile);
    if (productsRes.data) setProducts(productsRes.data as Product[]);
    if (cartRes.data) setCart(cartRes.data.map((row: any) => ({ id: row.id, quantity: row.quantity, product: Array.isArray(row.product) ? row.product[0] : row.product })) as CartItem[]);
    if (inventoryRes.data) setInventory(inventoryRes.data as InventoryItem[]);
    if (logsRes.data) setLogs(logsRes.data as PointLog[]);
    if (membersRes.data) setMembers(membersRes.data as Profile[]);
    if (settingsRes.data) { const next = { ...DEFAULT_SETTINGS } as Record<string, string | number>; settingsRes.data.forEach((row: { key: string; value: string | number }) => { next[row.key] = row.value; }); setSettings(next as unknown as AppSettings); }
    setAttendanceDone(Boolean(attendanceRes.data)); setTrainingCount(trainingRes.count || 0); setBusy(false);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) { setBusy(false); return; }
    supabase.auth.getSession().then(({ data }) => { if (data.session?.user) loadAll(data.session.user.id); else setBusy(false); });
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => { if (session?.user) loadAll(session.user.id); else { setProfile(null); setBusy(false); } });
    return () => auth.subscription.unsubscribe();
  }, [supabase, loadAll]);

  function enterDemo() {
    setDemo(true); setProfile(demoProfile); setProducts(demoProducts);
    setMembers([demoProfile, { ...demoProfile, id: "demo-2", username: "athlete02", character_name: "김규혁", sport: "농구", points: 1800, role: "member" }, { ...demoProfile, id: "demo-3", username: "athlete03", character_name: "이규태", sport: "수영", points: 4100, role: "member" }]);
    setLogs(demoLogs); setBusy(false);
  }

  async function addToCart(product: Product) {
    if (!profile) return;
    const existing = cart.find(i => i.product.id === product.id); const nextQty = (existing?.quantity || 0) + 1;
    if (product.purchase_limit && nextQty > product.purchase_limit) return toast(`이 상품은 ${product.purchase_limit}개까지 구매할 수 있습니다.`, "error");
    if (demo || !supabase) { if (existing) setCart(v => v.map(i => i.id === existing.id ? { ...i, quantity: nextQty } : i)); else setCart(v => [...v, { id: `cart-${Date.now()}`, quantity: 1, product }]); toast("장바구니에 담았습니다."); return; }
    const { error } = await supabase.from("cart_items").upsert({ user_id: profile.id, product_id: product.id, quantity: nextQty }, { onConflict: "user_id,product_id" });
    if (error) toast(error.message, "error"); else { toast("장바구니에 담았습니다."); loadAll(); }
  }

  async function changeQuantity(id: string, quantity: number) {
    if (demo || !supabase) { setCart(v => quantity <= 0 ? v.filter(i => i.id !== id) : v.map(i => i.id === id ? { ...i, quantity } : i)); return; }
    const result = quantity <= 0 ? await supabase.from("cart_items").delete().eq("id", id) : await supabase.from("cart_items").update({ quantity }).eq("id", id);
    if (result.error) toast(result.error.message, "error"); else loadAll();
  }

  function requestCheckout() {
    if (!profile || !cart.length) return;
    const total = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    setConfirm({ title: "장바구니를 결제할까요?", detail: `총 ${formatPoints(total)} ${settings.currency_name}가 차감되며 구매한 상품은 보관함에 들어갑니다.`, label: "구매", action: async () => {
      setConfirm(null);
      if (demo || !supabase) {
        const purchased = cart.flatMap(item => Array.from({ length: item.quantity }, (_, index) => ({ id: `inv-${Date.now()}-${index}-${item.id}`, product_id: item.product.id, product_name: item.product.name, product_image_url: item.product.image_url, purchased_at: new Date().toISOString(), used_at: null })));
        setInventory(v => [...purchased, ...v]); setCart([]); setProfile(p => p ? { ...p, points: p.points - total } : p); setLogs(v => [{ id: `log-${Date.now()}`, amount: -total, type: "purchase", description: `매점 상품 ${purchased.length}개 구매`, created_at: new Date().toISOString() }, ...v]); toast("구매가 완료되었습니다."); return;
      }
      const { error } = await supabase.rpc("purchase_cart"); if (error) toast(error.message, "error"); else { toast("구매가 완료되었습니다."); loadAll(); }
    }});
  }

  function requestUse(item: InventoryItem) {
    const product = products.find(candidate => candidate.id === item.product_id);
    if (product?.special_type === "lottery") {
      setConfirm({ title: `${item.product_name}을(를) 긁을까요?`, detail: "복권 한 장을 사용하며 설정된 확률에 따라 결과와 포인트가 즉시 결정됩니다.", label: "복권 긁기", action: async () => {
        setConfirm(null);
        if (demo || !supabase) return toast("복권은 실제 로그인 상태에서 이용할 수 있습니다.", "error");
        const { data, error } = await supabase.rpc("play_lottery", { inventory_item_id: item.id });
        if (error) return toast(error.message, "error");
        window.dispatchEvent(new CustomEvent("athlete-lottery-result", { detail: data }));
        loadAll();
      }});
      return;
    }
    setConfirm({ title: `${item.product_name}을(를) 사용할까요?`, detail: "사용 후에는 보관함에서 사라지지만 사용 기록은 남습니다.", label: "사용", danger: true, action: async () => {
      setConfirm(null);
      if (demo || !supabase) { setInventory(v => v.map(i => i.id === item.id ? { ...i, used_at: new Date().toISOString() } : i)); toast("아이템을 사용했습니다."); return; }
      const { error } = await supabase.rpc("use_inventory_item", { inventory_item_id: item.id }); if (error) toast(error.message, "error"); else { toast("아이템을 사용했습니다."); loadAll(); }
    }});
  }

  async function attend() {
    if (demo || !supabase) { setAttendanceDone(true); setProfile(p => p ? { ...p, points: p.points + settings.attendance_reward } : p); setLogs(v => [{ id: `l-${Date.now()}`, amount: settings.attendance_reward, type: "attendance", description: "일일 출석", created_at: new Date().toISOString() }, ...v]); toast("출석 보상이 지급되었습니다."); return; }
    const { error } = await supabase.rpc("daily_checkin"); if (error) toast(error.message, "error"); else { toast("출석 보상이 지급되었습니다."); loadAll(); }
  }

  async function train() {
    if (demo || !supabase) { setTrainingCount(v => v + 1); setProfile(p => p ? { ...p, points: p.points + settings.training_reward } : p); setLogs(v => [{ id: `l-${Date.now()}`, amount: settings.training_reward, type: "training", description: "훈련 완료", created_at: new Date().toISOString() }, ...v]); toast("훈련 보상이 지급되었습니다."); return; }
    const { error } = await supabase.rpc("complete_training"); if (error) toast(error.message, "error"); else { toast("훈련 보상이 지급되었습니다."); loadAll(); }
  }

  function requestTransfer(receiverId: string, amount: number) {
    const receiver = members.find(m => m.id === receiverId); if (!receiver) return;
    setConfirm({ title: `${receiver.character_name}에게 양도할까요?`, detail: `${formatPoints(amount)} ${settings.currency_name}를 보내면 잔액은 ${formatPoints((profile?.points || 0) - amount)} ${settings.currency_name}가 됩니다.`, label: "양도", action: async () => {
      setConfirm(null);
      if (demo || !supabase) { setProfile(p => p ? { ...p, points: p.points - amount } : p); setLogs(v => [{ id: `l-${Date.now()}`, amount: -amount, type: "transfer_out", description: `${receiver.character_name}에게 양도`, created_at: new Date().toISOString() }, ...v]); toast("포인트를 양도했습니다."); return; }
      const { error } = await supabase.rpc("transfer_points", { receiver_id: receiverId, transfer_amount: amount }); if (error) toast(error.message, "error"); else { toast("포인트를 양도했습니다."); loadAll(); }
    }});
  }

  async function adminAction(action: string, payload: Record<string, unknown>, file?: File) {
    if (demo || !supabase) {
      toast("데모에서는 저장 대신 동작만 미리 볼 수 있습니다.");
      if (action === "create_product") setProducts(v => [{ ...payload, id: `p-${Date.now()}`, image_url: (payload.image_url as string) || null, is_active: true, created_at: new Date().toISOString() } as Product, ...v]);
      if (action === "update_settings") setSettings(payload as unknown as AppSettings);
      if (action === "toggle_product") setProducts(v => v.map(p => p.id === payload.id ? { ...p, is_active: Boolean(payload.is_active) } : p));
      if (action === "delete_product") setProducts(v => v.filter(p => p.id !== payload.id));
      return;
    }
    let imageUrl = payload.image_url;
    if (file) { const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`; const upload = await supabase.storage.from("product-images").upload(path, file); if (upload.error) return toast(upload.error.message, "error"); imageUrl = supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl; }
    const { data: sessionData } = await supabase.auth.getSession();
    const response = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token || ""}` }, body: JSON.stringify({ action, payload: { ...payload, image_url: imageUrl } }) });
    const data = await response.json(); if (!response.ok) toast(data.error || "요청을 처리하지 못했습니다.", "error"); else { toast(data.message || "저장했습니다."); loadAll(); }
  }

  async function logout() { if (supabase && !demo) await supabase.auth.signOut(); setDemo(false); setProfile(null); setCart([]); setInventory([]); setLogs([]); setView("shop"); }

  if (busy) return <div className="loading-screen"><div className="brand-mark"><Dumbbell/></div><p>선수촌 시스템을 불러오는 중…</p></div>;
  if (!profile) return <Login onDemo={enterDemo}/>;
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return <div className="app-shell">
    <ToastStack items={toasts}/>
    {confirm && <ConfirmDialog title={confirm.title} detail={confirm.detail} confirmLabel={confirm.label} danger={confirm.danger} onCancel={() => setConfirm(null)} onConfirm={confirm.action}/>} 
    <header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="메뉴 열기"><Menu/></button><div className="mobile-logo"><Dumbbell/><span>{settings.site_name}</span></div><button className="cart-shortcut" onClick={() => setView("locker")}><ShoppingCart/>{cartCount > 0 && <b>{cartCount}</b>}</button></header>
    <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
      <div className="sidebar-head"><div className="brand-mark"><Dumbbell/></div><div><span>NATIONAL</span><strong>ATHLETE STORE</strong></div><button className="close-nav" onClick={() => setMobileNav(false)}><X/></button></div>
      <nav>{navItems.map(item => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { setView(item.id); setMobileNav(false); }}><Icon size={20}/><span>{item.label}</span>{item.id === "locker" && cartCount > 0 && <b>{cartCount}</b>}</button>; })}{profile.role === "admin" && <button className={view === "admin" ? "active" : ""} onClick={() => { setView("admin"); setMobileNav(false); }}><LayoutDashboard size={20}/><span>운영 관리</span></button>}</nav>
      <div className="sidebar-profile"><div className="avatar-small">{profile.avatar_url ? <img src={profile.avatar_url} alt=""/> : profile.character_name.slice(0, 1)}</div><div><strong>{profile.character_name}</strong><span>{formatPoints(profile.points)} {settings.currency_name}</span></div><button onClick={logout} aria-label="로그아웃"><LogOut/></button></div>
    </aside>
    {mobileNav && <button className="nav-backdrop" onClick={() => setMobileNav(false)} aria-label="메뉴 닫기"/>}
    <main className="main-content">
      {demo && <div className="demo-banner">데모 화면입니다. 실제 배포에서는 모든 기록이 안전하게 저장됩니다.</div>}
      {view === "shop" && <ShopView products={products} profile={profile} settings={settings} onAdd={addToCart}/>} 
      {view === "locker" && <LockerView
        cart={cart}
        inventory={inventory}
        products={products}
        profile={profile}
        settings={settings}
        onQuantity={changeQuantity}
        onCheckout={requestCheckout}
        onUse={requestUse}
      />}
      {view === "activity" && <ActivityView attendanceDone={attendanceDone} trainingCount={trainingCount} settings={settings} onAttend={attend} onTrain={train}/>} 
      {view === "transfer" && <TransferView profile={profile} members={members} settings={settings} onTransfer={requestTransfer}/>} 
      {view === "profile" && <ProfileView profile={profile} logs={logs} inventory={inventory} attendanceDone={attendanceDone} trainingCount={trainingCount} settings={settings}/>} 
      {view === "admin" && profile.role === "admin" && <AdminView profiles={members} products={products} settings={settings} currency={settings.currency_name} onAdmin={adminAction}/>} 
    </main>
  </div>;
}
