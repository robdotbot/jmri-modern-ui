package org.jmri.modernui;

import static org.jmri.modernui.ModernUiServiceFactory.ADDON;
import static org.jmri.modernui.ModernUiServiceFactory.LOGIX;
import static org.jmri.modernui.ModernUiServiceFactory.LOGIXNG;
import static org.jmri.modernui.ModernUiServiceFactory.PROGRAMMER;
import static org.jmri.modernui.ModernUiServiceFactory.SIGNAL_ASPECTS;
import static org.jmri.modernui.ModernUiServiceFactory.TRAIN_ACTION;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.Locale;
import jmri.AddressedProgrammerManager;
import jmri.Conditional;
import jmri.ConditionalAction;
import jmri.ConditionalVariable;
import jmri.GlobalProgrammerManager;
import jmri.InstanceManager;
import jmri.Logix;
import jmri.LogixManager;
import jmri.Programmer;
import jmri.ProgrammingMode;
import jmri.SignalAppearanceMap;
import jmri.SignalHead;
import jmri.SignalHeadManager;
import jmri.SignalMast;
import jmri.SignalMastManager;
import jmri.jmrit.logixng.ConditionalNG;
import jmri.jmrit.logixng.LogixNG;
import jmri.jmrit.logixng.LogixNG_Manager;
import jmri.jmrit.operations.trains.Train;
import jmri.jmrit.operations.trains.TrainManager;
import jmri.server.json.JsonException;
import jmri.server.json.JsonHttpService;
import jmri.server.json.JsonRequest;
import jmri.web.server.WebServer;
import org.apache.commons.lang3.mutable.MutableInt;

/** Synchronous parts of the add-on: Logix/LogixNG and programmer status. */
public class ModernUiHttpService extends JsonHttpService {

    public ModernUiHttpService(ObjectMapper mapper) {
        super(mapper);
    }

    @Override
    public JsonNode doGet(String type, String name, JsonNode data, JsonRequest request) throws JsonException {
        switch (type) {
            case ADDON:
                ObjectNode a = mapper.createObjectNode();
                a.put("version", ModernUiServiceFactory.VERSION);
                return message(ADDON, a, request.id);
            case PROGRAMMER:
                return message(PROGRAMMER, programmerStatus(), request.id);
            case LOGIX:
                return message(LOGIX, logix(findLogix(name, request)), request.id);
            case LOGIXNG:
                return message(LOGIXNG, logixNG(findLogixNG(name, request)), request.id);
            case SIGNAL_ASPECTS:
                return message(SIGNAL_ASPECTS, signalAspects(name, data.path("imageset").asText("default"), request), request.id);
            default:
                throw new JsonException(400, "Unknown type " + type, request.id);
        }
    }

    // ---- signals ----

    private ObjectNode signalAspects(String name, String imageset, JsonRequest request) throws JsonException {
        ObjectNode data = mapper.createObjectNode();
        data.put("name", name);
        SignalMast mast = InstanceManager.getDefault(SignalMastManager.class).getNamedBean(name);
        if (mast != null) {
            data.put("kind", "mast");
            data.put("signalSystem", mast.getSignalSystem() != null ? mast.getSignalSystem().getSystemName() : null);
            data.put("mastType", mast.getMastType());
            ArrayNode aspects = data.putArray("aspects");
            SignalAppearanceMap map = mast.getAppearanceMap();
            for (String aspect : mast.getValidAspects()) {
                ObjectNode a = aspects.addObject();
                a.put("aspect", aspect);
                a.put("image", imageUrl(map, aspect, imageset));
            }
            data.put("heldImage", imageUrl(map, "$held", imageset));
            data.put("darkImage", imageUrl(map, "$dark", imageset));
            return data;
        }
        SignalHead head = InstanceManager.getDefault(SignalHeadManager.class).getNamedBean(name);
        if (head != null) {
            data.put("kind", "head");
            ArrayNode states = data.putArray("appearances");
            int[] values = head.getValidStates();
            String[] names = head.getValidStateNames();
            for (int i = 0; i < values.length; i++) {
                ObjectNode a = states.addObject();
                a.put("appearance", values[i]);
                a.put("name", i < names.length ? names[i] : String.valueOf(values[i]));
            }
            return data;
        }
        throw new JsonException(404, "No signal mast or head " + name, request.id);
    }

