#!/bin/bash
# tap-css.sh "<js expression returning an Element>"  -> real tap on its centre
ADB=$HOME/Library/Android/sdk/platform-tools/adb
r=$(node "$(dirname "$0")/cdp.mjs" eval "(()=>{const e=($1); if(!e) return null; const b=e.getBoundingClientRect(); return [b.left+b.width/2, b.top+b.height/2, devicePixelRatio, screen.height*devicePixelRatio, innerHeight*devicePixelRatio]})()")
read x y dpr sh ih <<<"$(echo "$r" | python3 -I -c "import sys,json;v=json.load(sys.stdin);print(*v) if v else print('')")"
[ -z "$x" ] && { echo "element not found"; exit 1; }
# The WebView sits below the status bar: its top is the window inset.
top=$($ADB shell dumpsys window | grep -m1 -o "statusBars.*frame=\[0,0\]\[[0-9]*,[0-9]*\]" | grep -o "\]\[[0-9]*,[0-9]*\]" | grep -o ",[0-9]*" | tr -d ,)
top=${top:-136}
X=$(python3 -c "print(int($x*$dpr))"); Y=$(python3 -c "print(int($y*$dpr+$top))")
$ADB shell input tap $X $Y; echo "tap $X,$Y (top=$top)"
