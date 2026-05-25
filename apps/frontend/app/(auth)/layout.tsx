export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface-900 flex items-center justify-center p-4">
      {/* Background gradient */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 20% 50%, rgba(79,110,247,0.08) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(79,110,247,0.05) 0%, transparent 50%)',
        }}
      />
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  );
}
