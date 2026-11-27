#!/bin/bash
# ui.sh dump            -> list clickable/text nodes with centers
# ui.sh tap "<text>"    -> tap the node whose text/content-desc matches
ADB=$HOME/Library/Android/sdk/platform-tools/adb
dump() { $ADB exec-out uiautomator dump /dev/tty 2>/dev/null; }
case "$1" in
  dump) dump | python3 -I -c "
import sys,re
for m in re.finditer(r'<node [^>]*>',sys.stdin.read()):
  n=m.group(0); t=re.search(r' text=\"([^\"]*)\"',n).group(1); d=re.search(r'content-desc=\"([^\"]*)\"',n).group(1)
  b=list(map(int,re.findall(r'\d+',re.search(r'bounds=\"([^\"]*)\"',n).group(1))))
  if t or d: print(f'{(b[0]+b[2])//2},{(b[1]+b[3])//2}  {t!r} {d!r}')
";;
  tap) xy=$(dump | python3 -I -c "
import sys,re
want=sys.argv[1]
for m in re.finditer(r'<node [^>]*>',sys.stdin.read()):
  n=m.group(0)
  if f'text=\"{want}\"' in n or f'content-desc=\"{want}\"' in n:
    b=list(map(int,re.findall(r'\d+',re.search(r'bounds=\"([^\"]*)\"',n).group(1)))); print((b[0]+b[2])//2,(b[1]+b[3])//2); break
" "$2"); [ -z "$xy" ] && { echo "not found: $2"; exit 1; }; $ADB shell input tap $xy; echo "tapped $2 at $xy";;
esac
