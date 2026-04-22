#!/usr/bin/env bash
# ant-gui Linux diagnostic. Run on a reporter's machine and paste the
# output back into the issue. All commands are read-only.
#
# Targets the class of errors where GVfs / GIO / libcurl modules fail
# to load with undefined-symbol complaints (e.g. g_task_set_static_name,
# nghttp2_option_set_no_rfc9113_leading_and_trailing_ws_validation).

set +e

echo '== /etc/os-release =='
cat /etc/os-release

echo
echo '== binary path =='
BIN="$(readlink -f "$(which ant-gui 2>/dev/null)")"
if [ -n "$BIN" ]; then
    echo "$BIN"
    file "$BIN"
else
    echo '(ant-gui not on PATH)'
fi

echo
echo '== ldd (glib / gio / curl / nghttp2) =='
if [ -n "$BIN" ]; then
    ldd "$BIN" | grep -E 'glib|gio|curl|nghttp2'
else
    echo '(no binary — skipping ldd)'
fi

echo
echo '== installed package versions =='
dpkg -l libglib2.0-0 libcurl3-gnutls libnghttp2-14 gvfs dconf-service 2>/dev/null \
    | awk '/^ii/ {print $2, $3}'

echo
echo '== upgradable packages =='
apt list --upgradable 2>/dev/null | grep -E 'glib|gvfs|curl|nghttp2|dconf' \
    || echo '(none)'

echo
echo '== apt policy =='
apt policy libglib2.0-0 libcurl3-gnutls libnghttp2-14 2>/dev/null

echo
echo '== app config dir =='
ls -la ~/.config/autonomi/ant-gui/ 2>/dev/null || echo '(no config dir yet)'

echo
echo '== please also answer in plain text =='
echo '  (a) Does the file picker open when you click Upload / Download?'
echo '  (b) Can you import a private key or connect a wallet?'
echo '  (c) Do uploads actually fail, or do you just see the stderr noise?'
