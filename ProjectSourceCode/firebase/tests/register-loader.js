// Lets Node run events.js unchanged in tests. Loaded with `node --import`.
import { register } from "node:module";

register("./loader.js", import.meta.url);