    /** Same conversion JMRI's panel servlet uses for aspect icons; null when the map has no image. */
    private static String imageUrl(SignalAppearanceMap map, String aspect, String imageset) {
        String url;
        try {
            url = map != null ? map.getImageLink(aspect, imageset) : null;
        } catch (RuntimeException e) {
            return null;
        }
        if (url == null || url.isEmpty()) {
            return null;
        }
        if (url.contains("preference:")) {
            return WebServer.portablePathToURI(url);
        }
        int i = url.indexOf("resources");
        return i >= 0 ? "/" + url.substring(i) : url;
    }

    // ---- operations ----

    private ObjectNode trainAction(String name, JsonNode data, JsonRequest request) throws JsonException {
        Train train = InstanceManager.getDefault(TrainManager.class).getTrainById(name);
        if (train == null) {
            throw new JsonException(404, "No train with id " + name, request.id);
        }
        String action = data.path("action").asText("");
        boolean ok;
        switch (action) {
            case "build":
                ok = train.build();
                break;
            case "reset":
                ok = train.reset();
                break;
            case "move":
                if (!train.isBuilt()) {
                    throw new JsonException(428, "Train " + train.getName() + " is not built", request.id);
                }
                train.move();
                ok = true;
                break;
            case "terminate":
                train.terminate();
                ok = true;
                break;
            default:
                throw new JsonException(400, "action must be build, reset, move or terminate", request.id);
        }
        ObjectNode r = mapper.createObjectNode();
        r.put("name", name);
        r.put("action", action);
        r.put("ok", ok);
        r.put("status", train.getStatus());
        r.put("built", train.isBuilt());
        r.put("location", train.getCurrentLocationName());
        return r;
    }

    @Override
    public JsonNode doGetList(String type, JsonNode data, JsonRequest request) throws JsonException {
        ArrayNode array = mapper.createArrayNode();
        switch (type) {
            case LOGIX:
                for (Logix l : InstanceManager.getDefault(LogixManager.class).getNamedBeanSet()) {
                    array.add(message(LOGIX, logix(l), 0));
                }
                break;
            case LOGIXNG:
                for (LogixNG l : InstanceManager.getDefault(LogixNG_Manager.class).getNamedBeanSet()) {
                    array.add(message(LOGIXNG, logixNG(l), 0));
                }
                break;
            default:
                throw new JsonException(400, "Can't list " + type, request.id);
        }
        return message(array, request.id);
    }

    @Override
    public JsonNode doPost(String type, String name, JsonNode data, JsonRequest request) throws JsonException {
        switch (type) {
            case LOGIX: {
                Logix l = findLogix(name, request);
                if (data.has("enabled")) {
                    l.setEnabled(data.path("enabled").asBoolean());
                }
                return message(LOGIX, logix(l), request.id);
            }
            case LOGIXNG: {
                // name is either a LogixNG or one of its ConditionalNGs
                LogixNG l = InstanceManager.getDefault(LogixNG_Manager.class).getNamedBean(name);
                if (l != null) {
                    if (data.has("enabled")) {
                        l.setEnabled(data.path("enabled").asBoolean());
                    }
                    return message(LOGIXNG, logixNG(l), request.id);
                }
                ConditionalNG c = findConditionalNG(name, request);
                if (data.has("enabled")) {
                    c.setEnabled(data.path("enabled").asBoolean());
                }
                if (data.path("execute").asBoolean(false)) {
                    c.execute();
                }
                return message(LOGIXNG, logixNG(c.getLogixNG()), request.id);
            }
            case TRAIN_ACTION:
                return message(TRAIN_ACTION, trainAction(name, data, request), request.id);
            default:
                // programmer posts are asynchronous and handled by the socket service
                throw new JsonException(405, type + " can't be changed over HTTP", request.id);
        }
    }

    @Override
    public JsonNode doSchema(String type, boolean server, JsonRequest request) throws JsonException {
        throw new JsonException(501, "No schema for " + type, request.id);
    }

    // ---- programmer ----

    ObjectNode programmerStatus() {
        ObjectNode data = mapper.createObjectNode();
        GlobalProgrammerManager gpm = InstanceManager.getNullableDefault(GlobalProgrammerManager.class);
        Programmer p = gpm != null ? gpm.getGlobalProgrammer() : null;
        data.put("available", p != null);
        if (p != null) {
            ArrayNode modes = data.putArray("modes");
            for (ProgrammingMode m : p.getSupportedModes()) {
                modes.add(m.getStandardName());
            }
            data.put("mode", p.getMode() != null ? p.getMode().getStandardName() : null);
            data.put("canRead", p.getCanRead());
            data.put("canWrite", p.getCanWrite());
            data.put("connection", gpm.toString());
        }
        AddressedProgrammerManager apm = InstanceManager.getNullableDefault(AddressedProgrammerManager.class);
        data.put("opsAvailable", apm != null);
        return data;
    }

