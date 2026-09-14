# Athlete Store

자캐 커뮤니티의 국가대표 선수촌 콘셉트에 맞춘 포인트·매점 운영 사이트입니다.

## 포함된 기능

- 운영진 발급형 아이디·비밀번호 로그인
- 상품 목록, 검색, 카테고리, 재고 및 구매 제한
- 장바구니 일괄 결제와 보관함
- 아이템 사용 확인 및 사용 기록 보존
- 한국시간 기준 일일 출석과 횟수 제한 훈련 보상
- 캐릭터 간 포인트 양도와 전체 포인트 장부
- 회원 생성, 포인트 지급·차감, 상품 관리, 운영 규칙 관리
- 상품 이미지 파일 업로드 또는 외부 이미지 URL
- 모바일·데스크톱 반응형 화면

## 구성

- Next.js 16 / React 19
- Supabase Auth, Postgres, Storage
- Vercel 배포

## 설치

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Supabase 설정

1. 새 Supabase 프로젝트를 만듭니다.
2. SQL Editor에서 `supabase/migrations/001_init.sql`을 실행합니다.
3. `.env.local`에 프로젝트 URL, anon key, service role key를 설정합니다.
4. `ADMIN_BOOTSTRAP_SECRET`에는 충분히 긴 임의 문자열을 설정합니다.
5. `/setup`에서 첫 운영진 계정을 한 번 생성합니다.

## Vercel 환경 변수

`.env.example`에 적힌 키를 Production, Preview, Development 환경에 등록합니다. `SUPABASE_SERVICE_ROLE_KEY`와 `ADMIN_BOOTSTRAP_SECRET`은 클라이언트에 노출하면 안 됩니다.

## 검증

```bash
npm run typecheck
npm run build
```
