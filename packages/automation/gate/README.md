# @deepseek-ai/dsh-automation-gate

Generic contract for monitoring an external pipeline gate and diffing its item snapshots into events. Consumers: the automation-router daemon; future universal plugins implement the same seam.

## Model

- `GateItem` - one tracked item: id, sourceLane, title, state (`queued | testing | passed | rejected | approved | unmapped`), optional detail.
- `PipelineGateAdapter` - a source read face: `listItems()`.
- `WakeTargetResolver` - optional addressing face: lane to session id, null when unknown.
- `diffGateSnapshots(previous, current)` - pure snapshot diff emitting `item-submitted` / `item-state-changed`; duplicate ids throw.

Adapters map foreign statuses explicitly; unknown statuses land on `unmapped` so routing never guesses.

## Known Limitations and Deferred Work

- No transport here: delivery is the router package concern.