    // ---- Logix ----

    private Logix findLogix(String name, JsonRequest request) throws JsonException {
        Logix l = InstanceManager.getDefault(LogixManager.class).getNamedBean(name);
        if (l == null) {
            throw new JsonException(404, "No Logix " + name, request.id);
        }
        return l;
    }

    private ObjectNode logix(Logix l) {
        ObjectNode data = bean(l.getSystemName(), l.getUserName(), l.getComment());
        data.put("enabled", l.getEnabled());
        ArrayNode cs = data.putArray("conditionals");
        for (int i = 0; i < l.getNumConditionals(); i++) {
            Conditional c = l.getConditional(l.getConditionalByNumberOrder(i));
            if (c == null) {
                continue;
            }
            ObjectNode cn = bean(c.getSystemName(), c.getUserName(), c.getComment());
            int state = c.getState();
            cn.put("state", state == Conditional.TRUE ? "true" : state == Conditional.FALSE ? "false" : "unknown");
            cn.put("logicType", String.valueOf(c.getLogicType()));
            cn.put("antecedent", c.getAntecedentExpression());
            cn.put("triggerOnChange", c.getTriggerOnChange());
            ArrayNode vars = cn.putArray("variables");
            for (ConditionalVariable v : c.getCopyOfStateVariables()) {
                vars.add(describe(v::toString));
            }
            ArrayNode actions = cn.putArray("actions");
            for (ConditionalAction a : c.getCopyOfActions()) {
                actions.add(describe(() -> a.description(c.getTriggerOnChange())));
            }
            cs.add(cn);
        }
        return data;
    }

    // ---- LogixNG ----

    private LogixNG findLogixNG(String name, JsonRequest request) throws JsonException {
        LogixNG l = InstanceManager.getDefault(LogixNG_Manager.class).getNamedBean(name);
        if (l == null) {
            throw new JsonException(404, "No LogixNG " + name, request.id);
        }
        return l;
    }

    private ConditionalNG findConditionalNG(String name, JsonRequest request) throws JsonException {
        for (LogixNG l : InstanceManager.getDefault(LogixNG_Manager.class).getNamedBeanSet()) {
            for (int i = 0; i < l.getNumConditionalNGs(); i++) {
                ConditionalNG c = l.getConditionalNG(i);
                if (c != null && (name.equals(c.getSystemName()) || name.equals(c.getUserName()))) {
                    return c;
                }
            }
        }
        throw new JsonException(404, "No LogixNG or ConditionalNG " + name, request.id);
    }

    private ObjectNode logixNG(LogixNG l) {
        ObjectNode data = bean(l.getSystemName(), l.getUserName(), l.getComment());
        data.put("enabled", l.isEnabled());
        data.put("active", l.isActive());
        ArrayNode cs = data.putArray("conditionalNGs");
        for (int i = 0; i < l.getNumConditionalNGs(); i++) {
            ConditionalNG c = l.getConditionalNG(i);
            if (c == null) {
                continue;
            }
            ObjectNode cn = bean(c.getSystemName(), c.getUserName(), c.getComment());
            cn.put("enabled", c.isEnabled());
            StringWriter tree = new StringWriter();
            try (PrintWriter w = new PrintWriter(tree)) {
                c.printTree(Locale.getDefault(), w, "    ", new MutableInt(0));
            } catch (RuntimeException e) {
                tree.write("(could not describe: " + e.getMessage() + ")");
            }
            cn.put("tree", tree.toString());
            cs.add(cn);
        }
        return data;
    }

    /** JMRI's describers throw on half-configured items (e.g. a missing target); don't let one break the list. */
    private static String describe(java.util.function.Supplier<String> describer) {
        try {
            String s = describer.get();
            return s != null ? s : "(no description)";
        } catch (RuntimeException e) {
            return "(incomplete: " + e.getClass().getSimpleName() + ")";
        }
    }

    private ObjectNode bean(String name, String userName, String comment) {
        ObjectNode data = mapper.createObjectNode();
        data.put("name", name);
        data.put("userName", userName);
        data.put("comment", comment);
        return data;
    }
}
