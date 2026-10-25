package org.jmri.modernui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import jmri.InstanceManager;
import jmri.Programmer;
import jmri.implementation.ProgrammerFacadeSelector;
import jmri.jmrit.XmlFile;
import jmri.jmrit.decoderdefn.DecoderFile;
import jmri.jmrit.decoderdefn.DecoderIndexFile;
import jmri.jmrit.roster.LocoFile;
import jmri.jmrit.roster.Roster;
import jmri.jmrit.roster.RosterEntry;
import jmri.jmrit.symbolicprog.ProgDefault;
import jmri.server.json.JsonException;
import org.jdom2.Element;
import org.jdom2.JDOMException;
import org.jdom2.output.Format;
import org.jdom2.output.XMLOutputter;

/**
 * DecoderPro's data, for the web app's decoder panes: decoder definitions and programmer (pane) files with
 * their XIncludes resolved by JMRI's own loader, a roster entry's stored CV values, and programmers wrapped in
 * the facades a decoder file asks for (indexed CVs and the like), as DecoderPro does.
 */
final class DecoderSupport {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(DecoderSupport.class);
    /** File names as they appear in decoderIndex.xml; nothing that could leave the folder. */
    private static final Pattern SAFE_NAME = Pattern.compile("[\\w .()+&,'-]+(\\.xml)?");
    private static final Map<String, Element> PROGRAMMING = new HashMap<>();

    private DecoderSupport() {
    }

    /** {file} → the decoder definition; {programmer} → a programmer file ("" for DecoderPro's default). */
    static ObjectNode definition(ObjectMapper mapper, JsonNode data, int id) throws JsonException {
        ObjectNode r = mapper.createObjectNode();
        String file = data.path("file").asText("");
        String path;
        if (!file.isEmpty()) {
            path = DecoderFile.fileLocation + safe(file, id);
            r.put("file", file);
        } else {
            String programmer = data.path("programmer").asText("");
            if (programmer.isEmpty()) {
                // DecoderPro's choice; unset until someone picks one there.
                programmer = ProgDefault.getDefaultProgFile();
                if (programmer == null || programmer.isEmpty()) {
                    programmer = "Comprehensive";
                }
            }
            programmer = safe(programmer.replaceFirst("\\.xml$", ""), id);
            path = "programmers" + File.separator + programmer + ".xml";
            r.put("programmer", programmer);
        }
        Element root = load(path, id);
        // Comments make up a good part of the big definitions (and still mention their XIncludes).
        List<org.jdom2.Comment> comments = new java.util.ArrayList<>();
        root.getDescendants(org.jdom2.filter.Filters.comment()).forEach(comments::add);
        comments.forEach(org.jdom2.Comment::detach);
        r.put("xml", new XMLOutputter(Format.getCompactFormat()).outputString(root));
        return r;
    }

    private static Element load(String path, int id) throws JsonException {
        try {
            return new XmlFile() {
            }.rootFromName(path);
        } catch (JDOMException | IOException e) {
            throw new JsonException(404, "Can't read " + path + ": " + e.getMessage(), id);
        }
    }

    private static String safe(String name, int id) throws JsonException {
        if (!SAFE_NAME.matcher(name).matches() || name.contains("..")) {
            throw new JsonException(400, "Bad file name " + name, id);
        }
        return name;
    }

    // ---- roster ----

    private static RosterEntry entry(String name, int id) throws JsonException {
        RosterEntry e = Roster.getDefault().getEntryForId(name);
        if (e == null) {
            throw new JsonException(404, "No roster entry " + name, id);
        }
        return e;
    }

    private static File file(RosterEntry e) {
        return new File(Roster.getDefault().getRosterFilesLocation() + e.getFileName());
    }

