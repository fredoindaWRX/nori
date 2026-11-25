package systems.nori.homehelper;

import android.app.Activity;
import android.os.Bundle;

/** Shows nothing. Opening it once takes the app out of Android's "never started" state. */
public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        finish();
    }
}
