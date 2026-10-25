package org.jmri.modernui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import jmri.Conditional;
import jmri.ConditionalAction;
import jmri.ConditionalManager;
import jmri.ConditionalVariable;
import jmri.InstanceManager;
import jmri.Logix;
import jmri.LogixManager;
import jmri.Manager;
import jmri.NamedBean;
import jmri.implementation.DefaultConditionalAction;
import jmri.jmrit.logixng.Base;
import jmri.jmrit.logixng.ConditionalNG;
import jmri.jmrit.logixng.ConditionalNG_Manager;
import jmri.jmrit.logixng.DigitalActionBean;
import jmri.jmrit.logixng.DigitalActionManager;
import jmri.jmrit.logixng.DigitalExpressionBean;
import jmri.jmrit.logixng.DigitalExpressionManager;
import jmri.jmrit.logixng.FemaleDigitalActionSocket;
import jmri.jmrit.logixng.FemaleDigitalExpressionSocket;
import jmri.jmrit.logixng.FemaleSocket;
import jmri.jmrit.logixng.LogixNG;
import jmri.jmrit.logixng.LogixNG_Manager;
import jmri.jmrit.logixng.MaleSocket;
import jmri.jmrit.logixng.NamedBeanAddressing;
import jmri.jmrit.logixng.SocketAlreadyConnectedException;
import jmri.jmrit.logixng.util.LogixNG_SelectEnum;
import jmri.jmrit.logixng.util.LogixNG_SelectNamedBean;
import jmri.server.json.JsonException;
import jmri.util.ThreadingUtil;
import org.apache.commons.lang3.mutable.MutableInt;

/**
 * Logix and LogixNG for the web app: what they contain, in a form a client can edit, and the edits themselves.
 * <p>
 * Edits follow what JMRI's own editors do: a Logix is deactivated while its conditionals change and activated
 * again after; a LogixNG tree has its listeners unregistered while it changes. They run on JMRI's GUI thread,
 * like those editors. Nothing is written to disk; see {@link StoreConfig}.
 */
final class Logic {

    /** LogixNG items a client can add to an empty socket, by the kind of socket they fit. */
    static final List<String> ACTIONS = Arrays.asList("IfThenElse", "DigitalMany", "ActionTurnout", "ActionSensor",
            "ActionLight", "ActionMemory", "ActionSignalMast", "ExecuteDelayed");
    static final List<String> EXPRESSIONS = Arrays.asList("And", "Or", "Not", "True", "False", "ExpressionSensor",
            "ExpressionTurnout", "ExpressionLight", "ExpressionSignalMast");
    /** String and int properties worth editing; other plain properties are formulas, references and such. */
    private static final List<String> STRINGS = Arrays.asList("Aspect", "OtherConstantValue");
    private static final List<String> INTS = Arrays.asList("Delay");

    private Logic() {
    }

    @FunctionalInterface
    interface Edit<T> {
        T run() throws JsonException;
    }

    /** Run an edit on the GUI thread, as JMRI's editors do, passing errors back. */
    static <T> T onGui(Edit<T> edit, int id) throws JsonException {
        Object[] out = new Object[1];
        Exception[] err = new Exception[1];
        ThreadingUtil.runOnGUI(() -> {
            try {
                out[0] = edit.run();
            } catch (JsonException | RuntimeException e) {
                err[0] = e;
            }
        });
        if (err[0] instanceof JsonException) {
            throw (JsonException) err[0];
        }
        if (err[0] != null) {
            throw new JsonException(500, err[0].toString(), id);
        }
        @SuppressWarnings("unchecked")
        T t = (T) out[0];
        return t;
    }

