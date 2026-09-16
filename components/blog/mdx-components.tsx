import { Figure } from "./Figure";
import { Stats, Takeaways } from "./Stats";
import * as Ill from "./illustrations";

/** Components available inside blog MDX. */
export const mdxComponents = { Figure, Stats, Takeaways, ...Ill };
