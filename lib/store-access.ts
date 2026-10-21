export const OPERATOR_ONLY_MESSAGE = "현재 운영진만 접속할 수 있습니다. 운영진의 이용 안내를 기다려주세요.";

export function canEnterStore(restricted: boolean, role: string | null) {
  return !restricted || role === "admin" || role === "staff";
}
