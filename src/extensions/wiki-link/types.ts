import type { Data, Literal } from 'mdast';

/**
 * mdast node for a wiki-style link like [[target]] or [[target|alias]].
 */
export interface WikiLink extends Literal {
  type: 'wikiLink';
  value: string;
  data: Data & {
    alias: string | null;
  };
}

declare module 'mdast' {
  interface RootContentMap {
    wikiLink: WikiLink;
  }

  interface PhrasingContentMap {
    wikiLink: WikiLink;
  }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    wikiLink: 'wikiLink';
    wikiLinkMarker: 'wikiLinkMarker';
    wikiLinkData: 'wikiLinkData';
    wikiLinkTarget: 'wikiLinkTarget';
    wikiLinkAliasMarker: 'wikiLinkAliasMarker';
    wikiLinkAlias: 'wikiLinkAlias';
  }
}

declare module 'mdast-util-to-markdown' {
  interface ConstructNameMap {
    wikiLink: 'wikiLink';
  }
}
