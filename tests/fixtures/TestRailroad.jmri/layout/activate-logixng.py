# JmriFaceless sets up LogixNGs before startup actions run, so LogixNGs loaded
# by a startup "Open file" action stay inactive. Run this after those loads.
import jmri

manager = jmri.InstanceManager.getDefault(jmri.jmrit.logixng.LogixNG_Manager)
manager.setupAllLogixNGs()
manager.activateAllLogixNGs()
