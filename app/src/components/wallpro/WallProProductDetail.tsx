/**
 * THE PRODUCT-PAGE HALF OF A HYBRID PAGE.
 *
 * Owner, 2026-09-14: this page is "a hybrid page taking place of current wall
 * product", and then, looking at it: "It looks like short."
 *
 * It was. The page ran 3,142px and ended at the film block. The wall product
 * page it replaces carries a ten-row material table, six questions and the terms
 * buyers actually search — none of which were here. A page that removes a
 * product page has to answer what that page answered, or the questions come back
 * as phone calls and the search traffic goes somewhere else.
 *
 * THIS IS ALSO THE SEO HALF. The long-tail for this product does not live in the
 * hero; it lives in "how much does a wall wrap cost", "will the seams show",
 * "do I have to print with you" and in the film's own name. Those phrases were
 * on the page being replaced, so they have to be on this one or the swap costs
 * rankings the business already owns.
 *
 * Content copied from app/public/embeds/wpw-wall-wrap-product.html, which was
 * itself reconciled line by line against the live product page. Answers state
 * the real numbers — 53" print width, $3.25/sq ft, the 24-hour human check — by
 * reading the same constants the rest of the page reads, so a rate change cannot
 * leave a stale answer behind in an accordion nobody re-reads.
 */
import { Link } from 'react-router-dom';
import { WALLPRO_PRINT_WIDTH } from '@/lib/wallpro-geometry';
import { WPW_WALL_FILM_RATE_PER_SQFT, WALL_DESIGN_SKUS, formatMoney } from '@/lib/wallpro-pricing';
import { WALL_CARD } from '@/lib/wallpro-brand';

const rate = `$${WPW_WALL_FILM_RATE_PER_SQFT.toFixed(2)}`;
const filePrep = formatMoney(WALL_DESIGN_SKUS.upload.cents);
const roomDesign = formatMoney(WALL_DESIGN_SKUS.wall.cents);

const QUESTIONS: Array<[string, string]> = [
  [
    'How much does a wall wrap cost?',
    `${rate}, sold by the square foot, on your wall's own area. A 12′ × 8′ wall is 96 sq ft, so $312. Design is separate, from ${filePrep} for file prep to ${roomDesign} for a design created specifically for your room.`,
  ],
  [
    'Do I have to print with you?',
    'No. Buy the design and the print-ready files are yours — the whole wall plus every panel as TIFF, PDF and PNG. Take them to any printer.',
  ],
  [
    'What if I already have artwork?',
    `Send it. File prep is ${filePrep} and covers scaling it to your wall, adding bleed, and panelizing it to the ${WALLPRO_PRINT_WIDTH}″ print width. If it is already print-ready at size, just order the printing above.`,
  ],
  [
    'How long does it take?',
    'The design is minutes. Production files are built straight after you approve it, then a member of our team checks the panels before release — usually within 24 hours. You watch each panel appear as it is produced.',
  ],
  [
    'Will the seams show?',
    'Panels are seam-matched by measurement, not by eye, so the pattern lines up across the join. On a repeating design the repeat is verified in code before the files are released.',
  ],
  [
    'Can I see it on my own wall first?',
    'Yes. Upload a photo of the room, mark the four corners of the wall, and the design is shown on it at true scale — before you pay for anything.',
  ],
];

/** The product's own tags: real terms it already carries in search. */
const ALSO_CALLED = [
  'Commercial wall wrap', 'Custom wall mural', 'Interior wall wrap',
  'Office wall graphics', 'Printed wall vinyl', 'Wall graphics',
  'Wall murals', 'Wall wraps',
];

/**
 * TWO FAQs ON PURPOSE, AND THEY ARE NOT THE SAME OBJECT.
 *
 * This block is the SEO tail of a PRODUCT PAGE: six phrases buyers already
 * search, answered inline so the swap from the old wall product page costs no
 * rankings. It stays short by design.
 *
 * pages/WallProFaq.tsx is the long form — the corner/mask geometry drawn with
 * the editor's own colours, the GENIE Wall Panelizer rail, the full price
 * ladder. A buyer who wants that should not have to find it, so this block ends
 * by pointing at it, and neither page re-types a number: both read
 * WALL_DESIGN_SKUS, WPW_WALL_FILM_RATE_PER_SQFT and WALLPRO_PRINT_WIDTH.
 */
export function WallProProductDetail({ faqHref = '/wall-wrap/faq' }: { faqHref?: string } = {}) {
  return (
    <section className={`${WALL_CARD} md:p-6`} aria-label="Wall wrap questions and terms">
      <h2 className="text-lg font-semibold">Questions</h2>
      <div className="mt-3">
        {QUESTIONS.map(([q, a], i) => (
          <details key={q} open={i === 0} className="border-b border-slate-200 py-3 last:border-b-0">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">{q}</summary>
            <p className="mt-2 max-w-[68ch] text-sm text-slate-600">{a}</p>
          </details>
        ))}
      </div>

      <h3 className="mt-6 text-sm font-semibold text-slate-900">Also called</h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ALSO_CALLED.map(term => (
          <span key={term} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">{term}</span>
        ))}
      </div>
      <p className="mt-4">
        <Link to={faqHref} className="text-sm font-semibold text-blue-700 underline-offset-4 hover:underline">
          Every question, with the prices and the geometry <span aria-hidden="true">&rarr;</span>
        </Link>
      </p>
      <p className="mt-3 max-w-[68ch] text-xs text-slate-500">
        Printing on specialty film such as reflective or chrome is available by
        request — email the film you want and a WePrintWraps team member will come
        back with a price.
      </p>
    </section>
  );
}