    private static ObjectNode bean(ObjectMapper mapper, NamedBean b) {
        ObjectNode data = mapper.createObjectNode();
        data.put("name", b.getSystemName());
        data.put("userName", b.getUserName());
        data.put("comment", b.getComment());
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

    // ================= Logix =================

    static Logix findLogix(String name, int id) throws JsonException {
        Logix l = InstanceManager.getDefault(LogixManager.class).getNamedBean(name);
        if (l == null) {
            throw new JsonException(404, "No Logix " + name, id);
        }
        return l;
    }

    static ObjectNode logix(ObjectMapper mapper, Logix l) {
        ObjectNode data = bean(mapper, l);
        data.put("enabled", l.getEnabled());
        ArrayNode cs = data.putArray("conditionals");
        for (int i = 0; i < l.getNumConditionals(); i++) {
            Conditional c = l.getConditional(l.getConditionalByNumberOrder(i));
            if (c == null) {
                continue;
            }
            ObjectNode cn = bean(mapper, c);
            int state = c.getState();
            cn.put("state", state == Conditional.TRUE ? "true" : state == Conditional.FALSE ? "false" : "unknown");
            cn.put("logicType", c.getLogicType().name());
            cn.put("antecedent", c.getAntecedentExpression());
            cn.put("triggerOnChange", c.getTriggerOnChange());
            ArrayNode vars = cn.putArray("variables");
            for (ConditionalVariable v : c.getCopyOfStateVariables()) {
                ObjectNode vn = vars.addObject();
                vn.put("description", describe(v::toString));
                vn.put("not", v.isNegated());
                vn.put("operator", v.getOpern().name());
                vn.put("type", v.getType().name());
                vn.put("itemType", v.getType().getItemType().name());
                vn.put("name", v.getName());
                vn.put("dataString", v.getDataString());
                vn.put("num1", v.getNum1());
                vn.put("num2", v.getNum2());
                vn.put("trigger", v.doTriggerActions());
            }
            ArrayNode actions = cn.putArray("actions");
            for (ConditionalAction a : c.getCopyOfActions()) {
                ObjectNode an = actions.addObject();
                an.put("description", describe(() -> a.description(c.getTriggerOnChange())));
                an.put("option", a.getOption());
                an.put("type", a.getType().name());
                an.put("itemType", a.getType().getItemType().name());
                an.put("deviceName", a.getDeviceName());
                an.put("actionData", a.getActionData());
                an.put("actionString", a.getActionString());
            }
            cs.add(cn);
        }
        return data;
    }

    /** The bean an item type refers to, or null for types without one (clock, scripts...). */
    private static Manager<? extends NamedBean> manager(Conditional.ItemType t) {
        switch (t) {
            case SENSOR:
                return InstanceManager.sensorManagerInstance();
            case TURNOUT:
                return InstanceManager.turnoutManagerInstance();
            case LIGHT:
                return InstanceManager.lightManagerInstance();
            case MEMORY:
                return InstanceManager.memoryManagerInstance();
            case SIGNALHEAD:
                return InstanceManager.getDefault(jmri.SignalHeadManager.class);
            case SIGNALMAST:
                return InstanceManager.getDefault(jmri.SignalMastManager.class);
            case CONDITIONAL:
                return InstanceManager.getDefault(ConditionalManager.class);
            case LOGIX:
                return InstanceManager.getDefault(LogixManager.class);
            default:
                return null;
        }
    }

    private static void checkBean(Conditional.ItemType t, String name, int id) throws JsonException {
        Manager<? extends NamedBean> m = manager(t);
        if (m != null && m.getNamedBean(name == null ? "" : name) == null) {
            throw new JsonException(400, "No " + t.toString().toLowerCase(Locale.ROOT) + " named \"" + name + "\"", id);
        }
    }

    private static <E extends Enum<E>> E enumValue(Class<E> type, String value, int id) throws JsonException {
        try {
            return Enum.valueOf(type, value);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new JsonException(400, "Unknown " + type.getSimpleName() + " " + value, id);
        }
    }

    /**
     * Edits: {op:"create", userName}, {op:"delete"}, {op:"rename", userName, comment}, {op:"addConditional",
     * userName}, {op:"deleteConditional", conditional}, {op:"updateConditional", conditional, userName, logicType,
     * antecedent, triggerOnChange, variables, actions}, or just {enabled}.
     */
    static ObjectNode editLogix(ObjectMapper mapper, String name, JsonNode data, int id) throws JsonException {
        String op = data.path("op").asText("");
        LogixManager lm = InstanceManager.getDefault(LogixManager.class);
        if ("create".equals(op)) {
            String userName = data.path("userName").asText("").trim();
            if (userName.isEmpty() || lm.getByUserName(userName) != null) {
                throw new JsonException(400, userName.isEmpty() ? "A new Logix needs a name" : "A Logix is already called " + userName, id);
            }
            return onGui(() -> {
                Logix l = lm.createNewLogix(userName);
                if (l == null) {
                    throw new JsonException(500, "JMRI couldn't create the Logix", id);
                }
                l.setEnabled(true);
                l.activateLogix();
                return logix(mapper, l);
            }, id);
        }
        Logix l = findLogix(name, id);
        return onGui(() -> {
            switch (op) {
                case "delete":
                    l.setEnabled(false);
                    l.deActivateLogix();
                    lm.deleteLogix(l);
                    ObjectNode gone = bean(mapper, l);
                    gone.put("deleted", true);
                    return gone;
                case "rename":
                    if (data.has("userName")) {
                        String u = data.path("userName").asText("").trim();
                        Logix other = u.isEmpty() ? null : lm.getByUserName(u);
                        if (other != null && other != l) {
                            throw new JsonException(400, "A Logix is already called " + u, id);
                        }
                        l.setUserName(u.isEmpty() ? null : u);
                    }
                    if (data.has("comment")) {
                        l.setComment(data.path("comment").asText(""));
                    }
                    break;
                case "addConditional":
                    addConditional(l, data.path("userName").asText("").trim(), id);
                    break;
                case "deleteConditional": {
                    Conditional c = conditional(l, data.path("conditional").asText(""), id);
                    l.deActivateLogix();
                    String[] refused = l.deleteConditional(c.getSystemName());
                    l.activateLogix();
                    if (refused != null) {
                        throw new JsonException(409, "JMRI won't delete it: " + String.join(" ", refused), id);
                    }
                    break;
                }
                case "updateConditional":
                    updateConditional(l, conditional(l, data.path("conditional").asText(""), id), data, id);
                    break;
                case "":
                    break;
                default:
                    throw new JsonException(400, "Unknown Logix edit " + op, id);
            }
            if (data.has("enabled")) {
                l.setEnabled(data.path("enabled").asBoolean());
            }
            return logix(mapper, l);
        }, id);
    }

    private static Conditional conditional(Logix l, String name, int id) throws JsonException {
        Conditional c = l.getConditional(name);
        if (c == null) {
            c = InstanceManager.getDefault(ConditionalManager.class).getByUserName(l, name);
        }
        if (c == null) {
            throw new JsonException(404, "No conditional " + name + " in " + l.getDisplayName(), id);
        }
        return c;
    }

    /** As ConditionalList.makeNewConditional: the next free <logix>C<n> system name. */
    private static void addConditional(Logix l, String userName, int id) throws JsonException {
        ConditionalManager cm = InstanceManager.getDefault(ConditionalManager.class);
        if (!userName.isEmpty() && cm.getByUserName(l, userName) != null) {
            throw new JsonException(400, "A conditional in this Logix is already called " + userName, id);
        }
        Conditional c = null;
        for (int n = l.getNumConditionals() + 1; c == null && n < 1000; n++) {
            c = cm.createNewConditional(l.getSystemName() + "C" + n, userName.isEmpty() ? null : userName);
        }
        if (c == null) {
            throw new JsonException(500, "JMRI couldn't create the conditional", id);
        }
        l.deActivateLogix();
        l.addConditional(c.getSystemName(), -1);
        l.activateLogix();
    }

    private static void updateConditional(Logix l, Conditional c, JsonNode data, int id) throws JsonException {
        Conditional.AntecedentOperator logic = enumValue(Conditional.AntecedentOperator.class, data.path("logicType").asText("ALL_AND"), id);
        List<ConditionalVariable> vars = new ArrayList<>();
        StringBuilder made = new StringBuilder();
        int i = 0;
        for (JsonNode v : data.path("variables")) {
            Conditional.Type type = enumValue(Conditional.Type.class, v.path("type").asText(""), id);
            String vname = v.path("name").asText("");
            checkBean(type.getItemType(), vname, id);
            Conditional.Operator opern = i == 0 ? Conditional.Operator.NONE
                    : logic == Conditional.AntecedentOperator.ALL_AND ? Conditional.Operator.AND
                    : logic == Conditional.AntecedentOperator.ALL_OR ? Conditional.Operator.OR
                    : enumValue(Conditional.Operator.class, v.path("operator").asText("AND"), id);
            boolean not = v.path("not").asBoolean(false);
            ConditionalVariable cv = new ConditionalVariable(not, opern, type, vname, v.path("trigger").asBoolean(true));
            if (v.hasNonNull("dataString")) {
                cv.setDataString(v.path("dataString").asText());
            }
            cv.setNum1(v.path("num1").asInt(0));
            cv.setNum2(v.path("num2").asInt(0));
            vars.add(cv);
            // The antecedent JMRI's editor writes for "all AND"/"all OR" (ConditionalEditBase.makeAntecedent).
            if (i > 0) {
                made.append(logic == Conditional.AntecedentOperator.ALL_OR ? " or " : " and ");
            }
            made.append(not ? "not " : "").append("R").append(i + 1);
            i++;
        }
        String antecedent = logic == Conditional.AntecedentOperator.MIXED ? data.path("antecedent").asText("") : made.toString();
        if (logic == Conditional.AntecedentOperator.MIXED) {
            String problem = c.validateAntecedent(antecedent, vars);
            if (problem != null) {
                throw new JsonException(400, problem.replaceAll("<[^>]*>", " ").trim(), id);
            }
        }
        List<ConditionalAction> actions = new ArrayList<>();
        for (JsonNode a : data.path("actions")) {
            Conditional.Action type = enumValue(Conditional.Action.class, a.path("type").asText(""), id);
            String device = a.path("deviceName").asText("");
            checkBean(type.getItemType(), device, id);
            actions.add(new DefaultConditionalAction(a.path("option").asInt(Conditional.ACTION_OPTION_ON_CHANGE_TO_TRUE), type,
                    device, a.path("actionData").asInt(0), a.path("actionString").asText("")));
        }
        l.deActivateLogix();
        try {
            if (data.has("userName")) {
                String u = data.path("userName").asText("").trim();
                Conditional other = u.isEmpty() ? null : InstanceManager.getDefault(ConditionalManager.class).getByUserName(l, u);
                if (other != null && other != c) {
                    throw new JsonException(400, "A conditional in this Logix is already called " + u, id);
                }
                c.setUserName(u.isEmpty() ? null : u);
            }
            c.setStateVariables(vars);
            c.setAction(actions);
            c.setTriggerOnChange(data.path("triggerOnChange").asBoolean(true));
            c.setLogicType(logic, antecedent);
        } finally {
            l.activateLogix();
        }
    }

    // ================= LogixNG =================

    static LogixNG findLogixNG(String name, int id) throws JsonException {
        LogixNG l = InstanceManager.getDefault(LogixNG_Manager.class).getNamedBean(name);
        if (l == null) {
            throw new JsonException(404, "No LogixNG " + name, id);
        }
        return l;
    }

    static ConditionalNG findConditionalNG(String name, int id) throws JsonException {
        for (LogixNG l : InstanceManager.getDefault(LogixNG_Manager.class).getNamedBeanSet()) {
            for (int i = 0; i < l.getNumConditionalNGs(); i++) {
                ConditionalNG c = l.getConditionalNG(i);
                if (c != null && (name.equals(c.getSystemName()) || name.equals(c.getUserName()))) {
                    return c;
                }
            }
        }
        throw new JsonException(404, "No LogixNG or ConditionalNG " + name, id);
    }

    static ObjectNode logixNG(ObjectMapper mapper, LogixNG l) {
        ObjectNode data = bean(mapper, l);
        data.put("enabled", l.isEnabled());
        data.put("active", l.isActive());
        ArrayNode cs = data.putArray("conditionalNGs");
        for (int i = 0; i < l.getNumConditionalNGs(); i++) {
            ConditionalNG c = l.getConditionalNG(i);
            if (c == null) {
                continue;
            }
            ObjectNode cn = bean(mapper, c);
            cn.put("enabled", c.isEnabled());
            StringWriter tree = new StringWriter();
            try (PrintWriter w = new PrintWriter(tree)) {
                c.printTree(Locale.getDefault(), w, "    ", new MutableInt(0));
            } catch (RuntimeException e) {
                tree.write("(could not describe: " + e.getMessage() + ")");
            }
            cn.put("tree", tree.toString());
            cn.set("root", socket(mapper, c.getFemaleSocket()));
            cs.add(cn);
        }
        return data;
    }

    private static String kind(FemaleSocket s) {
        return s instanceof FemaleDigitalActionSocket ? "action" : s instanceof FemaleDigitalExpressionSocket ? "expression" : "other";
    }

    private static ObjectNode socket(ObjectMapper mapper, FemaleSocket s) {
        ObjectNode n = mapper.createObjectNode();
        n.put("name", s.getName());
        n.put("kind", kind(s));
        n.set("child", s.isConnected() ? node(mapper, s.getConnectedSocket()) : null);
        return n;
    }

    /** The item a male socket wraps, past any debugger/stack sockets. */
    private static Base item(MaleSocket m) {
        Base b = m.getObject();
        while (b instanceof MaleSocket) {
            b = ((MaleSocket) b).getObject();
        }
        return b;
    }

    private static ObjectNode node(ObjectMapper mapper, MaleSocket m) {
        ObjectNode n = mapper.createObjectNode();
        Base b = item(m);
        n.put("system", m.getSystemName());
        n.put("userName", m.getUserName());
        n.put("type", b.getClass().getSimpleName());
        n.put("short", describe(() -> m.getShortDescription(Locale.getDefault())));
        n.put("long", describe(() -> m.getLongDescription(Locale.getDefault())));
        n.put("enabled", m.isEnabled());
        n.set("fields", fields(mapper, b));
        ArrayNode sockets = n.putArray("sockets");
        for (int i = 0; i < m.getChildCount(); i++) {
            sockets.add(socket(mapper, m.getChild(i)));
        }
        return n;
    }

    // ---- editable fields, found by reflection so they work for many item types ----

    private static Method method(Object o, String name, Class<?>... args) {
        try {
            return o.getClass().getMethod(name, args);
        } catch (NoSuchMethodException e) {
            return null;
        }
    }

    private static Object call(Object o, Method m, Object... args) {
        try {
            return m.invoke(o, args);
        } catch (IllegalAccessException | InvocationTargetException e) {
            return null;
        }
    }

    /** False when the property is set indirectly (by reference, variable or formula), which we leave alone. */
    private static boolean direct(Object o, String property) {
        Method m = method(o, "get" + property + "Addressing");
        return m == null || call(o, m) == NamedBeanAddressing.Direct;
    }

    private static ArrayNode fields(ObjectMapper mapper, Base b) {
        ArrayNode out = mapper.createArrayNode();
        Method selBean = method(b, "getSelectNamedBean");
        if (selBean != null && call(b, selBean) instanceof LogixNG_SelectNamedBean) {
            LogixNG_SelectNamedBean<?> sel = (LogixNG_SelectNamedBean<?>) call(b, selBean);
            if (sel.getAddressing() == NamedBeanAddressing.Direct) {
                ObjectNode f = out.addObject();
                f.put("key", "bean");
                f.put("kind", "bean");
                f.put("beanType", sel.getManager().getBeanTypeHandled(false));
                f.put("value", sel.getNamedBean() != null ? sel.getNamedBean().getName() : null);
            }
        }
        Method selEnum = method(b, "getSelectEnum");
        if (selEnum != null && call(b, selEnum) instanceof LogixNG_SelectEnum) {
            LogixNG_SelectEnum<?> sel = (LogixNG_SelectEnum<?>) call(b, selEnum);
            Enum<?> e = sel.getEnum();
            if (sel.getAddressing() == NamedBeanAddressing.Direct && e != null) {
                enumField(out, "state", e);
            }
        }
        for (Method g : b.getClass().getMethods()) {
            String n = g.getName();
            if (!n.startsWith("get") || g.getParameterCount() != 0 || n.endsWith("Addressing")) {
                continue;
            }
            String prop = n.substring(3);
            Class<?> t = g.getReturnType();
            if (t.isEnum() && method(b, "set" + prop, t) != null && direct(b, prop)) {
                Object v = call(b, g);
                if (v != null) {
                    enumField(out, prop, (Enum<?>) v);
                }
            } else if (t == String.class && STRINGS.contains(prop) && method(b, "set" + prop, String.class) != null && direct(b, prop)) {
                ObjectNode f = out.addObject();
                f.put("key", prop);
                f.put("kind", "string");
                f.put("value", (String) call(b, g));
            } else if (t == int.class && INTS.contains(prop) && method(b, "set" + prop, int.class) != null && direct(b, prop)) {
                ObjectNode f = out.addObject();
                f.put("key", prop);
                f.put("kind", "int");
                f.put("value", (Integer) call(b, g));
            }
        }
        return out;
    }

    private static void enumField(ArrayNode out, String key, Enum<?> v) {
        ObjectNode f = out.addObject();
        f.put("key", key);
        f.put("kind", "enum");
        f.put("value", v.name());
        ArrayNode options = f.putArray("options");
        for (Object c : v.getDeclaringClass().getEnumConstants()) {
            ObjectNode o = options.addObject();
            o.put("value", ((Enum<?>) c).name());
            o.put("label", c.toString());
        }
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static void apply(Base b, JsonNode config, int id) throws JsonException {
        java.util.Iterator<java.util.Map.Entry<String, JsonNode>> it = config.fields();
        while (it.hasNext()) {
            java.util.Map.Entry<String, JsonNode> e = it.next();
            String key = e.getKey();
            String value = e.getValue().asText("");
            try {
                if ("bean".equals(key)) {
                    LogixNG_SelectNamedBean sel = (LogixNG_SelectNamedBean) b.getClass().getMethod("getSelectNamedBean").invoke(b);
                    if (sel.getManager().getNamedBean(value) == null) {
                        throw new JsonException(400, "No " + sel.getManager().getBeanTypeHandled(false) + " named \"" + value + "\"", id);
                    }
                    sel.setNamedBean(value);
                } else if ("state".equals(key)) {
                    LogixNG_SelectEnum sel = (LogixNG_SelectEnum) b.getClass().getMethod("getSelectEnum").invoke(b);
                    sel.setEnum(Enum.valueOf(sel.getEnum().getDeclaringClass(), value));
                } else {
                    Method g = b.getClass().getMethod("get" + key);
                    Class<?> t = g.getReturnType();
                    if (!direct(b, key) || !(t.isEnum() || (t == String.class && STRINGS.contains(key)) || (t == int.class && INTS.contains(key)))) {
                        throw new JsonException(400, key + " can't be edited here", id);
                    }
                    Object v = t.isEnum() ? Enum.valueOf((Class<Enum>) t, value) : t == int.class ? (Object) Integer.parseInt(value) : value;
                    b.getClass().getMethod("set" + key, t).invoke(b, v);
                }
            } catch (NoSuchMethodException | IllegalAccessException | IllegalArgumentException ex) {
                throw new JsonException(400, "Can't set " + key + " to " + value + ": " + ex.getMessage(), id);
            } catch (InvocationTargetException ex) {
                throw new JsonException(400, "Can't set " + key + " to " + value + ": " + ex.getCause().getMessage(), id);
            }
        }
    }

    /** The socket at a path of child indexes below the ConditionalNG's root socket. */
    private static FemaleSocket at(ConditionalNG c, JsonNode path, int id) throws JsonException {
        FemaleSocket s = c.getFemaleSocket();
        for (JsonNode p : path) {
            if (!s.isConnected() || p.asInt() < 0 || p.asInt() >= s.getConnectedSocket().getChildCount()) {
                throw new JsonException(404, "No socket at " + path, id);
            }
            s = s.getConnectedSocket().getChild(p.asInt());
        }
        return s;
    }

    private static void deleteTree(MaleSocket m) {
        for (int i = 0; i < m.getChildCount(); i++) {
            FemaleSocket s = m.getChild(i);
            if (s.isConnected()) {
                MaleSocket child = s.getConnectedSocket();
                s.disconnect();
                deleteTree(child);
            }
        }
        try {
            m.getManager().deleteBean(m, "DoDelete");
        } catch (java.beans.PropertyVetoException e) {
            log.warn("JMRI refused to delete {}", m.getSystemName(), e);
        }
    }

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(Logic.class);

    private static MaleSocket create(String type, String kind, int id) throws JsonException {
        boolean action = "action".equals(kind);
        if (!(action ? ACTIONS : EXPRESSIONS).contains(type)) {
            throw new JsonException(400, type + " can't be added to an " + kind + " socket here", id);
        }
        try {
            if (action) {
                DigitalActionManager m = InstanceManager.getDefault(DigitalActionManager.class);
                Class<?> c = Class.forName("jmri.jmrit.logixng.actions." + type);
                return m.registerAction((DigitalActionBean) c.getConstructor(String.class, String.class).newInstance(m.getAutoSystemName(), null));
            }
            DigitalExpressionManager m = InstanceManager.getDefault(DigitalExpressionManager.class);
            Class<?> c = Class.forName("jmri.jmrit.logixng.expressions." + type);
            return m.registerExpression((DigitalExpressionBean) c.getConstructor(String.class, String.class).newInstance(m.getAutoSystemName(), null));
        } catch (ReflectiveOperationException e) {
            throw new JsonException(500, "Can't create " + type + ": " + e, id);
        }
    }

    /**
     * Edits: {op:"create", userName}, {op:"delete"}, {op:"rename", userName, comment},
     * {op:"addConditionalNG", userName}, {op:"deleteConditionalNG", conditionalNG},
     * {op:"add", conditionalNG, path, type, config}, {op:"edit", conditionalNG, path, config},
     * {op:"remove", conditionalNG, path}, {op:"setEnabled", conditionalNG, path, enabled}.
     * A path is the child indexes from the ConditionalNG's root socket to the socket concerned.
     */
    static ObjectNode editLogixNG(ObjectMapper mapper, String name, JsonNode data, int id) throws JsonException {
        String op = data.path("op").asText("");
        LogixNG_Manager lm = InstanceManager.getDefault(LogixNG_Manager.class);
        if ("create".equals(op)) {
            String userName = data.path("userName").asText("").trim();
            if (userName.isEmpty() || lm.getByUserName(userName) != null) {
                throw new JsonException(400, userName.isEmpty() ? "A new LogixNG needs a name" : "A LogixNG is already called " + userName, id);
            }
            return onGui(() -> {
                // As LogixNGTableAction.createBean.
                LogixNG l = lm.createLogixNG(userName);
                l.activate();
                l.setEnabled(true);
                return logixNG(mapper, l);
            }, id);
        }
        LogixNG l = findLogixNG(name, id);
        return onGui(() -> {
            switch (op) {
                case "delete":
                    l.setEnabled(false);
                    try {
                        lm.deleteBean(l, "DoDelete");
                    } catch (java.beans.PropertyVetoException e) {
                        throw new JsonException(409, "JMRI won't delete it: " + e.getMessage(), id);
                    }
                    ObjectNode gone = bean(mapper, l);
                    gone.put("deleted", true);
                    return gone;
                case "rename":
                    if (data.has("userName")) {
                        String u = data.path("userName").asText("").trim();
                        l.setUserName(u.isEmpty() ? null : u);
                    }
                    if (data.has("comment")) {
                        l.setComment(data.path("comment").asText(""));
                    }
                    break;
                case "addConditionalNG": {
                    String u = data.path("userName").asText("").trim();
                    ConditionalNG c = InstanceManager.getDefault(ConditionalNG_Manager.class).createConditionalNG(l, u.isEmpty() ? null : u);
                    if (c == null) {
                        throw new JsonException(500, "JMRI couldn't create the ConditionalNG", id);
                    }
                    c.setEnabled(true);
                    break;
                }
                case "deleteConditionalNG": {
                    ConditionalNG c = conditionalNG(l, data, id);
                    c.unregisterListeners();
                    if (c.getFemaleSocket().isConnected()) {
                        MaleSocket m = c.getFemaleSocket().getConnectedSocket();
                        c.getFemaleSocket().disconnect();
                        deleteTree(m);
                    }
                    InstanceManager.getDefault(ConditionalNG_Manager.class).deleteConditionalNG(c);
                    break;
                }
                case "add":
                case "edit":
                case "remove":
                case "setEnabled":
                    editTree(conditionalNG(l, data, id), op, data, id);
                    break;
                case "":
                    break;
                default:
                    throw new JsonException(400, "Unknown LogixNG edit " + op, id);
            }
            if (data.has("enabled")) {
                l.setEnabled(data.path("enabled").asBoolean());
            }
            return logixNG(mapper, l);
        }, id);
    }

    private static ConditionalNG conditionalNG(LogixNG l, JsonNode data, int id) throws JsonException {
        String n = data.path("conditionalNG").asText("");
        for (int i = 0; i < l.getNumConditionalNGs(); i++) {
            ConditionalNG c = l.getConditionalNG(i);
            if (c != null && (n.equals(c.getSystemName()) || n.equals(c.getUserName()))) {
                return c;
            }
        }
        throw new JsonException(404, "No ConditionalNG " + n + " in " + l.getDisplayName(), id);
    }

    /** Change a ConditionalNG's tree with its listeners off, as JMRI's TreeEditor does. */
    private static void editTree(ConditionalNG c, String op, JsonNode data, int id) throws JsonException {
        FemaleSocket root = c.getFemaleSocket();
        FemaleSocket s = at(c, data.path("path"), id);
        root.unregisterListeners();
        try {
            switch (op) {
                case "add": {
                    if (s.isConnected()) {
                        throw new JsonException(409, "Socket " + s.getName() + " is already in use", id);
                    }
                    MaleSocket m = create(data.path("type").asText(""), kind(s), id);
                    try {
                        apply(item(m), data.path("config"), id);
                        if (!s.isCompatible(m)) {
                            throw new JsonException(400, data.path("type").asText() + " doesn't fit socket " + s.getName(), id);
                        }
                        s.connect(m);
                        m.setup();
                    } catch (JsonException | SocketAlreadyConnectedException | RuntimeException e) {
                        if (!s.isConnected()) {
                            deleteTree(m);
                        }
                        throw e instanceof JsonException ? (JsonException) e : new JsonException(500, e.toString(), id);
                    }
                    break;
                }
                case "edit":
                    if (!s.isConnected()) {
                        throw new JsonException(404, "Socket " + s.getName() + " is empty", id);
                    }
                    apply(item(s.getConnectedSocket()), data.path("config"), id);
                    break;
                case "setEnabled":
                    if (s.isConnected()) {
                        s.getConnectedSocket().setEnabled(data.path("enabled").asBoolean(true));
                    }
                    break;
                default: // remove
                    if (s.isConnected()) {
                        MaleSocket m = s.getConnectedSocket();
                        s.disconnect();
                        deleteTree(m);
                    }
            }
        } finally {
            if (root.isActive()) {
                root.registerListeners();
            }
        }
    }
}
