import { getCorrectionRatio } from 'sigma/utils';

export type GraphViewport = {
  width: number;
  height: number;
  activeWidth: number;
};

type CameraState = { x: number; y: number; angle: number; ratio: number };

/** Preserve the view in the interaction pane when the drawing surface changes. */
export function graphViewportCamera(
  state: CameraState,
  from: GraphViewport,
  to: GraphViewport,
  graphDimensions: { width: number; height: number },
): CameraState {
  const scale = (width: number, height: number) =>
    Math.max(1, Math.min(width, height) - 80) *
    getCorrectionRatio({ width, height }, graphDimensions);
  const framing = (viewport: GraphViewport) => {
    const fullScale = scale(viewport.width, viewport.height);
    const activeScale = scale(viewport.activeWidth, viewport.height);
    return {
      ratio: fullScale / activeScale,
      offset: (viewport.width - viewport.activeWidth) / (2 * activeScale),
    };
  };
  const before = framing(from);
  const after = framing(to);
  const zoom = state.ratio / before.ratio;
  const offset = (after.offset - before.offset) * zoom;
  return {
    ...state,
    x: state.x + offset * Math.cos(state.angle),
    y: state.y + offset * Math.sin(state.angle),
    ratio: after.ratio * zoom,
  };
}

export function graphFitCamera(
  viewport: GraphViewport,
  graphDimensions: { width: number; height: number },
): CameraState {
  return graphViewportCamera(
    { x: 0.5, y: 0.5, angle: 0, ratio: 1 },
    { ...viewport, width: viewport.activeWidth },
    viewport,
    graphDimensions,
  );
}
