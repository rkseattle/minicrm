interface StatTileProps {
  label: string;
  value: string;
  sublabel?: string;
  testId: string;
}

export default function StatTile({ label, value, sublabel, testId }: StatTileProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4" data-testid={testId}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      {sublabel && <p className="mt-1 text-xs text-gray-500">{sublabel}</p>}
    </div>
  );
}
