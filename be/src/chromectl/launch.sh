#!/bin/bash

killall chromium-browser

export DISPLAY=:0

chromium-browser "https://meet.google.com/$1" --use-fake-ui-for-media-stream --load-extension=$(pwd)/src/chromectl/chrome-extension
