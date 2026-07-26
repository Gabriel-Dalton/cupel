import { CopyButton } from './copy-button'

/**
 * A command block with a copy button. Server rendered, so the command text is
 * in the HTML and selectable even before the button becomes interactive.
 *
 * The `pre` keeps its own tabIndex because a block can scroll sideways on a
 * narrow screen and a keyboard user needs to be able to reach it.
 */
export function CommandBlock({
  command,
  describes,
}: {
  command: string
  /** What the command does, for the button's screen reader label. */
  describes?: string
}) {
  return (
    <div className="cmd-block">
      <pre className="cmd" tabIndex={0}>
        <code>{command}</code>
      </pre>
      <div className="cmd-block__tools">
        <CopyButton text={command} describes={describes} />
      </div>
    </div>
  )
}
