package systems.nori.homehelper;

import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

/**
 * An always-on-top Home button. Tap it to go to the launcher from any app (even when the Foxwell
 * app has taken over the screen); drag it to move it out of the way. Needs the "draw over other
 * apps" permission (granted over adb at install). targetSdk is 25, so no foreground notification is
 * required; START_STICKY brings it back if Android reclaims it.
 *
 * The service is its own OnTouchListener (no anonymous/inner class) because the bundled d8 trips
 * over the null inner-class name of an anonymous listener.
 */
public class FloatingHomeService extends Service implements View.OnTouchListener {
    private WindowManager wm;
    private View button;
    private WindowManager.LayoutParams lp;
    private float downX, downY;
    private int startX, startY;
    private boolean moved;

    @Override
    public IBinder onBind(Intent i) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (button == null) {
            addButton();
        }
        return START_STICKY;
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void addButton() {
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        if (wm == null) {
            return;
        }
        TextView tv = new TextView(this);
        tv.setText("⌂");                       // house glyph
        tv.setTextColor(Color.parseColor("#0E1420"));
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 32);
        tv.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.parseColor("#C9A83E"));   // Nori gold
        bg.setStroke(dp(3), Color.parseColor("#0E1420"));
        tv.setBackground(bg);
        tv.setAlpha(0.92f);
        button = tv;

        int size = dp(68);
        int type = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        lp = new WindowManager.LayoutParams(size, size, type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = dp(8);
        lp.y = dp(140);

        tv.setOnTouchListener(this);
        try {
            wm.addView(button, lp);
        } catch (Exception ignored) {
        }
    }

    @Override
    public boolean onTouch(View v, MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = e.getRawX();
                downY = e.getRawY();
                startX = lp.x;
                startY = lp.y;
                moved = false;
                return true;
            case MotionEvent.ACTION_MOVE:
                int dx = (int) (e.getRawX() - downX);
                int dy = (int) (e.getRawY() - downY);
                if (Math.abs(dx) > dp(8) || Math.abs(dy) > dp(8)) {
                    moved = true;
                }
                lp.x = startX + dx;
                lp.y = startY + dy;
                try {
                    wm.updateViewLayout(button, lp);
                } catch (Exception ignored) {
                }
                return true;
            case MotionEvent.ACTION_UP:
                if (!moved) {
                    startActivity(new Intent(Intent.ACTION_MAIN)
                            .addCategory(Intent.CATEGORY_HOME)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                }
                return true;
            default:
                return false;
        }
    }

    @Override
    public void onDestroy() {
        if (wm != null && button != null) {
            try {
                wm.removeView(button);
            } catch (Exception ignored) {
            }
            button = null;
        }
        super.onDestroy();
    }
}
