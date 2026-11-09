// Romslig's AI features, environment-neutral: every entry point takes an Anthropic client, so the
// browser (own key, or the server-mode proxy) and, later, the server can run the same code.
export { AiError, MODEL, explainAiError } from './client.ts'
export { AssistantRequest, runAssistant } from './assistant.ts'
export { RecognizeRequest, buildDescription, recognizeFurniture } from './recognize.ts'
export {
  DIGITIZE_MAX_EDGE,
  digitizePlan,
  digitizeScale,
  toSuggestion,
  type DigitizeRequest,
  type PlanImageInput,
} from './digitize.ts'
export { Workspace, catalogText } from './workspace.ts'
export { buildTools } from './tools.ts'
