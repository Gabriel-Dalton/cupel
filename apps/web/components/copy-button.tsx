'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A copy button for a command block.
 *
 * Every command on this site is meant to be run, and retyping a clone URL by
 * hand is the sort of small friction that stops someone trying the tool at
 * all. The button reports what happened rather than assuming success: clipboard
 * writes fail on an insecure origin and in a few older browsers, and a button
 * that silently does nothing is worse than one that tells you to press the
 * keys yourself.
 *
 * `text` may be a function so a docs block can read the text it actually
 * rendered instead of having the command duplicated in two places.
 */

type Phase = 'idle' | 'copied' | 'failed'

const WORD: Record<Phase, string> = {
  idle: 'Copy',
  copied: 'Copied',
  failed: 'Press ctrl C',
}

/** How long the confirmation stays before the button goes back to Copy. */
const SETTLE_MS = 2000

/**
 * The pre-clipboard-API path, also used when the modern call is blocked. The
 * textarea has to be in the document and selected for execCommand to see it,
 * so it is added off screen and removed straight after.
 */
function copyBySelection(value: string): boolean {
  const area = document.createElement('textarea')
  area.value = value
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '-9999px'
  document.body.append(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

export function CopyButton({
  text,
  describes,
}: {
  text: string | (() => string)
  /** What is being copied, for the label a screen reader hears. */
  describes?: string
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const timer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  const onClick = useCallback(async () => {
    const value = typeof text === 'function' ? text() : text
    let ok = false
    try {
      await navigator.clipboard.writeText(value)
      ok = true
    } catch {
      ok = copyBySelection(value)
    }
    setPhase(ok ? 'copied' : 'failed')
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPhase('idle'), SETTLE_MS)
  }, [text])

  const label = describes ? `Copy ${describes}` : 'Copy'

  return (
    <button type="button" className="copy" onClick={onClick} aria-label={label}>
      <span aria-hidden="true" className="copy__glyph">
        {phase === 'copied' ? <TickGlyph /> : <ClipGlyph />}
      </span>
      <span className="copy__word">{WORD[phase]}</span>
      <span role="status" className="copy__announce">
        {phase === 'copied' ? 'Copied to clipboard' : ''}
        {phase === 'failed' ? 'Copying was blocked by the browser' : ''}
      </span>
    </button>
  )
}

function ClipGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect
        x="5.25"
        y="2.25"
        width="8.5"
        height="10.5"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M10.75 13.75v.5a1.5 1.5 0 0 1-1.5 1.5H3.5A1.5 1.5 0 0 1 2 14.25V5.5A1.5 1.5 0 0 1 3.5 4h.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        transform="translate(0 -1.5)"
      />
    </svg>
  )
}

function TickGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path
        d="M3 8.6 6.2 11.8 13 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
