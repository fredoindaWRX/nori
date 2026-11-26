# Foxwell i50: enable ADB, get root, and fix Tailscale/VPN

Notes from working on one tablet. Everything here was done on a device we own. It is for
owners who want to get into their own tablet's Android system and fix a VPN that silently
fails on it. Do this at your own risk; a wrong `ip`/`setprop`/`pm` command can knock the
tablet off the network or stop an app working.

**Device this was verified on**

| Item | Value |
|---|---|
| Model (software identity) | `i50` |
| SoC | MediaTek `MT8167` |
| Android | 9 (API 28) |
| Foxwell app | `com.foxwelltech.i50` |
| Bootloader / verified boot | locked, green |
| SELinux | **permissive** |

Sold as an NT-series unit, but the verified software identity is i50 / MT8167 / Android 9.
Values below (paths, properties, the password check) were read from *this* tablet's own
software and may differ on another build. Check your own before trusting a number.

---

## Problem 1 — USB works but ADB doesn't

Plugged into a PC the tablet shows up only as a file-transfer (MTP) device
(`VID_0E8D&PID_2008`), with no ADB interface. Developer options are gated: the Build-number
tapping trick leads to a **custom password prompt**, not the normal unlock.

**How the gate works.** The Settings app checks a hard-coded password in
`com.android.settings.deviceinfo.BuildNumberPreferenceController`. On a match it sets
`development_settings_enabled=1` and `adb_enabled=1` — i.e. the right password turns on
Developer options and USB debugging. The password is **baked into the Settings APK**, so it
is the same on every tablet with that build, but it is not published here. Find it on your
own device:

1. Install **App Manager** (`io.github.muntashirakon.AppManager`) from F-Droid. If the
   Settings screen is hard to reach, **Activity Launcher** (also F-Droid) opens hidden
   activities.
2. In App Manager (no-root mode), open **Settings** (`com.android.settings`) → **Save APK**.
   Copy the APK to a PC.
3. Decompile it (e.g. [jadx](https://github.com/skylot/jadx)) and read
   `BuildNumberPreferenceController`. The string compared against your typed password is the
   password. (`if ("…".equals(pwd))`.)
4. On the tablet: **Settings → About → tap Build number 7×**, complete any screen-lock
   prompt, then enter that password at the custom dialog.

ADB then appears (`VID_0E8D&PID_201D`, interface `MI_01`). Use Google's
[platform-tools](https://developer.android.com/tools/releases/platform-tools):

```
adb devices -l      # should list the tablet as "device"
adb shell id        # uid=2000(shell) — connected, but not root yet
```

---

## Problem 2 — `adb root` is refused even though the build is debuggable

```
adb root
# root access is disabled by system setting - enable in settings -> development options
```

The tablet reports `ro.debuggable=1` but its `adbd` still refuses root. The deciding property
is `persist.sys.root_access`, and this ROM's `adbd` does **not** treat it as a yes/no flag:
the earlier analysis of the `adbd` binary found it runs the value through `atoi` and checks
**bit `0x02`**. So the text `true` parses to `0` (bit missing → refused), while `2` has the
bit set (→ allowed). Confirmed behaviorally here: with the value at `2`, `adb root` returns a
root shell; the `adbd` binary does reference `persist.sys.root_access` and carries that exact
refusal message.

```
adb shell setprop persist.sys.root_access 2
adb shell getprop persist.sys.root_access     # 2
adb root                                        # restarting adbd as root
adb shell id                                    # uid=0(root) gid=0(root)
```

That's it — a root ADB shell, with **no Magisk and no patched boot image**, on a tablet that
still reports a locked bootloader and green verified boot. (If `adb shell id` runs before the
daemon finishes reconnecting, wait a second and run it again.)

**Why apps can also get root:** the ROM ships a setuid-root `su` as `/system/xbin/foxwell`
(byte-identical to `daemonsu` — a renamed SuperSU-style `su`), and SELinux is **permissive**.
So an ordinary app can `Runtime.getRuntime().exec("foxwell")` and pipe it root commands. The
stock Foxwell app does exactly this to set up its vehicle-Ethernet routing, and the small
helper app in this folder uses the same door for the Tailscale fix below.

---

## Problem 3 — Tailscale says "Connected" but nothing reaches the tailnet

This is the one that isn't written up anywhere else, so here it is in full.

**Symptom.** Tailscale on the tablet shows **Connected**, `tailscale ping` works, the admin
console shows the tablet online — but every actual connection to a `100.x.y.z` tailnet
address times out. From the tablet:

```
adb shell 'printf "GET / HTTP/1.0\r\n\r\n" | toybox nc -w 5 100.x.y.z 80'   # times out
```

**Cause.** The ROM's own System UI adds a routing rule at every start. Read from
`MtkSystemUI.apk`, `com.android.systemui.SystemUIApplication` → `updateIpRule()` runs, through
the `foxwell` root binary:

```
ip rule add from all lookup main pref 9999
```

and on Wi-Fi coming up it adds a Wi-Fi default route into table `main`. Android normally sends
VPN traffic via rules at priority 10000+, but this rule at **9999 comes first**, so anything
addressed to a tailnet IP is matched here, sent to table `main`, and leaves over Wi-Fi —
where it goes nowhere. (Our read of why the ROM does this: keep internet on Wi-Fi while the
vehicle's DoIP Ethernet is plugged in. The Foxwell app itself uses a separate table `100` for
that Ethernet link and was not the cause.) Check for it:

```
adb shell ip rule | grep 9999      # 9999: from all lookup main  → you have this bug
```

**Fix.** Let only tailnet addresses skip past that rule, back to Android's normal VPN rules,
which already route them into the tunnel — whatever the tunnel interface is named
(`tun0`, `tun1`, …):

```
adb root
adb shell ip rule add to 100.64.0.0/10 priority 9000 goto 10000
```

`100.64.0.0/10` is the whole CGNAT range Tailscale uses, so this covers every tailnet peer.
Everything else still obeys the ROM's rule, so the Foxwell Ethernet setup is untouched. Test:

```
adb shell ip route get 100.64.0.1          # should say "dev tunN", not "dev wlan0"
adb shell 'printf "GET / HTTP/1.0\r\n\r\n" | toybox nc -w 5 <a-tailnet-ip> 80'   # answers now
```

**Make it stick.** The rule is in memory only — it's gone after a reboot, and after Tailscale
reconnects (the tunnel comes back under a new name, but the rule targets addresses not the
interface, so it keeps working; it just has to be re-added after a reboot). The ROM's system
partition is verified at boot, so there's nowhere to drop a boot script with real root held
off. The approach that works without touching the system image: a tiny app that re-applies
the rule at `BOOT_COMPLETED` via the `foxwell` root binary. The source is in
[`home-helper/`](home-helper/) in this folder; it also sends the launcher home after boot.
Verified surviving both a Tailscale reconnect and a cold reboot.

---

## Status / honesty

- Verified here: the Settings password gate and what it sets; `persist.sys.root_access=2`
  giving a root shell; `foxwell` == `daemonsu`; SELinux permissive; the System UI 9999 rule
  and the Tailscale fix (after reconnect and reboot).
- Not established by this sequence: whether root survives a factory reset; whether every app
  (not just those using `foxwell`) gets root. A code pull of the tablet is not a full backup —
  firmware, licenses, databases and vehicle records are separate.
- Numbers, paths and the password are per-build. Read your own device; don't assume.
