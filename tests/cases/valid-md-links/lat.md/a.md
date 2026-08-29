# Alpha

Every link form that must resolve, and every form that must be skipped.

- [bare](b.md)
- [nested](./sub/c.md)
- [outside the graph](../outside.md)
- [anchored](b.md#bravo)
- [punctuation heading](b.md#hello-world)
- [duplicate heading](b.md#repeat-1)
- [with a query](b.md?raw=1)
- [encoded space](./has%20space.md)
- [reference][bravo]
- ![image](../logo.svg)

Skipped forms:

- [https](https://example.com/nope.md)
- [mailto](mailto:nobody@example.com)
- [windows drive](C:/nope.md)
- [protocol relative](//example.com/nope.md)
- [root absolute](/nope.md)
- [pure anchor](#alpha)
- [query only](?tab=1)

Code is not a link: `[fake](./nope.md)`

Escaped reference syntax is not a link: \[fake]\[missing]

Escaped shortcut brackets remain text: \[not-a-reference]

Defined shortcut reference: [bravo]

- [x] Checked task list item
- [ ] Unchecked task list item

Footnote syntax is not a shortcut reference.[^note]

[^note]: Footnote body with an escaped literal \[detail].

> [!NOTE]
> GitHub alert syntax is not a shortcut reference.

Math is not reference syntax: $[x]$.

HTML is not markdown link syntax: <span data-example="[fake][missing]">text</span>

Fenced code is not a link:

```markdown
[fake][missing]
```

[bravo]: ./b.md
