import type { Metadata } from 'next'
import Link from 'next/link'
import { VerifyClient } from './verify-client'
import styles from './verify.module.css'

export const metadata: Metadata = {
  title: 'Verify',
  description:
    'Check a cupel receipt in your browser: re-measure the shipped bytes against the recorded ledger entry. Nothing is uploaded and nothing is re-encoded.',
}

/**
 * /verify: the page where a fidelity claim gets falsified or confirmed in
 * thirty seconds. The static shell carries the refusal-led framing; all
 * byte handling lives in the client component.
 */
export default function VerifyPage() {
  return (
    <div className={`shell ${styles.page}`}>
      <header>
        <p className="eyebrow eyebrow--accent">Verify · the receipts</p>
        <h1 className={styles.title}>Take no receipt on faith.</h1>
        <p className={styles.lede}>
          Every entry in a cupel ledger is a claim about bytes, and claims get checked. Drop a{' '}
          <code>.cupel/ledger.jsonl</code> and the image files it describes: this page recomputes
          every hash and re-measures every recorded number from the bytes themselves, in your
          browser. Files never leave your machine.
        </p>
        <div className="defaults">
          <div className="defaults__rule">
            <h2>Refuses to trust the ledger</h2>
            <p>
              Structure, colour drift, and distortion are recomputed from the shipped bytes, never
              read back from the receipt. The recorded numbers either reproduce or they do not.
            </p>
          </div>
          <div className="defaults__rule">
            <h2>Refuses to re-encode</h2>
            <p>
              Verification only decodes and measures, so encoder differences between machines
              cannot blur the verdict. Byte-for-byte reproduction is not required, and not
              attempted.
            </p>
          </div>
          <div className="defaults__rule">
            <h2>Refuses to guess</h2>
            <p>
              A missing file, bytes that fail to hash to what the ledger recorded, or a reference
              this page cannot re-derive are each reported as exactly that, never papered over.
            </p>
          </div>
        </div>
      </header>

      <VerifyClient />

      <footer className={styles.toleranceNote}>
        <p>
          Allowed drift is fixed and documented: re-measured structure may differ from the recorded
          value by at most 0.002 and colour drift by 0.1, because conforming decoders are permitted
          to disagree by about one code value per sample. Anything past that refutes the receipt.
          Entries recorded as kept, refused, or skipped claim the file was not changed, so they are
          checked by hash alone. Details live in the <Link href="/docs/metrics">metrics docs</Link>.
        </p>
      </footer>
    </div>
  )
}
