/** Process-wide readiness. SIGTERM clears it before the server socket closes. */
export const lifecycle = {
  ready: false,
};
