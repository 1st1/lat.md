import { NodeCircleProgram } from 'sigma/rendering';

/** Keep overlapping circles distinct without changing Sigma's geometry or picking. */
export class GraphNodeProgram<
  N extends Record<string, unknown>,
  E extends Record<string, unknown>,
> extends NodeCircleProgram<N, E> {
  protected fillOpacity(): number {
    return 0.8;
  }

  getDefinition() {
    return {
      ...super.getDefinition(),
      FRAGMENT_SHADER_SOURCE: `
precision highp float;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
uniform float u_correctionRatio;

void main(void) {
  float inset = v_radius - length(v_diffVector);
  if (inset < 0.0) discard;

  #ifdef PICKING_MODE
  // Picking IDs must remain opaque and unmodified, including at the border.
  gl_FragColor = v_color;
  #else
  // Sigma's circle geometry uses two correction units per CSS pixel.
  float pixels = inset / (2.0 * u_correctionRatio);
  float coverage = smoothstep(0.0, 0.5, pixels);
  float fill = smoothstep(1.0, 1.5, pixels);
  vec3 color = mix(v_color.rgb * 0.45, v_color.rgb, fill);
  float alpha = mix(0.95, ${this.fillOpacity()}, fill) * v_color.a * coverage;
  // Sigma blends with ONE / ONE_MINUS_SRC_ALPHA: premultiply RGB as well.
  gl_FragColor = vec4(color * alpha, alpha);
  #endif
}
`,
    };
  }
}

/** Stronger fill preserves the selected node's hue in either theme. */
export class GraphSelectedNodeProgram<
  N extends Record<string, unknown>,
  E extends Record<string, unknown>,
> extends GraphNodeProgram<N, E> {
  protected fillOpacity(): number {
    return 0.96;
  }
}
