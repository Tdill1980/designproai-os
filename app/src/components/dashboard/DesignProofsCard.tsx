import { FileCheck2, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { designProofsRoute, type DesignProofMetadata } from '@/lib/design-proof-export';

export function DesignProofsCard({ brand }: { brand?: DesignProofMetadata['brand'] }) {
  return <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 text-gray-900 shadow-sm" aria-label="DesignProofs">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold"><FileCheck2 className="h-5 w-5 text-blue-600" /> DesignProofs</h2>
        <p className="mt-2 text-sm text-gray-600">Your saved approval PDFs. Find a design, download all its views together, or email the proof to your client.</p>
        <div className="mt-3 flex gap-2 text-xs font-semibold"><span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">PatternPro</span><span className="rounded-full bg-purple-50 px-3 py-1 text-purple-700">WallPro</span></div>
      </div>
      <Link to={designProofsRoute(brand)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700">Open DesignProofs <ArrowUpRight className="h-4 w-4" /></Link>
    </div>
  </section>;
}
