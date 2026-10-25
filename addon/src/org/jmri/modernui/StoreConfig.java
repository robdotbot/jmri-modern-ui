package org.jmri.modernui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.File;
import java.util.LinkedHashMap;
import java.util.Map;
import jmri.ConfigureManager;
import jmri.InstanceManager;
import jmri.configurexml.LoadXmlUserAction;
import jmri.server.json.JsonException;
import jmri.util.FileUtil;
import jmri.util.startup.PerformFileModel;
import jmri.util.startup.StartupActionsManager;

/**
 * PanelPro's "Store tables and panels": edits made here (Logix, LogixNG, panels) live in JMRI's memory until
 * stored. The files offered are the ones JMRI loaded: those opened at start up, and the last one opened from the
 * File menu. Storing writes everything JMRI has loaded into the chosen file, exactly as PanelPro's Store does.
 */
final class StoreConfig {

    private StoreConfig() {
    }

    /** Portable path → file. */
    private static Map<String, File> candidates() {
        Map<String, File> out = new LinkedHashMap<>();
        StartupActionsManager sam = InstanceManager.getNullableDefault(StartupActionsManager.class);
        if (sam != null) {
            for (PerformFileModel m : sam.getActions(PerformFileModel.class)) {
                if (m.getFileName() != null && m.getFileName().endsWith(".xml")) {
                    out.put(m.getFileName(), new File(FileUtil.getExternalFilename(m.getFileName())));
                }
            }
        }
        File current = LoadXmlUserAction.getCurrentFile();
        if (current != null) {
            out.put(FileUtil.getPortableFilename(current), current);
        }
        return out;
    }

    static ObjectNode get(ObjectMapper mapper) {
        ObjectNode r = mapper.createObjectNode();
        ArrayNode files = r.putArray("files");
        candidates().forEach((portable, f) -> {
            ObjectNode n = files.addObject();
            n.put("file", portable);
            n.put("name", f.getName());
            n.put("exists", f.exists());
        });
        return r;
    }

    static ObjectNode store(ObjectMapper mapper, JsonNode data, int id) throws JsonException {
        String wanted = data.path("file").asText("");
        File f = candidates().get(wanted);
        if (f == null) {
            throw new JsonException(400, "Can only store to a file JMRI loaded: " + String.join(", ", candidates().keySet()), id);
        }
        ConfigureManager cm = InstanceManager.getNullableDefault(ConfigureManager.class);
        if (cm == null) {
            throw new JsonException(503, "JMRI has no configuration manager", id);
        }
        boolean ok = Logic.onGui(() -> {
            cm.makeBackup(f);
            return cm.storeUser(f);
        }, id);
        if (!ok) {
            throw new JsonException(500, "JMRI reported problems storing " + f.getName() + "; see its log", id);
        }
        ObjectNode r = get(mapper);
        r.put("stored", wanted);
        return r;
    }
}
