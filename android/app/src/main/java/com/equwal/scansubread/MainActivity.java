package com.equwal.scansubread;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins register before the bridge is built.
        registerPlugin(LocalAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
