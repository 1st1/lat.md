# Docs

Repository path wiki links cover files, directories, and fragment boundaries.

## Valid paths

Existing targets: [[schema.sql]], [[CHANGELOG]], [[README.md]], [[assets]], [[assets/]], [[generated.ts]], [[.]], [[src/app.ts]], [[src\app.ts]], and [[src/app.ts#run]].

## Invalid paths

Missing targets: [[missing.sql]] and [[missing-dir/]].

Unsupported fragments: [[schema.sql#users]] and [[CHANGELOG#entry]].

Directory fragments: [[assets#entry]], [[assets.v1#entry]], and [[generated.ts#entry]].

Escaping the project root is invalid even when the sibling exists: [[../source-ref-ts-valid]].
