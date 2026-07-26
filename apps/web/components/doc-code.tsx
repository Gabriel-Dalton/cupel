'use client'

import { useRef, type ComponentPropsWithoutRef } from 'react'
import { CopyButton } from './copy-button'

/**
 * Every fenced code block in the docs, with a copy button attached.
 *
 * The text comes from the rendered DOM rather than from the MDX children,
 * because a fence can contain nested elements once syntax highlighting or
 * autolinking gets involved, and textContent is exactly what a reader would
 * have got by selecting the block by hand.
 */
export function DocCode({ children, ...rest }: ComponentPropsWithoutRef<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)

  return (
    <div className="cmd-block cmd-block--doc">
      <pre {...rest} ref={ref} tabIndex={0}>
        {children}
      </pre>
      <div className="cmd-block__tools">
        <CopyButton text={() => ref.current?.textContent ?? ''} describes="this code block" />
      </div>
    </div>
  )
}
