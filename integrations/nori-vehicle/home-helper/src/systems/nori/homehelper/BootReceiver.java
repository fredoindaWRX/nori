package systems.nori.homehelper;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.WallpaperManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.util.Log;

import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * After boot: let Tailscale traffic past the ROM's routing rule, wait until the Foxwell app has
 * opened itself, then go to the home screen once.
 */
public class BootReceiver extends BroadcastReceiver {
    static final String GO_HOME = "systems.nori.homehelper.GO_HOME";
    static final String SET_WALLPAPER = "systems.nori.homehelper.SET_WALLPAPER";
    static final String FIX_TAILSCALE = "systems.nori.homehelper.FIX_TAILSCALE";
    static final long DELAY_MS = 30000L;

    /*
     * The ROM's System UI (SystemUIApplication.updateIpRule, read from MtkSystemUI.apk on 2026-11-25)
     * runs "ip rule add from all lookup main pref 9999" each time it starts, and keeps a Wi-Fi default
     * route in table main. That rule comes before Android's VPN rules (10000 and up), so traffic for
     * Tailscale addresses left by Wi-Fi and never arrived. This rule makes only Tailscale addresses
     * (100.64.0.0/10) jump past it to Android's normal rules, which already send them into the VPN under
     * whatever name the tunnel has. Everything else still uses the ROM's rule, so the Foxwell
     * vehicle-Ethernet setup is unchanged. It runs through the ROM's own root binary, as System UI does.
     */
    static final String TAILSCALE_RULE =
            "ip rule del priority 9000 2>/dev/null\n"
            + "ip rule add to 100.64.0.0/10 priority 9000 goto 10000\n";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)) {
            fixTailscale();
            startHomeButton(context);
            Intent later = new Intent(context, BootReceiver.class).setAction(GO_HOME);
            PendingIntent pending = PendingIntent.getBroadcast(context, 0, later, PendingIntent.FLAG_UPDATE_CURRENT);
            AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    SystemClock.elapsedRealtime() + DELAY_MS, pending);
        } else if (FIX_TAILSCALE.equals(action)) {
            fixTailscale();
        } else if (SET_WALLPAPER.equals(action)) {
            // Sent by hand over adb: puts the picture packed in this app (assets/wallpaper.jpg) on the home screen.
            try (InputStream picture = context.getAssets().open("wallpaper.jpg")) {
                WallpaperManager.getInstance(context).setStream(picture);
            } catch (IOException error) {
                Log.w("NoriHomeHelper", "wallpaper not set: " + error);
            }
        } else if (GO_HOME.equals(action)) {
            fixTailscale();   // again, in case System UI restarted since boot
            startHomeButton(context);
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(home);
        }
    }

    static void startHomeButton(Context context) {
        try {
            context.startService(new Intent(context, FloatingHomeService.class));
        } catch (Exception error) {
            Log.w("NoriHomeHelper", "home button not started: " + error);
        }
    }

    static void fixTailscale() {
        try {
            Process root = Runtime.getRuntime().exec("foxwell");
            try (DataOutputStream in = new DataOutputStream(root.getOutputStream())) {
                in.writeBytes(TAILSCALE_RULE);
                in.writeBytes("exit\n");
                in.flush();
            }
            root.waitFor();
            Log.i("NoriHomeHelper", "Tailscale route rule applied, exit " + root.exitValue());
        } catch (IOException | InterruptedException error) {
            Log.w("NoriHomeHelper", "Tailscale route rule not applied: " + error);
        }
    }
}
