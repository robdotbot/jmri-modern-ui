package org.jmri.modernui;

import static org.jmri.modernui.ModernUiServiceFactory.ADDON;
import static org.jmri.modernui.ModernUiServiceFactory.DECODER_DEFINITION;
import static org.jmri.modernui.ModernUiServiceFactory.LOGIX;
import static org.jmri.modernui.ModernUiServiceFactory.LOGIXNG;
import static org.jmri.modernui.ModernUiServiceFactory.PANEL_EDIT;
import static org.jmri.modernui.ModernUiServiceFactory.PROGRAMMER;
import static org.jmri.modernui.ModernUiServiceFactory.ROSTER_CVS;
import static org.jmri.modernui.ModernUiServiceFactory.SIGNAL_ASPECTS;
import static org.jmri.modernui.ModernUiServiceFactory.STORE_CONFIG;
import static org.jmri.modernui.ModernUiServiceFactory.TRAIN_ACTION;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jmri.AddressedProgrammerManager;
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

/** Synchronous parts of the add-on: Logix/LogixNG, signal aspects, train actions and programmer status. */
public class ModernUiHttpService extends JsonHttpService {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ModernUiHttpService.class);

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
                return message(LOGIX, Logic.logix(mapper, Logic.findLogix(name, request.id)), request.id);
            case LOGIXNG:
                return message(LOGIXNG, Logic.logixNG(mapper, Logic.findLogixNG(name, request.id)), request.id);
            case STORE_CONFIG:
                return message(STORE_CONFIG, StoreConfig.get(mapper), request.id);
            case SIGNAL_ASPECTS:
                return message(SIGNAL_ASPECTS, signalAspects(name, data.path("imageset").asText("default"), request), request.id);
            case DECODER_DEFINITION:
                return message(DECODER_DEFINITION, DecoderSupport.definition(mapper, data, request.id), request.id);
            case ROSTER_CVS:
                return message(ROSTER_CVS, DecoderSupport.rosterCvs(mapper, name, request.id), request.id);
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
        TrainManager trainManager = InstanceManager.getDefault(TrainManager.class);
        Train train = trainManager.getTrainById(name);
        if (train == null) {
            throw new JsonException(404, "No train with id " + name, request.id);
        }
        String action = data.path("action").asText("");
        if (!java.util.Arrays.asList("build", "reset", "move", "terminate").contains(action)) {
            throw new JsonException(400, "action must be build, reset, move or terminate", request.id);
        }
        if ("move".equals(action) && !train.isBuilt()) {
            throw new JsonException(428, "Train " + train.getName() + " is not built", request.id);
        }
        boolean ok = true;
        // JMRI reports build warnings and failures in modal dialogs. From a web request those would block
        // until someone clicks OK at the JMRI computer (or fail outright when JMRI has no screen), so turn
        // them off while we act and restore the user's setting afterwards.
        synchronized (trainManager) {
            boolean messages = trainManager.isBuildMessagesEnabled();
            trainManager.setBuildMessagesEnabled(false);
            try {
                switch (action) {
                    case "build":
                        ok = train.build();
                        break;
                    case "reset":
                        ok = train.reset();
                        break;
                    case "move":
                        train.move();
                        break;
                    default:
                        train.terminate();
                        break;
                }
            } catch (java.awt.HeadlessException e) {
                // Some other prompt; the train's own state below still tells the client what happened.
                log.debug("Train {} {} wanted to show a dialog", train.getName(), action, e);
                ok = !"build".equals(action) || train.isBuilt();
            } finally {
                trainManager.setBuildMessagesEnabled(messages);
            }
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
                    array.add(message(LOGIX, Logic.logix(mapper, l), 0));
                }
                break;
            case LOGIXNG:
                for (LogixNG l : InstanceManager.getDefault(LogixNG_Manager.class).getNamedBeanSet()) {
                    array.add(message(LOGIXNG, Logic.logixNG(mapper, l), 0));
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
            case LOGIX:
                return message(LOGIX, Logic.editLogix(mapper, name, data, request.id), request.id);
            case LOGIXNG: {
                // Without an op, name may also be a ConditionalNG to enable, disable or run.
                if (data.path("op").asText("").isEmpty() && InstanceManager.getDefault(LogixNG_Manager.class).getNamedBean(name) == null) {
                    ConditionalNG c = Logic.findConditionalNG(name, request.id);
                    if (data.has("enabled")) {
                        c.setEnabled(data.path("enabled").asBoolean());
                    }
                    if (data.path("execute").asBoolean(false)) {
                        c.execute();
                    }
                    return message(LOGIXNG, Logic.logixNG(mapper, c.getLogixNG()), request.id);
                }
                return message(LOGIXNG, Logic.editLogixNG(mapper, name, data, request.id), request.id);
            }
            case STORE_CONFIG:
                return message(STORE_CONFIG, StoreConfig.store(mapper, data, request.id), request.id);
            case PANEL_EDIT:
                return message(PANEL_EDIT, PanelEditing.edit(mapper, name, data, request.id), request.id);
            case TRAIN_ACTION:
                return message(TRAIN_ACTION, trainAction(name, data, request), request.id);
            case ROSTER_CVS:
                return message(ROSTER_CVS, DecoderSupport.saveRosterCvs(mapper, name, data, request.id), request.id);
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

}
