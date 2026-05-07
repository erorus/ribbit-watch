# Ribbit Watch

This is a [website and notification service](https://ribbit-watch.everynothing.net) which monitors a [Git repository](https://github.com/erorus-everynothing/ribbit) which [tracks](https://github.com/erorus/ribbit.sh) Blizzard's Ribbit server, and formats those updates in a timely and user-friendly way.

There are a lot of little bits and pieces to this setup, so there are no install instructions per se, though this README will attempt to describe all those pieces and what they do.

## General Flow

1. A user has [the website](https://ribbit-watch.everynothing.net) open in their browser. Their browser maintains a websocket connection, through our nginx server, to our `main.js` script which is running as a systemd daemon.
2. [ribbit.sh](https://github.com/erorus/ribbit.sh), running separately, detects an update on Blizzard's servers, and commits the update to a local Git repository.
3. That repo has a post-commit hook which touches `last-commit-time` in our directory.
4. Our `main.js` is watching that file for any changes. It detects the updated timestamp, and that triggers it to examine the local git repo for the latest commit.
5. The script processes that commit into a JSON object, and pushes it to all open websocket connections.
6. The website in the user's browser receives the websocket message, and updates the display and plays a sound, etc.

The [ntfy.sh](https://ntfy.sh/) support works similarly: the ntfy mobile app also has a websocket open to our server, and we push updates to it in its own format, at endpoints it expects.

## Dependencies / Links

* The service opens some network ports on localhost, which are expected to be used by [nginx](https://nginx.org/), which ultimately serves the traffic to the public. [nginx.conf](nginx.conf) has a basic configuration.
* [ribbit.sh](https://github.com/erorus/ribbit.sh) is expected to be running on this server. Symlink its `current` directory into this project's root, to read the git repository.
* [ribbit-watch.service](ribbit-watch.service) is a systemd service for running this as a daemon.
* Run [deets.sh](deets/deets.sh) via cron, a couple times every day.
  * This scans the ribbit Git repository to assemble the config paths for all Blizzard products, and then fetches that config info from Blizzard's servers.
  * Ultimately, this produces a semi-static JSON file as a reference for things like user-facing product names, encryption key names, etc.
  * This currently uses a PHP script as part of the process, sorry. It could be rewritten into JS so you wouldn't need PHP installed for this project, but PHP was quicker for me.

## Thanks

Thanks to the WoW datamining community for inspiring this project, especially [better-algalon](https://github.com/Ghostopheles/better-algalon).

Click here to support my WoW projects: [![Become a Patron!](https://everynothing.net/patronButton.png)](https://www.patreon.com/bePatron?u=4445407)

## License

Copyright 2026 Gerard Dombroski

Licensed under the Apache License, Version 2.0 (the "License");
you may not use these files except in compliance with the License.
You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
