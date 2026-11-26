package systems.nori.homehelper;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** Shows nothing. Opening it once takes the app out of Android's "never started" state and starts the Home button. */
public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            startService(new Intent(this, FloatingHomeService.class));
        } catch (Exception ignored) {
        }
        finish();
    }
}
