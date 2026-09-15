export type Role = "member" | "admin";

export interface Profile {
  id: string;
  username: string;
  character_name: string;
  sport: string | null;
  avatar_url: string | null;
  points: number;
  role: Role;
  locker_limit: number;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  category: string;
  stock: number | null;
  purchase_limit: number | null;
  is_active: boolean;
  is_consumable: boolean;
  special_type?: "standard" | "lottery";
  created_at: string;
}

export interface CartItem {
  id: string;
  quantity: number;
  product: Product;
}

export interface InventoryItem {
  id: string;
  product_id: string | null;
  product_name: string;
  product_image_url: string | null;
  purchased_at: string;
  used_at: string | null;
}

export interface PointLog {
  id: string;
  amount: number;
  type: string;
  description: string;
  created_at: string;
}

export interface AppSettings {
  site_name: string;
  currency_name: string;
  welcome_points: number;
  attendance_reward: number;
  training_reward: number;
  daily_training_limit: number;
  locker_limit: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  site_name: "NATIONAL TRAINING CENTER",
  currency_name: "P",
  welcome_points: 1000,
  attendance_reward: 100,
  training_reward: 150,
  daily_training_limit: 3,
  locker_limit: 20
};

export const CATEGORIES = ["전체", "식품", "음료", "훈련용품", "생활용품", "티켓", "기타"];
