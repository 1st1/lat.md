# Alpha

Every link form that must resolve, and every form that must be skipped.

- [bare](b.md)
- [dot slash](./b.md)
- [nested](./sub/c.md)
- [outside the graph](../outside.md)
- [anchored](b.md#Bravo)
- [with a query](b.md?raw=1)
- [encoded space](./has%20space.md)
- ![image](../logo.svg)

Skipped forms:

- [https](https://example.com/nope.md)
- [mailto](mailto:nobody@example.com)
- [protocol relative](//example.com/nope.md)
- [root absolute](/nope.md)
- [pure anchor](#alpha)
- [query only](?tab=1)

Code is not a link: `[fake](./nope.md)`
