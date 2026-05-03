export function JsonDrawer({ value }: { value: unknown }) {
  let pretty: string;
  try {
    pretty = JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2);
  } catch {
    pretty = String(value);
  }
  return (
    <pre className="bg-bg border border-border text-text font-mono text-xs p-3 rounded overflow-x-auto">
      {pretty}
    </pre>
  );
}
