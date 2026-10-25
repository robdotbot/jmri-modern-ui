/** Shown in place of features that need the server add-on (addon/) when JMRI doesn't have it. */
export function AddonMissing({ feature }: { feature: string }) {
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="card pad">
        <h2>{feature} needs the JMRI add-on</h2>
        <p>
          JMRI's web server has no {feature.toLowerCase()} support of its own. This app ships a small add-on jar that
          adds it without changing your JMRI install.
        </p>
        <ol>
          <li>
            Copy <span className="mono">jmri-modern-ui-addon.jar</span> into your JMRI settings folder (on a Mac,{' '}
            <span className="mono">~/Library/Preferences/JMRI</span>). <span className="mono">npm run deploy</span> does this.
          </li>
          <li>
            Add this line to <span className="mono">jmri.conf</span> in that folder:
            <pre className="mono code">default_options="--cp:a=jmri-modern-ui-addon.jar"</pre>
          </li>
          <li>Restart JMRI.</li>
        </ol>
      </div>
    </div>
  )
}
