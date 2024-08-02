#!/bin/bash

cd be
npm install
npm run build
cd ..

cd fe
npm install
npm run build
npm run start &
node ../be/dist/main 