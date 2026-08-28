---
lat:
  require-code-mention: true
title: Roundtrip Fixture
---

# Heading 1

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6

A simple paragraph with plain text.

A paragraph with *emphasis* and **strong** and ***strong emphasis*** inline.

A paragraph with ~~obsolete guidance~~ struck out.

A paragraph with `inline code` and a [link](https://example.com) and an [aliased link](https://example.com "Link Title").

![alt text](image.png)

> A blockquote paragraph.
>
> Second paragraph in the blockquote.

> Nested blockquote:
>
> > Inner quote.

* Item one

* Item two

* Item three

* Nested list:
  * Sub-item A
  * Sub-item B

* Back to top level

1. First ordered

2. Second ordered

3. Third ordered

4. Ordered with sub-list:
   * Unordered child
   * Another child

5. Back to ordered

***

A paragraph with a line break\
continued on the next line.

```js
function hello() {
  return 'world';
}
```

```
plain code block without language
```

```
indented code block line one
indented code block line two
```

A paragraph with [[wiki link target]] in it.

A paragraph with [[wiki link target|aliased wiki link]] in it.

Multiple wiki links: [[Page A]] and [[Page B#Section]] together.

Link to a file with heading: [[foo#Foo#bar]] deep section ref.

Link with directory path: [[foo/bar#Bar#baz]] and [[guides/setup#Setup#Install]].

Aliased section link: [[foo#Foo#bar|see the bar section]] for details.

Aliased path link: [[foo/bar#Bar#baz|baz docs]] is here.

File-only link: [[some-file]] with no heading.

File with single heading: [[notes#First Topic]] is common.

Deep nesting: [[project/src/utils#Utils#Helpers#Format Date]] goes four levels.

Inline elements mixed: **bold with [[wiki link]]** and *italic with `code`*.

A paragraph with special characters: \*not emphasis\* and \[not a link].

[Reference-style link][ref1]

[ref1]: https://example.com

A paragraph with an ![inline image](img.png "Image Title") in the middle.

* List with [[wiki link]] inside
* Another item with `code` and **bold**

> Blockquote with [[wiki link]] and *emphasis*.

| Feature     | Rendering                        |
| ----------- | -------------------------------- |
| Tables      | Semantic HTML with `inline code` |
| Wide tables | Horizontal scrolling             |

## Final Section

The end.