    /** The decoder the roster entry is set to, its definition file, and the CV values DecoderPro stored. */
    static ObjectNode rosterCvs(ObjectMapper mapper, String name, int id) throws JsonException {
        RosterEntry e = entry(name, id);
        ObjectNode r = mapper.createObjectNode();
        r.put("name", e.getId());
        r.put("decoderFamily", e.getDecoderFamily());
        r.put("decoderModel", e.getDecoderModel());
        List<DecoderFile> matches = InstanceManager.getDefault(DecoderIndexFile.class)
                .matchingDecoderList(null, e.getDecoderFamily(), null, null, null, e.getDecoderModel());
        r.put("file", matches.isEmpty() ? null : matches.get(0).getFileName());
        ObjectNode values = r.putObject("values");
        try {
            Element loco = new LocoFile().rootFromFile(file(e)).getChild("locomotive");
            Element v = loco != null ? loco.getChild("values") : null;
            if (v != null) {
                for (Element cv : v.getChildren("CVvalue")) {
                    ObjectNode c = values.putObject(cv.getAttributeValue("name"));
                    c.put("value", Integer.parseInt(cv.getAttributeValue("value")));
                    c.put("state", cv.getAttributeValue("state", ""));
                }
            }
        } catch (JDOMException | IOException | NumberFormatException ex) {
            log.debug("No stored values for {}", name, ex);
        }
        return r;
    }

    /**
     * Store CV values ({"values": {"29": {"value": 6, "state": "Read"}}}) and optionally the decoder
     * ({"decoderFamily", "decoderModel"}) in a roster entry's file, keeping its other content.
     */
    static ObjectNode saveRosterCvs(ObjectMapper mapper, String name, JsonNode data, int id) throws JsonException {
        RosterEntry e = entry(name, id);
        File f = file(e);
        LocoFile lf = new LocoFile();
        Element root;
        try {
            root = lf.rootFromFile(f).clone();
        } catch (JDOMException | IOException ex) {
            throw new JsonException(500, "Can't read " + f + ": " + ex.getMessage(), id);
        }
        Element loco = root.getChild("locomotive");
        Element values = loco.getChild("values");
        if (values == null) {
            values = new Element("values");
            loco.addContent(values);
        }
        JsonNode changes = data.path("values");
        if (changes.size() > 0) {
            // Variable values are derived from the CVs; DecoderPro rebuilds them on its next save.
            values.removeChild("decoderDef");
            java.util.Iterator<Map.Entry<String, JsonNode>> it = changes.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> c = it.next();
                Element cv = null;
                for (Element x : values.getChildren("CVvalue")) {
                    if (c.getKey().equals(x.getAttributeValue("name"))) {
                        cv = x;
                    }
                }
                if (cv == null) {
                    cv = new Element("CVvalue").setAttribute("name", c.getKey());
                    values.addContent(cv);
                }
                cv.setAttribute("value", String.valueOf(c.getValue().path("value").asInt()));
                cv.setAttribute("state", c.getValue().path("state").asText("Edited"));
            }
        }
        if (data.has("decoderModel")) {
            e.setDecoderFamily(data.path("decoderFamily").asText(""));
            e.setDecoderModel(data.path("decoderModel").asText(""));
        }
        e.changeDateUpdated();
        lf.makeBackupFile(f.getPath());
        lf.writeFile(f, root, e.store());
        Roster.getDefault().writeRoster();
        return rosterCvs(mapper, name, id);
    }

    // ---- programmer facades ----

    /** Wrap {@code p} in the facades the decoder file's programming element declares, as DecoderPro does. */
    static Programmer withFacades(Programmer p, String decoderFile, int id) throws JsonException {
        if (decoderFile == null || decoderFile.isEmpty()) {
            return p;
        }
        Element programming;
        synchronized (PROGRAMMING) {
            programming = PROGRAMMING.get(decoderFile);
            if (programming == null) {
                Element decoder = load(DecoderFile.fileLocation + safe(decoderFile, id), id).getChild("decoder");
                programming = decoder != null ? decoder.getChild("programming") : null;
                if (programming == null) {
                    programming = new Element("programming");
                }
                PROGRAMMING.put(decoderFile, programming);
            }
        }
        return ProgrammerFacadeSelector.loadFacadeElements(programming, p, true, p);
    }
}
