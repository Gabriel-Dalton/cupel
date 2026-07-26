export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4rem 1.5rem',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          fontSize: '0.85rem',
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: '#9a938a',
          marginBottom: '1.25rem',
        }}
      >
        cupel
      </p>
      <h1
        style={{
          fontSize: 'clamp(1.8rem, 4.5vw, 3.2rem)',
          maxWidth: '46rem',
          lineHeight: 1.15,
          margin: 0,
        }}
      >
        Assay before you compress.
      </h1>
      <p style={{ maxWidth: '38rem', color: '#b5aea4', lineHeight: 1.6, marginTop: '1.5rem' }}>
        Find the best surviving original, work out how much quality it has left, spend the
        page&apos;s byte budget where it buys the most, and leave a receipt anyone can check.
      </p>
      <p style={{ color: '#6f6a63', fontSize: '0.9rem', marginTop: '2.5rem' }}>
        Pre-release. The metrics exist; the rest is being built in the open.
      </p>
    </main>
  )
}
