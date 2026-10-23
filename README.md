# GoPro Split Screen

![Westlime Motorsport](assets/westlime-logo-wide.svg)

Watch two GoPro live feeds side by side, e.g. two cameras on a race truck streaming over Starlink. It runs in any browser (phone, tablet, laptop, TV), so the crew can watch from the pits or from home.

## Using it

1. Open the app and paste one camera's stream link into each half. It accepts:
   - **YouTube Live** links (`youtube.com/live/…`, `youtu.be/…`, `watch?v=…`) or a channel link (`youtube.com/channel/UC…`) to show whatever that channel has live
   - **Twitch** channels (`twitch.tv/name`)
   - **HLS** links ending in `.m3u8`
   - **WebRTC (WHEP)** links from your own stream server, e.g. MediaMTX `https://server:8889/truck1` or Cloudflare Stream `…/webRTC/play`
2. Pick the **car** the camera is on (one camera per car). Its number, class, driver and navigator show on that feed as a caption in Westlime green, like on TV, and the feed is labelled with its car number, e.g. "646".
   - **Add, edit or remove cars** (under the car picker) keeps the list of cars: number, class, driver and navigator. It starts with 646 (Sam Commins / Baxter Cook, SXS Pro), 467 (Andrew Commins / Anthony Cook, Extreme 2WD) and 479 (Nick Commins / Lachlan Bennie, Extreme 2WD). Editing a car updates any camera showing it.
   - The list is saved on each device. A watch link carries the cars it shows, so viewers don't need the list.
3. If a camera is mounted upside down or sideways, set **Picture** to *Upside down* (or a quarter turn), or tap the **rotate** button on the feed. Each tap turns it 90° clockwise.
4. Tap **Share**, give the broadcast a title (e.g. "KDR 2026 · Truck 12") and tap **Copy link** (or **Send…** on a phone) to text or email it.

Whoever opens the watch link goes straight to the cameras, locked exactly as you set them up: the same layout, cars, rotation and cameras on or off. They can only go full screen and turn sound on or off on their own device.

### Live updates

With **Keep everyone's screen updated with my changes** ticked (on by default), the link stays live. When you turn off a dropped camera, swap, switch layout or change cars, everyone watching gets the change within a few seconds, without their feeds restarting. Viewers see a **LIVE** badge. Someone opening the link later gets your latest setup.

- Your page has to be open (on any screen) for changes to go out. Viewers keep the last update in the meantime.
- **Start a new live link** makes a fresh link. Anyone with the old one keeps what they see but stops getting changes.
- Live updates come from the device that made the link. Changes made on another phone or laptop don't reach it.
- Untick it to send a fixed link that shows the cameras as they are now.

How it works: changes travel through [ntfy.sh](https://ntfy.sh), a free public message relay, on a random private channel. Each change is **encrypted** with a key that's only in the link's `#` part, which browsers never send to any server, so the relay can't read your stream links or names. Each change is also **signed** with a key that never leaves your device, so viewers' screens ignore anything not from you, including changes from other viewers. Old changes replayed later are ignored too. ntfy.sh keeps messages for 12 hours, and your page resends the setup every few hours while it's open.

The settings are packed into the link (`#w=…`) so they aren't readable or easy to edit in the address bar.

Other controls:
- **Layout**: *Auto* puts the cameras side by side in landscape and one above the other in portrait. You can also fix it to *Side by side*, *Stacked* or *Picture in picture* (one camera full screen, the other in a small window; the corner button on the small window moves it round the corners).
- **Swap**: switches the two cameras round without dropping either feed. In picture in picture it swaps which one is full screen.
- **Turn a camera off** (the power button on it) when its feed drops: the other camera fills the screen, and the dropped one stops using data. **Turn on …** in the bottom corner brings it back. 
- **Full screen** (where the browser supports it).
- Sound starts muted. **Sound on** plays one camera at a time. YouTube and Twitch use their own speaker button.

A dropped feed reconnects by itself. The dot next to each camera is green when live, amber while waiting or reconnecting, and red for a problem. The screen stays on while you're watching.

## Getting the GoPros streaming over Starlink

Each GoPro joins the Starlink Wi-Fi (or a travel router connected to it) and pushes a live stream out over RTMP. Because the cameras send the stream out, nothing needs opening up on Starlink's side.

### Easiest: YouTube Live (free, about 5–10 s behind)

1. In **YouTube Studio → Create → Go live → Stream**, set up one stream per camera, each with its **own stream key**. Set them to **Unlisted** and **Ultra-low latency**. Turn **Auto-stop off**, so that a Starlink dropout doesn't end the broadcast and change its link.
2. In the **GoPro Quik** app, connect to the first camera and start a livestream using **RTMP**, on the Starlink Wi-Fi, with the URL `rtmp://a.rtmp.youtube.com/live2/<stream key>`. Once it's live, connect to the second camera and do the same with the other key. The cameras keep streaming without the phone.
3. Copy each stream's link (**Share → Copy link**) and paste one into each half of the app.

### Least delay: your own stream server (about 1 s behind)

Run [MediaMTX](https://github.com/bluenviron/mediamtx) on a small cloud server and give it an https address (browsers won't play `http://` streams in an `https://` page). Point the cameras at `rtmp://your-server/truck1` and `rtmp://your-server/truck2`. Then paste `https://your-server:8889/truck1` and `…/truck2` into the app (WebRTC), or `https://your-server:8888/truck1/index.m3u8` (HLS, a few seconds more delay).

### Tips

- Both cameras share Starlink's upload. If either feed keeps buffering, set the cameras to **720p**.
- Using Starlink while driving needs a dish and plan that support in-motion use.

## Hosting

It's a static site with no build step. On GitHub, go to *Settings → Pages* and set *Source* to **GitHub Actions**. Each push to `main` then runs the tests and deploys to `https://<user>.github.io/livestream/`.

To run it on your own computer: `npm start`, then open `http://localhost:8080`.

## Development

```
npm test    # unit tests for link parsing, watch links, the car list and live updates (Node 20+)
```

- `js/sources.js`: works out what a pasted link is and how to play it, and builds watch links (no DOM, runs in Node)
- `js/live.js`: live links: encrypting, signing and sending changes through ntfy.sh, and receiving them (crypto runs in Node for the tests)
- `js/roster.js`: the list of cars, with the team's starting cars (no DOM, runs in Node)
- `js/players.js`: YouTube/Twitch embeds, HLS and WebRTC (WHEP) players with automatic reconnect
- `js/app.js`: the split screen, setup forms, layout, sound and share link
- `assets/westlime-logo-wide.svg`: Westlime Motorsport logo, from the Race Course Plotter (lettering converted to outlines from Cinzel and Kaushan Script, both SIL Open Font License)
- `vendor/hls.light.min.js`: [hls.js](https://github.com/video-dev/hls.js) 1.7.3 (Apache 2.0, see `vendor/hls.js-LICENSE`) for HLS in browsers other than Safari
