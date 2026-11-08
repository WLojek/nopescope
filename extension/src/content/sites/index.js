import x from "./x.js";
import youtube from "./youtube.js";
import reddit from "./reddit.js";
import google from "./google.js";
import generic from "./generic.js";

export const ADAPTERS = [x, youtube, reddit, google];

export function pickAdapter(location) {
  // dedicated adapters first; every other http(s) page uses the generic one
  return ADAPTERS.find((a) => a.matches(location)) || (generic.matches(location) ? generic : null);
}
