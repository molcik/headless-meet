#!/bin/bash

cd ~/headless-meet

cd be
node dist/main &
cd ..

cd fe
npm run start
