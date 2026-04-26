// web/dashboard/src/components/JsonDrawer.tsx

export function JsonDrawer({ value }: { value: unknown }) {
  let pretty: string;
  try {
    pretty = JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2);
  } catch {
    pretty = String(value);
  }
  return (
    <pre className="bg-slate-900 text-slate-100 text-xs p-3 rounded overflow-x-auto">
      {pretty}
    </pre>
  );
}
