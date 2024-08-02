#!/bin/bash

echo "Hi There!"

chromium-browser "https://meet.google.com/$1" --use-fake-ui-for-media-stream

sleep 12

wtype -M ctrl f -m ctrl
sleep 1.2
wtype -d 12 your name
sleep 0.9
wtype -P Escape -p Escape
sleep 0.7
wtype -P Tab -p Tab
sleep 0.5
wtype -d 12 Meeting Room
sleep 0.2
wtype -P Return -p Return
