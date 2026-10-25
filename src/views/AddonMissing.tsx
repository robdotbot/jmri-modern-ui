/** Shown in place of features that need the server add-on (addon/) when JMRI doesn't have it. */
export function AddonMissing({ feature }: { feature: string }) {
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="card pad">
        <h2>{feature} needs the JMRI add-on</h2>
        <p>
          JMRI's web server has no {feature.toLowerCase()} support of its own. This app comes with a small add-on that
          provides it. The add-on plugs into JMRI's extension point, so your JMRI install itself isn't changed.
        </p>
        <ol>
          <li>
            On the JMRI computer, in this app's folder, run <span className="mono">npm run build:addon</span> and then{' '}
            <span className="mono">npm run deploy -- --configure</span>. That copies{' '}
            <span className="mono">jmri-modern-ui-addon.jar</span> into the JMRI settings folder and adds it to{' '}
            <span className="mono">jmri.conf</span>, so JMRI's launcher loads it.
          </li>
          <li>
            Or by hand: add <span className="mono">--cp:a=/full/path/to/jmri-modern-ui-addon.jar</span> to{' '}
            <span className="mono">default_options</span> in <span className="mono">jmri.conf</span> in the JMRI settings
            folder. On Windows, copy the jar into JMRI's <span className="mono">lib</span> folder instead.
          </li>
          <li>Restart JMRI.</li>
        </ol>
      </div>
    </div>
  )
}
