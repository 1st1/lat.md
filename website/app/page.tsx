function Cmd({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        color: '#bbb',
        background: '#222',
        borderRadius: '4px',
        padding: '1px 5px',
        fontSize: '0.9em',
      }}
    >
      {children}
    </span>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: '#ccc',
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: '0.15em',
        marginBottom: '1.5vh',
      }}
    >
      {children}
    </div>
  )
}

const mono =
  'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono", monospace'

export default function Home() {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#000',
        color: '#fff',
        fontFamily: mono,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4vh 24px',
        gap: '4vh',
      }}
    >
      {/* Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.svg"
        alt="lat.md"
        style={{
          width: '100%',
          maxWidth: '55ch',
          height: 'auto',
        }}
      />

      {/* Tagline */}
      <p
        style={{
          color: '#999',
          fontSize: 14,
          textAlign: 'center',
          margin: 0,
          maxWidth: '44ch',
          lineHeight: 1.5,
          letterSpacing: '0.04em',
        }}
      >
        A knowledge graph for your codebase, written in markdown.
      </p>

      {/* Goals + Install + Key Ideas */}
      <div style={{ marginTop: '2vh', maxWidth: '55ch' }}>

        {/* Goals */}
        <div>
          <SectionLabel>Goals</SectionLabel>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              fontSize: 14,
              lineHeight: 1.45,
              color: '#999',
            }}
          >
            <li>* Spec that your agent keeps in sync with the codebase</li>
            <li>* Make agents understand big ideas and key business logic</li>
            <li>* Ensure corner cases have proper high-level tests that matter</li>
            <li>* Start reviewing agent diffs: focus on knowledge, not code</li>
            <li>* Speed up coding by saving agents endless grepping</li>
          </ul>
        </div>

        {/* Install */}
        <div style={{ marginTop: '5vh' }}>
          <SectionLabel>Install</SectionLabel>
          <code
            style={{
              display: 'block',
              background: '#151515',
              border: '1px solid #444',
              borderRadius: '6px',
              padding: '14px 48px 14px 16px',
              fontSize: 14,
              color: '#ddd',
              boxSizing: 'border-box',
            }}
          >
            <span className="nosel" style={{ color: '#888' }}>$ </span>
            npm i -g lat.md
          </code>
          <div
            style={{
              color: '#888',
              fontSize: 14,
              marginTop: '10px',
            }}
          >
            then run <Cmd><span style={{ color: '#ccc' }}>lat init</span></Cmd> in your project
          </div>
        </div>

        {/* Key Ideas */}
        <div style={{ marginTop: '5vh' }}>
          <SectionLabel>Key Ideas</SectionLabel>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              fontSize: 14,
              lineHeight: 1.45,
              color: '#999',
            }}
          >
            <li>* Plain markdown: readable by humans, parseable by agents</li>
            <li>* Wiki links connect concepts into a navigable graph</li>
            <li>* <Cmd>// @lat:</Cmd> and <Cmd># @lat:</Cmd> comments tie source code to specs</li>
            <li>* <Cmd>lat check</Cmd> ensures nothing drifts out of sync</li>
            <li>* <Cmd>lat search</Cmd> for semantic vector search across all sections</li>
            <li style={{ marginTop: '1em' }}>
              <span style={{ color: '#999' }}>Read the </span>
              <a
                className="foot"
                href="https://github.com/1st1/lat.md#readme"
              >
                README →
              </a>
            </li>
          </ul>
        </div>

        {/* What's New */}
        <div style={{ marginTop: '5vh' }}>
          <SectionLabel>{"What's New"}</SectionLabel>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              fontSize: 14,
              lineHeight: 1.45,
            }}
          >
            {[
              { v: '0.12', text: <>Offline semantic search — <Cmd>lat search</Cmd> works with no API key via a bundled local WASM embedding model; new <Cmd>lat reindex</Cmd> command to rebuild the index and switch backends; Windows support</> },
              { v: '0.11', text: <><Cmd>lat init</Cmd> supports Codex, OpenCode, and Cursor stop hook</> },
              { v: '0.10', text: <><Cmd>lat section</Cmd> and <Cmd>lat refs</Cmd> show source code snippets; ripgrep-powered code scanning</> },
              { v: '0.9', text: <><Cmd>lat init</Cmd> creates a lat skill for supported agents</> },
              { v: '0.8', text: <>Pi coding agent integration; interactive arrow-key menus in <Cmd>lat init</Cmd></> },
              { v: '0.7', text: <>Multi-language source links (Rust, Go, C); <Cmd>lat section</Cmd> and <Cmd>lat expand</Cmd> commands; section structure validation</> },
              { v: '0.6', text: <>Source code wiki links — reference functions and classes directly from specs: <Cmd>{'[[src/foo.ts#myFunc]]'}</Cmd></> },
              { v: '0.5', text: <>Auto-suggest <Cmd>lat init</Cmd> when no <Cmd>lat.md/</Cmd> found; section IDs now include h1 heading</> },
            ].slice(0, 7).map(({ v, text }, i, arr) => {
              const t = 1 - i / (arr.length - 1 || 1)
              const c = Math.round(80 + 73 * t)
              const textColor = `rgb(${c}, ${c}, ${c})`
              const vc = Math.round(40 + 50 * t)
              const versionColor = `rgb(${vc}, ${vc}, ${vc})`
              return (
                <li key={v} style={{ display: 'flex', gap: '1.5ch', paddingLeft: 0, textIndent: 0, color: textColor }}>
                  <span style={{ color: versionColor, flexShrink: 0, minWidth: '4ch', textAlign: 'right' }}>{v}</span>
                  <span>{text}</span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      {/* Links */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginTop: '3vh',
          fontSize: 13,
        }}
      >
        <a className="foot" href="https://x.com/1st1">@1st1</a>
        <span style={{ color: '#666' }}>|</span>
        <a className="foot" href="https://github.com/1st1/lat.md">GitHub</a>
        <span style={{ color: '#666' }}>|</span>
        <a className="foot" href="https://www.npmjs.com/package/lat.md">npm</a>
      </div>
    </div>
  )
}
