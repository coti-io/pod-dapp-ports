process.env.SABLIER_PAYROLL_TESTS = "1";

await import("./stories/01-deploy-wiring.stories.js");
await import("./stories/02-employer-setup.stories.js");
await import("./stories/03-employee-claim.stories.js");
await import("./stories/04-claim-failures.stories.js");
await import("./stories/05-admin-clawback.stories.js");
await import("./stories/06-extended-coverage.stories.js");
await import("./stories/07-missing-payment-gaps.stories.js");
await import("./stories/08-employee-move-funds.stories.js");
