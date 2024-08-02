#!/bin/bash
apt install nginx, node, npm, chromium-browser

cd ~/

rm -rf headless-meet
git clone https://github.com/molcik/headless-meet -depth 1

# install nestjs be
cd headless-meet
cd be
npm install
npm run build
cd ..

# install nextjs fe
cd fe
npm install
npm run build

# setup ngninx webserver
cp headless-meet.service /etc/systemd/system/
cp nginx.conf /etc/nginx/sites-available/webcam
ln -s /etc/nginx/sites-available/webcam.local /etc/nginx/sites-enabled/webcam.local

# create service, enable it to start on boot and start
cp headless-meet.service /etc/systemd/system/
systemctl enable headless-meet
systemctl start headless-meet
