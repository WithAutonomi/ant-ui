/** Recommended-minimum swatch/segment style — a TUI-style checkerboard dither
 *  (▒) that reads as a partially-filled threshold zone rather than an alert.
 *  Theme-aware via the `--disk-min-*` vars in assets/css/main.css. Shared by
 *  DiskUsageKey (the legend swatch) and DiskUsageBar (the reserve segment) so
 *  the two stay in visual sync. */
export const DISK_MIN_DITHER = {
  backgroundColor: 'var(--disk-min-base)',
  backgroundImage:
    'linear-gradient(45deg, var(--disk-min-cell) 25%, transparent 25%, transparent 75%, var(--disk-min-cell) 75%), ' +
    'linear-gradient(45deg, var(--disk-min-cell) 25%, transparent 25%, transparent 75%, var(--disk-min-cell) 75%)',
  backgroundSize: '4px 4px',
  backgroundPosition: '0 0, 2px 2px',
}
