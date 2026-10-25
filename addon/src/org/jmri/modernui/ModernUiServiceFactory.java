package org.jmri.modernui;

import com.fasterxml.jackson.databind.ObjectMapper;
import jmri.server.json.JsonConnection;
import jmri.spi.JsonServiceFactory;

/**
 * Adds JSON types JMRI does not ship: {@code programmer} (CV read/write),
 * {@code logix} and {@code logixng}, plus {@code modernUiAddon} so clients can
 * detect the add-on. Registered through META-INF/services, so putting this jar
 * on JMRI's classpath is all that is needed.
 */
public class ModernUiServiceFactory implements JsonServiceFactory<ModernUiHttpService, ModernUiSocketService> {

    public static final String PROGRAMMER = "programmer";
    public static final String LOGIX = "logix";
    public static final String LOGIXNG = "logixng";
    public static final String ADDON = "modernUiAddon";
    /** Valid aspects (masts) or appearances (heads) of a signal; JMRI's JSON doesn't expose them. */
    public static final String SIGNAL_ASPECTS = "signalAspects";
    /** Build / reset / move / terminate an operations train; JMRI's JSON can only move and terminate. */
    public static final String TRAIN_ACTION = "trainAction";
    public static final String VERSION = "1.1.0";

    @Override
    public String[] getTypes(String version) {
        return new String[]{PROGRAMMER, LOGIX, LOGIXNG, ADDON, SIGNAL_ASPECTS, TRAIN_ACTION};
    }

    @Override
    public ModernUiSocketService getSocketService(JsonConnection connection, String version) {
        return new ModernUiSocketService(connection, new ModernUiHttpService(connection.getObjectMapper()));
    }

    @Override
    public ModernUiHttpService getHttpService(ObjectMapper mapper, String version) {
        return new ModernUiHttpService(mapper);
    }
}
