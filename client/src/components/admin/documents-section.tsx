import { Link } from 'wouter';
import { Button } from '@/components/ui/button';

export function DocumentsSection({ token }: { token: string }) {
  return <div className="space-y-4 max-w-5xl">
    <h1 className="text-2xl font-semibold">Documents</h1>
    <p className="text-sm text-gray-500">Documents are public. Visitors can open them directly without approval.</p>
    <div className="flex flex-wrap gap-2">
      <Link href="/docs"><Button>Open documents</Button></Link>
      <Link href="/docs/technical"><Button variant="outline">Open technical documentation</Button></Link>
      <Link href="/data-room"><Button variant="outline">Open data room</Button></Link>
    </div>
  </div>;
}
