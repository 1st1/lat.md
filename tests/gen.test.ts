import { describe, expect, it } from 'vitest';
import { readOpenCodePluginTemplate, readSkillTemplate } from '../src/cli/gen.js';

describe('gen', () => {
  // @lat: [[tests/gen#OpenCode plugin template exposes get-source tool]]
  it('renders the OpenCode plugin template with the get-source tool', () => {
    const template = readOpenCodePluginTemplate();
    expect(template).toContain('lat_get_source');
    expect(template).toContain("tryRun(['get-source', args.externalSource])");
  });

  // @lat: [[tests/gen#Skill template teaches external source lookup]]
  it('renders the skill template with external-source lookup guidance', () => {
    const template = readSkillTemplate();
    expect(template).toContain('lat_get_source');
    expect(template).toContain('read <handle> for <stuff>');
  });
});
