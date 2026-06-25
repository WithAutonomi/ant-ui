export const ANVIL_CHAIN_ID = 31337
export const POLL_INTERVAL = 5000
export const DETAIL_POLL_INTERVAL = 30_000
export const PENDING_UPLOAD_TTL_MS = 300_000

/** Recommended minimum on-disk size per node, in bytes (20 GiB). This is a
 *  moving target that rises as the network grows — see the add-node warning
 *  and the node-page disk-usage bar. Nodes below this risk being shunned for
 *  being full. */
export const MIN_NODE_SIZE_BYTES = 20 * 1024 ** 3
