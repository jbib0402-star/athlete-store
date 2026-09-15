import type { Metadata } from "next";
import StoreActionEnhancer from "@/components/store-action-enhancer";
import AuthEntryEnhancer from "@/components/auth-entry-enhancer";
import TimedItemEnhancer from "@/components/timed-item-enhancer";
import TimedRuleCorrectionEnhancer from "@/components/timed-rule-correction-enhancer";
import CategoryEnhancer from "@/components/category-enhancer";
import TransferRecipientEnhancer from "@/components/transfer-recipient-enhancer";
import AdminMaintenanceEnhancer from "@/components/admin-maintenance-enhancer";
import AdminEffectManager from "@/components/admin-effect-manager";
import ProfileHistoryEnhancer from "@/components/profile-history-enhancer";
import LotteryEnhancer from "@/components/lottery-enhancer";
import LotteryRuntimeFix from "@/components/lottery-runtime-fix";
import LotteryConfigBridge from "@/components/lottery-config-bridge";
import GiftArrivalNotifier from "@/components/gift-arrival-notifier";
import AdminMemberPageRestore from "@/components/admin-member-page-restore";
import AgilityTrainingGame from "@/components/agility-training-game";
import LockerRefreshEnhancer from "@/components/locker-refresh-enhancer";
import "./globals.css";
import "./store-actions.css";
import "./auth-entry.css";
import "./timed-effects.css";
import "./catalog-tools.css";
import "./admin-maintenance.css";
import "./admin-effects.css";
import "./profile-history.css";
import "./lottery.css";
import "./gift-arrival.css";
import "./training-game.css";
import "./locker-refresh.css";

export const metadata: Metadata = {
  title: "선수촌 매점",
  description: "자캐 커뮤니티를 위한 선수촌 포인트·매점 시스템",
  icons: { icon: "/favicon.svg" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}<StoreActionEnhancer/><AuthEntryEnhancer/><TimedItemEnhancer/><TimedRuleCorrectionEnhancer/><CategoryEnhancer/><TransferRecipientEnhancer/><AdminMaintenanceEnhancer/><AdminEffectManager/><ProfileHistoryEnhancer/><LotteryEnhancer/><LotteryRuntimeFix/><LotteryConfigBridge/><GiftArrivalNotifier/><AdminMemberPageRestore/><AgilityTrainingGame/><LockerRefreshEnhancer/></body>
    </html>
  );
}
