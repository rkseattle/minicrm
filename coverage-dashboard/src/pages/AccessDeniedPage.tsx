export default function AccessDeniedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center" data-testid="access-denied-page">
        <h1 className="mb-2 text-xl font-semibold text-gray-900">Access denied</h1>
        <p className="text-sm text-gray-600">This dashboard is available to MiniCRM admins only.</p>
      </div>
    </div>
  );
}
