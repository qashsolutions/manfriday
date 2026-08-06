import Anthropic from "@anthropic-ai/sdk";

/** Client construction lives behind this factory so tests can substitute a fake. */
export function anthropicClient(): Anthropic {
  return new Anthropic();
}
