export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-0 flex flex-col items-center justify-center px-4">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-white tracking-tight">ManFriday</h1>
        <p className="text-gray-500 text-sm mt-1">Personal LLM knowledge base</p>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
