/**
 * Minimal layout for the changelog.
 *
 * Deliberately none of the app shell: no sidebar, no topbar, no Bree widget, no
 * dashboard context. The page is public and renders a hardcoded entries array,
 * so it must not assume a session, a company, or any provider being mounted —
 * the signed-out render goes through exactly this path.
 *
 * A plain block element in normal document flow: the page scrolls the document,
 * which is what a long list of dated entries should do.
 */
export default function WhatsNewLayout({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100vh', background: '#ffffff' }}>{children}</div>;
}
