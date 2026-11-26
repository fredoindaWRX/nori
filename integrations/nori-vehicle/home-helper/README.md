# Nori home helper (Foxwell i50 tablet)

A tiny Android app (no screen, no internet permission) for a Foxwell i50 scan tablet
(Android 9, MediaTek, Runzhuo ROM). It does three things:

1. **Fixes Tailscale** at every boot (details below).
2. **Goes to the home screen** 30 s after boot, after the Foxwell app has opened itself.
3. **Sets the wallpaper** packed in `assets/wallpaper.jpg`, when told to over adb.

## The Tailscale problem

On this ROM, Tailscale shows **Connected** and `tailscale ping` works, but nothing on the
tablet can reach a Tailscale address: every connection to `100.x.y.z` times out.

Cause, read from the ROM's own `MtkSystemUI.apk` (`SystemUIApplication.updateIpRule`): every
time System UI starts, it runs this through the ROM's root binary `/system/xbin/foxwell`:

```
ip rule add from all lookup main pref 9999
```

and when Wi-Fi connects it adds a Wi-Fi default route to table `main`. That rule sits ahead
of Android's VPN rules (priority 10000 and up), so traffic for Tailscale addresses goes
straight out over Wi-Fi and is lost. Check with `adb shell ip rule`: if you see
`9999: from all lookup main`, you have it.

## The fix

One rule that lets only Tailscale addresses skip the ROM's rule:

```
ip rule add to 100.64.0.0/10 priority 9000 goto 10000
```

Traffic to `100.64.0.0/10` then falls through to Android's normal rules, which already send
it into the VPN, whatever the tunnel is called (`tun0`, `tun1`, ...). Everything else still
uses the ROM's rule, so the Foxwell vehicle-Ethernet (DoIP) setup is untouched.

The rule is lost on reboot, so this app adds it at `BOOT_COMPLETED` and again 30 s later
(in case System UI restarted). It runs it through the ROM's own `foxwell` root binary, the
same way System UI does; that works because SELinux is permissive on this ROM. To apply it
by hand:

```
adb shell am broadcast -a systems.nori.homehelper.FIX_TAILSCALE -n systems.nori.homehelper/.BootReceiver
```

Tested after a Tailscale reconnect and a cold reboot. Not tested with the DoIP Ethernet
cable plugged in.

## Build

No Gradle: `build.sh` uses javac, d8, aapt2, zipalign and apksigner from an Android SDK
(build-tools 29.0.3, platform 28). Edit the paths at the top of `build.sh` for your machine.
Install with `adb install -r nori-home-helper.apk`, then open it once
(`adb shell am start -n systems.nori.homehelper/.MainActivity`) so Android lets it receive
the boot broadcast.
