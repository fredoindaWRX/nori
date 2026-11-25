package systems.nori.homehelper;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.WallpaperManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.util.Log;

import java.io.IOException;
import java.io.InputStream;

/** After boot: wait until the Foxwell app has opened itself, then go to the home screen once. */
public class BootReceiver extends BroadcastReceiver {
    static final String GO_HOME = "systems.nori.homehelper.GO_HOME";
    static final String SET_WALLPAPER = "systems.nori.homehelper.SET_WALLPAPER";
    static final long DELAY_MS = 30000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)) {
            Intent later = new Intent(context, BootReceiver.class).setAction(GO_HOME);
            PendingIntent pending = PendingIntent.getBroadcast(context, 0, later, PendingIntent.FLAG_UPDATE_CURRENT);
            AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    SystemClock.elapsedRealtime() + DELAY_MS, pending);
        } else if (SET_WALLPAPER.equals(action)) {
            // Sent by hand over adb: puts the picture packed in this app (assets/wallpaper.jpg) on the home screen.
            try (InputStream picture = context.getAssets().open("wallpaper.jpg")) {
                WallpaperManager.getInstance(context).setStream(picture);
            } catch (IOException error) {
                Log.w("NoriHomeHelper", "wallpaper not set: " + error);
            }
        } else if (GO_HOME.equals(action)) {
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(home);
        }
    }
}
