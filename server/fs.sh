# File operations for the Code Editor, run as `sh -c <this> sh <op> <args...>`
# on the terminal the editor was opened on. POSIX sh plus stat/base64, so it
# works on GNU and busybox alike. A failure the editor has to tell apart is
# reported on stderr as "OCERR:<code>" with exit status 3.
op="$1"; shift
err() { printf 'OCERR:%s\n' "$1" >&2; exit 3; }
exists() { [ -e "$1" ] || [ -L "$1" ]; }
case "$op" in
  stat)
    exists "$1" || err ENOENT
    t=$(stat -L -c '%F|%s|%Y' -- "$1" 2>/dev/null) || t=$(stat -c '%F|%s|%Y' -- "$1") || err EACCES
    l=; [ -L "$1" ] && l=L
    printf '%s|%s\n' "$t" "$l" ;;
  readdir)
    exists "$1" || err ENOENT
    [ -d "$1" ] || err ENOTDIR
    cd -- "$1" 2>/dev/null || err EACCES
    for f in * .[!.]* ..?*; do
      exists "$f" || continue
      t=$(stat -L -c '%F' -- "$f" 2>/dev/null) || t=broken
      l=; [ -L "$f" ] && l=L
      printf '%s|%s|%s\n' "$t" "$l" "$f"
    done ;;
  read)
    exists "$1" || err ENOENT
    [ -d "$1" ] && err EISDIR
    [ -r "$1" ] || err EACCES
    base64 < "$1" ;;
  write-check)
    # $1 path, $2 create allowed (1/0), $3 overwrite allowed (1/0)
    if exists "$1"; then
      [ -d "$1" ] && err EISDIR
      [ "$3" = 1 ] || err EEXIST
    else
      [ "$2" = 1 ] || err ENOENT
      [ -d "$(dirname -- "$1")" ] || err ENOENT
    fi
    mktemp 2>/dev/null || { t="${TMPDIR:-/tmp}/oc-write-$$"; : > "$t" && echo "$t"; } ;;
  write-chunk)
    # $1 temp file; the chunk arrives base64 in $OC_DATA
    printf %s "$OC_DATA" | base64 -d >> "$1" || err EIO ;;
  write-commit)
    # Copied over rather than moved, so the target keeps its mode, owner and links.
    cat -- "$1" > "$2" || { rm -f -- "$1"; err EACCES; }
    rm -f -- "$1" ;;
  mkdir)
    exists "$1" && err EEXIST
    [ -d "$(dirname -- "$1")" ] || err ENOENT
    mkdir -- "$1" || err EACCES ;;
  delete)
    # $1 path, $2 recursive (1/0)
    exists "$1" || err ENOENT
    if [ -d "$1" ] && [ ! -L "$1" ]; then
      if [ "$2" = 1 ]; then rm -rf -- "$1" || err EACCES; else rmdir -- "$1" 2>/dev/null || err ENOTEMPTY; fi
    else
      rm -f -- "$1" || err EACCES
    fi ;;
  rename)
    # $1 from, $2 to, $3 overwrite allowed (1/0)
    exists "$1" || err ENOENT
    if exists "$2"; then
      [ "$3" = 1 ] || err EEXIST
      rm -rf -- "$2" || err EACCES
    fi
    mv -- "$1" "$2" || err EACCES ;;
  find|grep)
    # $1 folder, $2 max output lines; grep: $3 flags (E: regex, i: ignore case,
    # w: whole word), the pattern in $OC_PATTERN. Skips VCS and dependency
    # folders, and the kernel's pseudo file systems when searching from /.
    cd -- "$1" 2>/dev/null || err ENOENT
    prune='-name .git -o -name .hg -o -name .svn -o -name node_modules -o -name __pycache__ -o -path ./proc -o -path ./sys -o -path ./dev -o -path ./run'
    if [ "$op" = find ]; then
      # shellcheck disable=SC2086
      find . \( $prune \) -prune -o -type f -print 2>/dev/null | head -n "$2"
    else
      o='-nH'
      case "$3" in *E*) o="$o -E" ;; *) o="$o -F" ;; esac
      case "$3" in *i*) o="$o -i" ;; esac
      case "$3" in *w*) o="$o -w" ;; esac
      grep -I -q x /dev/null 2>/dev/null; [ $? -le 1 ] && o="$o -I"
      # shellcheck disable=SC2086
      find . \( $prune \) -prune -o -type f -size -2048k -print0 2>/dev/null |
        xargs -0 grep $o -e "$OC_PATTERN" -- 2>/dev/null | cut -c 1-2000 | head -n "$2"
    fi ;;
  *)
    err EINVAL ;;
esac
