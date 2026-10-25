package org.jmri.modernui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.geom.Point2D;
import java.util.ArrayList;
import java.util.List;
import jmri.InstanceManager;
import jmri.Manager;
import jmri.NamedBean;
import jmri.jmrit.catalog.NamedIcon;
import jmri.jmrit.display.Editor;
import jmri.jmrit.display.EditorManager;
import jmri.jmrit.display.LightIcon;
import jmri.jmrit.display.MemoryIcon;
import jmri.jmrit.display.Positionable;
import jmri.jmrit.display.PositionableLabel;
import jmri.jmrit.display.SensorIcon;
import jmri.jmrit.display.SignalMastIcon;
import jmri.jmrit.display.TurnoutIcon;
import jmri.jmrit.display.layoutEditor.LayoutEditor;
import jmri.jmrit.display.layoutEditor.LayoutTrack;
import jmri.jmrit.display.layoutEditor.LayoutTrackView;
import jmri.server.json.JsonException;
import org.jdom2.Element;

/**
 * Editing open panels, as PanelPro's editors do: move, add and delete icons and labels, change a label's text,
 * and move Layout Editor track (turnouts, slips, turntables, anchor points; connected track follows).
 * <p>
 * Icons are found the way the /panel servlet describes them: by element name and position (and bean, when two
 * share a spot), so a stale client gets a 409 instead of changing the wrong thing. Changes are in memory until
 * stored (see {@link StoreConfig}); the panel servlet shows them straight away.
 */
final class PanelEditing {

    private static final String SMALL = "resources/icons/smallschematics/";

    private PanelEditing() {
    }

    /** As AbstractPanelServlet.getEditor: by window title. */
    private static Editor editor(String name, int id) throws JsonException {
        for (Editor e : InstanceManager.getDefault(EditorManager.class).getAll()) {
            if (e.getTargetFrame() != null && name.equals(e.getTargetFrame().getTitle())) {
                return e;
            }
        }
        throw new JsonException(404, "No open panel " + name, id);
    }

    private static String element(Positionable p) {
        try {
            Element e = jmri.configurexml.ConfigXmlManager.elementFromObject(p);
            return e != null ? e.getName() : "";
        } catch (RuntimeException ex) {
            return "";
        }
    }

    /** The icon a client means: {tag, x, y, bean?}. */
    private static Positionable find(Editor ed, JsonNode t, int id) throws JsonException {
        int x = t.path("x").asInt(Integer.MIN_VALUE);
        int y = t.path("y").asInt(Integer.MIN_VALUE);
        String tag = t.path("tag").asText("");
        String bean = t.path("bean").asText("");
        List<Positionable> at = new ArrayList<>();
        for (Positionable p : ed.getContents()) {
            if (p.getX() == x && p.getY() == y && (tag.isEmpty() || tag.equalsIgnoreCase(element(p)))) {
                at.add(p);
            }
        }
        if (at.size() > 1 && !bean.isEmpty()) {
            at.removeIf(p -> p.getNamedBean() == null
                    || !(bean.equals(p.getNamedBean().getSystemName()) || bean.equals(p.getNamedBean().getUserName())));
        }
        if (at.size() != 1) {
            throw new JsonException(409, at.isEmpty() ? "That item is no longer there; reload the panel" : "Several items are at that spot; move one in PanelPro", id);
        }
        return at.get(0);
    }

    private static void checkBean(Manager<? extends NamedBean> m, String name, String what, int id) throws JsonException {
        if (name.isEmpty() || m.getNamedBean(name) == null) {
            throw new JsonException(400, "No " + what + " named \"" + name + "\"", id);
        }
    }

    private static NamedIcon icon(String path) {
        return new NamedIcon(path, path);
    }

