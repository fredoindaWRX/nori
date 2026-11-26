#!/bin/bash
# Builds nori-home-helper.apk with the Android build tools in C:\Nori\tools\android-sdk (no Gradle, no Android Studio).
# Signing key: a local debug key kept outside the repo (tools/android-sdk/nori-debug.keystore).
set -e
export MSYS_NO_PATHCONV=1
SDK="C:/Nori/tools/android-sdk"; BT="$SDK/bt/android-10"; JAR="$SDK/plat/android-9/android.jar"
JDK="C:/Nori/tools/analysis-engines/jdk-25.0.4.1+1/bin"; export PATH="/c/Nori/tools/analysis-engines/jdk-25.0.4.1+1/bin:$PATH"
OUT=build; rm -rf $OUT; mkdir -p $OUT/classes $OUT/dex
"$JDK/javac.exe" -nowarn --release 8 -cp "$JAR" -d $OUT/classes src/systems/nori/homehelper/*.java
"$JDK/java.exe" -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --lib "$JAR" --min-api 21 --output $OUT/dex $(find $OUT/classes -name "*.class")
"$BT/aapt2.exe" link -o $OUT/base.apk --manifest AndroidManifest.xml -A assets -I "$JAR" --min-sdk-version 21 --target-sdk-version 25 --version-code 4 --version-name 1.3
(cd $OUT/dex && python -c "import zipfile; z=zipfile.ZipFile('../base.apk','a',zipfile.ZIP_DEFLATED); z.write('classes.dex'); z.close()")
"$BT/zipalign.exe" -f 4 $OUT/base.apk $OUT/aligned.apk
KS="$SDK/nori-debug.keystore"
[ -f "$KS" ] || "$JDK/keytool.exe" -genkeypair -keystore "$KS" -storepass android -keypass android -alias nori -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Nori Local Debug" >/dev/null 2>&1
"$JDK/java.exe" -jar "$BT/lib/apksigner.jar" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android --out nori-home-helper.apk $OUT/aligned.apk
"$JDK/java.exe" -jar "$BT/lib/apksigner.jar" verify --print-certs nori-home-helper.apk | head -2
ls -la nori-home-helper.apk | awk '{print $5" bytes"}'
