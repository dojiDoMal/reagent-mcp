/**
 * Debug runtime bootstrap. Import this once from your app entry (e.g.
 * src/index.tsx). The entire body is behind a development guard so CRA/Webpack
 * eliminates it from the production build as dead code.
 */
import { store } from "./store";

if (process.env.NODE_ENV === "development") {
  // Dynamic import keeps the runtime module out of the production graph.
  import("react-debug-mcp/react")
    .then(({ initDebugRuntime }) => {
      initDebugRuntime({
        adapters: {
          redux: { store },
          storage: {
            // Only these keys are readable by the agent.
            localStorage: ["feature-flags", "ui-prefs"],
            sessionStorage: [],
          },
        },
      });
    })
    .catch((err) => {
      // Never let diagnostics break the app.
      console.warn("[react-debug-mcp] failed to init:", err);
    });
}
