import type { Metadata } from "next";
import StoreActionEnhancer from "@/components/store-action-enhancer";
import AuthEntryEnhancer from "@/components/auth-entry-enhancer";
import TimedItemEnhancer from "@/components/timed-item-enhancer";
import CategoryEnhancer from "@/components/category-enhancer";
import TransferRecipientEnhancer from "@/components/transfer-recipient-enhancer";
import AdminMaintenanceEnhancer from "@/components/admin-maintenance-enhancer";
import "./globals.css";
import "./store-actions.css";
import "./auth-entry.css";
import "./timed-effects.css";
import "./catalog-tools.css";
import "./admin-maintenance.css";

export const metadata: Metadata = {
  title: "선수촌 매점",
  description: "자캐 커뮤니티를 위한 선수촌 포인트·매점 시스템",
  icons: { icon: "/favicon.svg" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}<StoreActionEnhancer/><AuthEntryEnhancer/><TimedItemEnhancer/><CategoryEnhancer/><TransferRecipientEnhancer/><AdminMaintenanceEnhancer/></body>
    </html>
  );
}
