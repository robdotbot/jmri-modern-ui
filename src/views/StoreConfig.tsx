import { useEffect, useState } from 'react'
import { useClient, useJmri, useToast } from '../state.tsx'

/**
 * Edits made here live in JMRI's memory, like edits in PanelPro, until the configuration is stored. This offers
 * PanelPro's "Store tables and panels" to one of the files JMRI loaded.
 */
export function StoreConfig() {
  const client = useClient()
  const toast = useToast()
  const unstored = useJmri((s) => s.unstored)
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<{ file: string; name: string }[] | null>(null)
  const [file, setFile] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    client.storeTargets().then(
      (f) => {
        setFiles(f)
        setFile((cur) => cur || f[0]?.file || '')
      },
      (e) => toast(`Couldn't list JMRI's files: ${(e as Error).message}`),
    )
  }, [open, client, toast])

  return (
    <div className="store-config">
      {unstored && <span className="pill warn">Not stored yet</span>}
      <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        Store…
      </button>
      {open && (
        <div className="card pad store-pop" role="dialog" aria-label="Store configuration">
          <p className="small" style={{ margin: 0 }}>
            Changes are live in JMRI now, but are lost when it restarts unless stored. Storing writes all tables and panels to
            the file, as PanelPro's <em>Store tables and panels</em> does (a backup of the old file is kept).
          </p>
          {files && files.length === 0 && <p className="muted small">JMRI didn't load its configuration from a file; store it from PanelPro.</p>}
          {files && files.length > 0 && (
            <>
              <select className="input" aria-label="File to store to" value={file} onChange={(e) => setFile(e.target.value)}>
                {files.map((f) => (
                  <option key={f.file} value={f.file}>
                    {f.name}
                  </option>
                ))}
              </select>
              {files.length > 1 && <p className="muted small">JMRI loaded several files. Storing puts everything into the one you pick.</p>}
              <div className="row-end">
                <button className="btn" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  disabled={busy || !file}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await client.storeConfig(file)
                      toast(`Stored to ${files.find((f) => f.file === file)?.name}`)
                      setOpen(false)
                    } catch (e) {
                      toast(`Store failed: ${(e as Error).message}`)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Store
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
