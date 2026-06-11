import dagre from "dagre";
import type { FlowSpec, LayoutResult, PositionedNode } from "./flow.js";
import { defaultStyleProfile, getStyleProfile, styleForNodeType, type DiagramStyleId, type StyleProfile } from "./styleProfile.js";

function edgeAnchor(from: PositionedNode, to: PositionedNode) {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      start: { x: dx >= 0 ? from.x + from.width : from.x, y: fromCenter.y },
      end: { x: dx >= 0 ? to.x : to.x + to.width, y: toCenter.y }
    };
  }

  return {
    start: { x: fromCenter.x, y: dy >= 0 ? from.y + from.height : from.y },
    end: { x: toCenter.x, y: dy >= 0 ? to.y : to.y + to.height }
  };
}

function edgePoints(from: PositionedNode, to: PositionedNode): Array<{ x: number; y: number }> {
  const { start, end } = edgeAnchor(from, to);

  if (Math.abs(start.x - end.x) < 8) return [start, end];
  if (Math.abs(start.y - end.y) < 8) return [start, end];

  const midY = start.y + (end.y - start.y) / 2;
  return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
}

export function layoutFlow(flow: FlowSpec, styleId?: DiagramStyleId): LayoutResult {
  const profile: StyleProfile = getStyleProfile(styleId);
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "TB",
    ranksep: profile.spacing.rankSep,
    nodesep: profile.spacing.nodeSep,
    marginx: profile.spacing.marginX,
    marginy: profile.spacing.marginY
  });

  for (const node of flow.nodes) {
    const style = styleForNodeType(node.type, profile);
    graph.setNode(node.id, {
      width: style.width,
      height: style.height
    });
  }

  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  for (const edge of flow.edges) {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) graph.setEdge(edge.from, edge.to);
  }

  dagre.layout(graph);

  const nodes: PositionedNode[] = flow.nodes.map((node) => {
    const graphNode = graph.node(node.id);
    const style = styleForNodeType(node.type, profile);
    const width = graphNode?.width ?? style.width;
    const height = graphNode?.height ?? style.height;
    return {
      ...node,
      width,
      height,
      x: Math.round((graphNode?.x ?? width / 2) - width / 2),
      y: Math.round((graphNode?.y ?? height / 2) - height / 2)
    };
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = flow.edges
    .filter((edge) => byId.has(edge.from) && byId.has(edge.to))
    .map((edge) => ({
      ...edge,
      points: edgePoints(byId.get(edge.from)!, byId.get(edge.to)!)
    }));

  const right = Math.max(...nodes.map((node) => node.x + node.width), profile.spacing.marginX * 2);
  const bottom = Math.max(...nodes.map((node) => node.y + node.height), profile.spacing.marginY * 2);

  return {
    width: Math.ceil(right + profile.spacing.marginX),
    height: Math.ceil(bottom + profile.spacing.marginY),
    nodes,
    edges
  };
}
