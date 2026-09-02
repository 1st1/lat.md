# Getting started

Install Lat, initialize a repository, and create a small graph that agents can navigate and maintain.

## Install

Lat requires Node.js 22 or newer and installs as the `lat` command.

```bash
npm install -g lat.md
```

## Initialize

Run the interactive setup at the root of a project.

```bash
lat init
```

Lat creates `lat.md/`, configures selected coding agents, and sets up offline semantic search by default. Generated instructions teach agents to search before work, update knowledge when behavior changes, and run `lat check` before finishing.

## Write the graph

Each Markdown heading is an addressable section; short opening paragraphs make those sections useful in search and agent context.

```md
# Authentication

Requests use short-lived access tokens and rotating refresh tokens.

## Refresh rotation

Every successful refresh invalidates the previous token family member.
```

Connect sections with `[[auth#Refresh rotation]]`, source symbols with `[[src/auth.ts#rotateToken]]`, and implementation back to knowledge with `// @lat: [[auth#Refresh rotation]]`.

## Use the loop

Search before changing code, inspect the relevant section, update knowledge with behavior, then validate the whole graph.

```bash
lat search "how do refresh tokens work?"
lat section "auth#Refresh rotation"
lat check
```

Continue with [[concepts]] or keep [[commands]] nearby as a compact reference.
