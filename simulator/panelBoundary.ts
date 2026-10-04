import * as THREE from 'three';
import type { SphericalPanelGroup } from './panelPartition';

export type PanelBoundaryEdge = Readonly<{
  start: THREE.Vector3;
  end: THREE.Vector3;
}>;

const EDGE_KEY_DIGITS = 5;

function pointKey(point: THREE.Vector3): string {
  return `${point.x.toFixed(EDGE_KEY_DIGITS)}:${point.y.toFixed(EDGE_KEY_DIGITS)}:${point.z.toFixed(EDGE_KEY_DIGITS)}`;
}

export function collectPanelBoundaryEdges(
  panels: readonly SphericalPanelGroup[],
): PanelBoundaryEdge[] {
  const edges = new Map<string, {
    edge: PanelBoundaryEdge;
    incidents: number;
    panelIds: Set<string>;
  }>();
  for (const panel of panels) {
    for (const tile of panel.tiles) {
      const outline = tile.assemblyOutline.map(({ position }) => position);
      for (let index = 0; index < outline.length; index += 1) {
        const start = outline[index];
        const end = outline[(index + 1) % outline.length];
        const startKey = pointKey(start);
        const endKey = pointKey(end);
        const key = startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
        const existing = edges.get(key);
        if (existing) {
          existing.incidents += 1;
          existing.panelIds.add(panel.id);
        } else {
          edges.set(key, {
            edge: { start, end },
            incidents: 1,
            panelIds: new Set([panel.id]),
          });
        }
      }
    }
  }
  return [...edges.entries()]
    .filter(([, { incidents, panelIds }]) => incidents === 1 || panelIds.size > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, { edge }]) => edge);
}
