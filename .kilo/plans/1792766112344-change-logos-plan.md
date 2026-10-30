# Plan: Change logo on login screen, web app, and browser tab

## Current state
- **Browser tab/favicon**: `src/app/favicon.ico` (4 icons, 16x16/32x32). No icons array in `src/app/layout.tsx` metadata.
- **Web app (logged in)**: `src/components/layout/Sidebar.tsx` - sidebar logo is a gradient button with `<Sparkles>` (lucide-react) + "InkaTest" text (clicks to `/workspace`). Also mobile nav shows similar Sparkles.
- **Login/auth screens**: `src/app/(auth)/login/LoginView.tsx` uses `<Zap>` in brand header (line ~134) and card logo (line ~224). Other auth pages (`forgot-password/ForgotPasswordForm.tsx`, `reset-password/page.tsx`) use `<Zap>`. Styles in `login.module.css`, `auth-pages.module.css`.

## Goal
Change the logo on:
1. Login screen (auth pages)
2. Web app (app sidebar/header areas)
3. Browser tab (favicon + metadata)

## Approach

### 1) Prepare new logo assets
- Add image assets to a suitable location. Options:
  - Put in `src/app/` (e.g., `icon.png`, `apple-icon.png`) - Next.js App Router will auto-pick them
  - Put in `public/` (e.g., `logo.svg`, `favicon.ico`, `apple-touch-icon.png`)
- Recommended: provide optimized images in common sizes. For favicon, replace `src/app/favicon.ico`. For app icons, can add `src/app/icon.png` (and optionally `apple-icon.png`) or update metadata.
- If using SVG for in-app logos, add to `src/components/icons/` or `public/`.

### 2) Update browser tab/favicon
- Replace `src/app/favicon.ico` with new favicon (same format/sizes).
- Optionally enhance `src/app/layout.tsx` metadata to include icons explicitly:
```ts
export const metadata: Metadata = {
  title: "InkaTest - QA Intelligence Platform",
  description: "Test Case Management Tool",
  icons: {
    icon: '/favicon.ico',
    // or use app/icon.png
  },
};
```
- If adding `icon.png` to `src/app/`, Next.js auto-detects it. Can also add `apple-icon.png`.

### 3) Update web app logo (sidebar)
- **File**: `src/components/layout/Sidebar.tsx`
- Replace the Sparkles-based logo block (lines ~569-573). Options:
  1. Replace the gradient button div containing `<Sparkles>` with an `<Image>` from your asset, or a custom SVG component
  2. Or keep the styling but swap icon component
- Also update mobile nav if it uses Sparkles (line ~306 shows it in mobile context - check full usage)
- Update imports if needed (remove Sparkles if no longer used, or keep)

### 4) Update login screen logo
- **File**: `src/app/(auth)/login/LoginView.tsx`
  - Replace `<Zap>` in brand header (line ~134) with new logo
  - Replace `<Zap>` in card logo (line ~224) with new logo
- **Files**: `src/app/(auth)/forgot-password/ForgotPasswordForm.tsx` (line ~42), `src/app/(auth)/reset-password/page.tsx` (line ~31)
- Update imports (remove Zap if unused; add Image or custom component)
- May need to adjust CSS in `login.module.css` and `auth-pages.module.css` for sizing/styling

### 5) Create reusable logo component (recommended)
- Create `src/components/common/Logo.tsx` or `src/components/icons/AppLogo.tsx` for consistency
- Component can accept size/variant props
- Use it in sidebar, login, and other places

## Steps to implement (concrete)

1. **Add assets**
   - Copy new logo files to repo. Suggest: `public/logo.svg` (or `public/logo.png`), and replace `src/app/favicon.ico`. Also consider `src/app/icon.png`, `src/app/apple-icon.png`.
   
2. **Update layout metadata** (`src/app/layout.tsx`)
   - Add icons to metadata if not auto-detected, or ensure favicon is replaced.

3. **Update sidebar** (`src/components/layout/Sidebar.tsx`)
   - Import Image (or custom Logo component)
   - Replace lines 569-573: swap Sparkles for new logo image/component
   - Check line ~306 in mobile nav and update similarly
   - Clean up imports if Sparkles no longer needed

4. **Update login** (`src/app/(auth)/login/LoginView.tsx`)
   - Import new logo component/Image
   - Replace Zap usages (134, 206, 224)
   - Update CSS classes if needed

5. **Update other auth pages**
   - `forgot-password/ForgotPasswordForm.tsx`, `reset-password/page.tsx` - replace Zap logos

6. **Test**
   - Run dev server, check login page, logged-in app (sidebar), browser tab favicon
   - Clear browser cache if favicon doesn't update
   - Check mobile view

## Notes
- If keeping "InkaTest" text, just change the icon/mark
- If rebranding name too, update title in layout.tsx and text in sidebar/login
- Next.js App Router caches favicons aggressively; hard refresh needed
- Use SVG for crisp rendering across sizes
- If the logo needs theming (dark/light), use CSS variables or multiple variants

## Files to modify
- `src/app/favicon.ico` (replace)
- `src/app/layout.tsx` (metadata/icons)
- `src/components/layout/Sidebar.tsx`
- `src/app/(auth)/login/LoginView.tsx`
- `src/app/(auth)/forgot-password/ForgotPasswordForm.tsx`
- `src/app/(auth)/reset-password/page.tsx`
- Possibly create `src/components/icons/AppLogo.tsx` or similar
- Possibly add assets to `public/` or `src/app/`
