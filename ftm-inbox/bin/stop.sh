#!/bin/bash
if [ -f /tmp/ftm-inbox.pid ]; then
    kill $(cat /tmp/ftm-inbox.pid) 2>/dev/null
    rm /tmp/ftm-inbox.pid
    echo "ftm-inbox stopped."
else
    echo "No running ftm-inbox found."
fi