    /** A new icon with PanelPro's default look for its type (xml/defaultPanelIcons.xml). */
    private static Positionable create(Editor ed, JsonNode d, int id) throws JsonException {
        String kind = d.path("kind").asText("");
        String bean = d.path("bean").asText("").trim();
        switch (kind) {
            case "label": {
                String text = d.path("text").asText("").trim();
                if (text.isEmpty()) {
                    throw new JsonException(400, "A label needs text", id);
                }
                PositionableLabel l = new PositionableLabel(text, ed);
                l.setSize(l.getPreferredSize().width, l.getPreferredSize().height);
                l.setDisplayLevel(Editor.LABELS);
                return l;
            }
            case "sensor": {
                checkBean(InstanceManager.sensorManagerInstance(), bean, "sensor", id);
                SensorIcon s = new SensorIcon(icon(SMALL + "tracksegments/circuit-error.gif"), ed);
                s.setIcon("SensorStateActive", icon(SMALL + "tracksegments/circuit-occupied.gif"));
                s.setIcon("SensorStateInactive", icon(SMALL + "tracksegments/circuit-empty.gif"));
                s.setIcon("BeanStateInconsistent", icon(SMALL + "tracksegments/circuit-error.gif"));
                s.setIcon("BeanStateUnknown", icon(SMALL + "tracksegments/circuit-error.gif"));
                s.setSensor(bean);
                s.setDisplayLevel(Editor.SENSORS);
                return s;
            }
            case "turnout": {
                checkBean(InstanceManager.turnoutManagerInstance(), bean, "turnout", id);
                TurnoutIcon t = new TurnoutIcon(ed);
                String base = SMALL + "tracksegments/os-righthand-west-";
                t.setIcon("TurnoutStateClosed", icon(base + "closed.gif"));
                t.setIcon("TurnoutStateThrown", icon(base + "thrown.gif"));
                t.setIcon("BeanStateInconsistent", icon(base + "error.gif"));
                t.setIcon("BeanStateUnknown", icon(base + "unknown.gif"));
                t.setTurnout(bean);
                t.setDisplayLevel(Editor.TURNOUTS);
                return t;
            }
            case "light": {
                checkBean(InstanceManager.lightManagerInstance(), bean, "light", id);
                LightIcon l = new LightIcon(ed);
                l.setOffIcon(icon(SMALL + "lights/cross-off.png"));
                l.setOnIcon(icon(SMALL + "lights/cross-on.png"));
                l.setInconsistentIcon(icon(SMALL + "lights/cross-inconsistent.png"));
                l.setUnknownIcon(icon(SMALL + "lights/cross-unknown.png"));
                l.setLight(bean);
                l.setDisplayLevel(Editor.LIGHTS);
                return l;
            }
            case "signalMast": {
                checkBean(InstanceManager.getDefault(jmri.SignalMastManager.class), bean, "signal mast", id);
                SignalMastIcon m = new SignalMastIcon(ed);
                m.setSignalMast(bean);
                m.setDisplayLevel(Editor.SIGNALS);
                return m;
            }
            case "memory": {
                checkBean(InstanceManager.memoryManagerInstance(), bean, "memory", id);
                MemoryIcon m = new MemoryIcon(" ", ed);
                m.setMemory(bean);
                m.setDisplayLevel(Editor.MEMORIES);
                return m;
            }
            default:
                throw new JsonException(400, "Can't add a " + kind, id);
        }
    }

    private static LayoutTrackView track(Editor ed, String ident, int id) throws JsonException {
        if (!(ed instanceof LayoutEditor)) {
            throw new JsonException(400, "Only Layout Editor panels have track", id);
        }
        LayoutEditor le = (LayoutEditor) ed;
        for (LayoutTrack t : le.getLayoutTracks()) {
            if (ident.equals(t.getId()) || ident.equals(t.getName())) {
                return le.getLayoutTrackView(t);
            }
        }
        throw new JsonException(404, "No track " + ident + " on this panel", id);
    }

    /**
     * {name: panel title, op: "move"|"delete"|"text"|"add"|"moveTrack", target: {tag, x, y, bean?}, x, y, text,
     * kind, bean, ident}.
     */
    static ObjectNode edit(ObjectMapper mapper, String name, JsonNode d, int id) throws JsonException {
        Editor ed = editor(name, id);
        String op = d.path("op").asText("");
        return Logic.onGui(() -> {
            switch (op) {
                case "move": {
                    Positionable p = find(ed, d.path("target"), id);
                    p.setLocation(d.path("x").asInt(), d.path("y").asInt());
                    break;
                }
                case "delete":
                    find(ed, d.path("target"), id).remove();
                    break;
                case "text": {
                    Positionable p = find(ed, d.path("target"), id);
                    if (!(p instanceof PositionableLabel) || !((PositionableLabel) p).isText() || ((PositionableLabel) p).getNamedBean() != null) {
                        throw new JsonException(400, "Only a text label's text can be changed", id);
                    }
                    PositionableLabel l = (PositionableLabel) p;
                    l.setText(d.path("text").asText(""));
                    l.setSize(l.getPreferredSize().width, l.getPreferredSize().height);
                    break;
                }
                case "add": {
                    Positionable p = create(ed, d, id);
                    p.setLocation(Math.max(0, d.path("x").asInt()), Math.max(0, d.path("y").asInt()));
                    try {
                        ed.putItem(p);
                    } catch (Positionable.DuplicateIdException e) {
                        throw new JsonException(409, "Duplicate id", id);
                    }
                    p.updateSize();
                    break;
                }
                case "moveTrack":
                    track(ed, d.path("ident").asText(""), id).setCoordsCenter(new Point2D.Double(d.path("x").asDouble(), d.path("y").asDouble()));
                    break;
                default:
                    throw new JsonException(400, "Unknown panel edit " + op, id);
            }
            if (ed instanceof LayoutEditor) {
                ((LayoutEditor) ed).setDirty(true);
                ((LayoutEditor) ed).redrawPanel();
            } else {
                ed.getTargetPanel().repaint();
            }
            ObjectNode r = mapper.createObjectNode();
            r.put("name", name);
            r.put("op", op);
            r.put("ok", true);
            return r;
        }, id);
    }
}
