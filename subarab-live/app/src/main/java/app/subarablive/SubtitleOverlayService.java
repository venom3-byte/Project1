package app.subarablive;

import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.widget.TextView;

public class SubtitleOverlayService extends Service {
    public static final String ACTION_TOGGLE = "app.subarablive.TOGGLE_OVERLAY";
    public static final String ACTION_UPDATE = "app.subarablive.UPDATE_OVERLAY";
    private WindowManager manager;
    private TextView subtitle;
    private WindowManager.LayoutParams params;
    private boolean shown = false;
    private String latestText = "";

    @Override public void onCreate() {
        super.onCreate();
        manager = (WindowManager) getSystemService(WINDOW_SERVICE);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : intent.getAction();
        if (ACTION_TOGGLE.equals(action)) {
            if (shown) removeOverlay(); else showOverlay();
        } else if (ACTION_UPDATE.equals(action)) {
            String text = intent.getStringExtra("text");
            if (text != null) {
                latestText = text;
                if (shown && subtitle != null) subtitle.setText(text);
            }
        }
        return START_NOT_STICKY;
    }

    private void showOverlay() {
        showOverlayWithText(latestText.isEmpty() ? "ستظهر الترجمة العربية هنا" : latestText);
    }

    private void showOverlayWithText(String text) {
        if (shown || !Settings.canDrawOverlays(this)) return;
        subtitle = new TextView(this);
        subtitle.setText(text);
        subtitle.setTextColor(Color.WHITE);
        subtitle.setTextSize(19);
        subtitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        subtitle.setGravity(Gravity.CENTER);
        subtitle.setTextDirection(TextView.TEXT_DIRECTION_RTL);
        subtitle.setPadding(18, 12, 18, 12);
        subtitle.setBackgroundColor(0xD9000000);
        params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        params.y = 100;
        subtitle.setOnTouchListener((v, event) -> {
            if (event.getAction() == MotionEvent.ACTION_DOWN) {
                v.setTag(new float[]{event.getRawX(), event.getRawY(), params.x, params.y});
                return true;
            }
            if (event.getAction() == MotionEvent.ACTION_MOVE) {
                float[] start = (float[]) v.getTag();
                params.x = (int) (start[2] + event.getRawX() - start[0]);
                params.y = (int) (start[3] - (event.getRawY() - start[1]));
                try { manager.updateViewLayout(subtitle, params); } catch (Exception ignored) {}
                return true;
            }
            return event.getAction() == MotionEvent.ACTION_UP;
        });
        try {
            manager.addView(subtitle, params);
            shown = true;
        } catch (Exception e) {
            subtitle = null;
            shown = false;
        }
    }

    private void removeOverlay() {
        if (subtitle != null) {
            try { manager.removeView(subtitle); } catch (Exception ignored) {}
        }
        subtitle = null;
        shown = false;
        stopSelf();
    }

    @Override public void onDestroy() { removeOverlay(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
