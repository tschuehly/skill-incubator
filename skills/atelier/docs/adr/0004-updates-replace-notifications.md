# Updates replace notifications

The kernel had a separate `/api/notify` endpoint whose only purpose was to raise a desktop popup,
so the agent chose how loudly to interrupt by picking an endpoint. Desktop notification is now a
*delivery choice made by the page*: the agent posts a durable **Update** anchored to a Region, and
a single human-owned toggle decides whether Updates and Readys also raise a desktop notification.

## Consequences

- `/api/notify` is deleted. Nothing the agent sends is transient; every message it raises survives
  a page reload and is dismissed deliberately.
- The agent cannot escalate its own message past the human's preference, because loudness is no
  longer encoded in the call it makes.
- An Update that needs an answer is a modelling error — that is a Proposal.
