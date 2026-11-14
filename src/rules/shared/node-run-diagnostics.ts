/** Keep remediation text stable so script-specific details do not split report groups. */
export const nodeRunRemediation = {
  suggestion:
    "Replace npm run with node --run for simple package-script execution when no npm-specific behavior is needed.",
  measurementHint:
    "Compare the step duration before and after the change, and verify that the script still receives the same arguments and environment it needs.",
};
