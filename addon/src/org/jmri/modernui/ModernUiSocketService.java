package org.jmri.modernui;

import static org.jmri.modernui.ModernUiServiceFactory.LOGIX;
import static org.jmri.modernui.ModernUiServiceFactory.LOGIXNG;
import static org.jmri.modernui.ModernUiServiceFactory.PROGRAMMER;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.beans.PropertyChangeListener;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import jmri.AddressedProgrammerManager;
import jmri.GlobalProgrammerManager;
import jmri.InstanceManager;
import jmri.Logix;
import jmri.LogixManager;
import jmri.NamedBean;
import jmri.ProgListener;
import jmri.Programmer;
import jmri.ProgrammerException;
import jmri.ProgrammingMode;
import jmri.jmrit.logixng.LogixNG;
import jmri.jmrit.logixng.LogixNG_Manager;
import jmri.server.json.JsonConnection;
import jmri.server.json.JsonException;
import jmri.server.json.JsonRequest;
import jmri.server.json.JsonSocketService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Socket side of the add-on.
 * <p>
 * Programmer: {@code {"type":"programmer","method":"post","data":{"op":"read","cv":"29"},"id":7}}
 * replies asynchronously, when the decoder answers, with
 * {@code {"type":"programmer","data":{"op","cv","value","status","ok","message","mode"},"id":7}}.
 * Add {@code "address"} (and optionally {@code "isLongAddress"}) for operations-mode
 * (programming on the main), and {@code "mode"} to choose a programming mode.
 * <p>
 * Logix/LogixNG: get, list and post ({@code enabled}; for a ConditionalNG also
 * {@code execute}). Listing subscribes to enable/disable changes.
 */
public class ModernUiSocketService extends JsonSocketService<ModernUiHttpService> {

    private static final Logger log = LoggerFactory.getLogger(ModernUiSocketService.class);
    private final Map<NamedBean, PropertyChangeListener> watched = new HashMap<>();
    private volatile boolean busy = false;

    public ModernUiSocketService(JsonConnection connection, ModernUiHttpService service) {
        super(connection, service);
    }

    @Override
    public void onMessage(String type, JsonNode data, JsonRequest request) throws IOException, JsonException {
        String name = data.path("name").asText("");
        if (PROGRAMMER.equals(type)) {
            if ("post".equals(request.method) || data.has("op")) {
                program(data, request);
            } else {
                connection.sendMessage(service.doGet(type, name, data, request), request.id);
            }
            return;
        }
        if ((LOGIX.equals(type) || LOGIXNG.equals(type)) && name.isEmpty()) {
            onList(type, data, request);
            return;
        }
        JsonNode reply = "post".equals(request.method)
                ? service.doPost(type, name, data, request)
                : service.doGet(type, name, data, request);
        connection.sendMessage(reply, request.id);
    }

    @Override
    public void onList(String type, JsonNode data, JsonRequest request) throws IOException, JsonException {
        connection.sendMessage(service.doGetList(type, data, request), request.id);
        if (LOGIX.equals(type)) {
            for (Logix l : InstanceManager.getDefault(LogixManager.class).getNamedBeanSet()) {
                watch(LOGIX, l, request);
            }
        } else if (LOGIXNG.equals(type)) {
            for (LogixNG l : InstanceManager.getDefault(LogixNG_Manager.class).getNamedBeanSet()) {
                watch(LOGIXNG, l, request);
            }
        }
    }

    private void watch(String type, NamedBean bean, JsonRequest request) {
        if (watched.containsKey(bean)) {
            return;
        }
        PropertyChangeListener l = evt -> {
            try {
                JsonRequest push = new JsonRequest(request.locale, request.version, "get", 0);
                connection.sendMessage(service.doGet(type, bean.getSystemName(), connection.getObjectMapper().createObjectNode(), push), 0);
            } catch (IOException | JsonException e) {
                log.debug("Unable to push {} {}", type, bean.getSystemName(), e);
            }
        };
        bean.addPropertyChangeListener(l);
        watched.put(bean, l);
    }

    private void program(JsonNode data, JsonRequest request) throws JsonException {
        String op = data.path("op").asText("read");
        String cv = data.path("cv").asText("");
        if (cv.isEmpty() || !("read".equals(op) || "write".equals(op))) {
            throw new JsonException(400, "Need op read|write and cv", request.id);
        }
        int value = data.path("value").asInt(-1);
        if ("write".equals(op) && (value < 0 || value > 255)) {
            throw new JsonException(400, "Write needs value 0-255", request.id);
        }

        Programmer p;
        if (data.has("address")) {
            int address = data.path("address").asInt();
            AddressedProgrammerManager apm = InstanceManager.getNullableDefault(AddressedProgrammerManager.class);
            if (apm == null) {
                throw new JsonException(503, "No programming-on-main available", request.id);
            }
            p = apm.getAddressedProgrammer(data.path("isLongAddress").asBoolean(address > 127), address);
        } else {
            GlobalProgrammerManager gpm = InstanceManager.getNullableDefault(GlobalProgrammerManager.class);
            p = gpm != null ? gpm.getGlobalProgrammer() : null;
        }
        if (p == null) {
            throw new JsonException(503, "No programmer available", request.id);
        }
        if (data.hasNonNull("mode")) {
            String wanted = data.path("mode").asText();
            ProgrammingMode mode = p.getSupportedModes().stream()
                    .filter(m -> m.getStandardName().equals(wanted)).findFirst()
                    .orElseThrow(() -> new JsonException(400, "Mode " + wanted + " not supported", request.id));
            p.setMode(mode);
        }
        if (busy) {
            throw new JsonException(409, "Programmer busy", request.id);
        }
        busy = true;
        Programmer prog = p;
        ProgListener listener = (int v, int status) -> {
            busy = false;
            ObjectNode r = connection.getObjectMapper().createObjectNode();
            r.put("op", op);
            r.put("cv", cv);
            r.put("value", "write".equals(op) ? value : v);
            r.put("status", status);
            r.put("ok", status == ProgListener.OK);
            r.put("message", status == ProgListener.OK ? "OK" : prog.decodeErrorCode(status));
            r.put("mode", prog.getMode() != null ? prog.getMode().getStandardName() : null);
            try {
                connection.sendMessage(service.message(PROGRAMMER, r, request.id), request.id);
            } catch (IOException e) {
                log.debug("Client went away before programming reply", e);
            }
        };
        try {
            if ("read".equals(op)) {
                p.readCV(cv, listener);
            } else {
                p.writeCV(cv, value, listener);
            }
        } catch (ProgrammerException | IllegalArgumentException e) {
            busy = false;
            throw new JsonException(500, "Programming failed: " + e.getMessage(), request.id);
        }
    }

    @Override
    public void onClose() {
        watched.forEach(NamedBean::removePropertyChangeListener);
        watched.clear();
    }
}
