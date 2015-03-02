# blitz-loadtest
Configurable script to run load testing with blitz-io.

It has 2 execution modes:
  1. Produce a command to call blitz-io testing.
  `node index.js ./config`
  Will create a command for blitz to load test against 'iterations' number of
  tags and their parents.
  Output is written to stdout and can be piped to a file.
  2. Generate http calls to the app at specified intervals:
  `node index.js ./config 100`
  Will send a request every 100 ms, testing against 'iterations' number of
  tags and their parents.
  To view output run as:
  `DEBUG=loadtest node index.js ./config 100`
  To stop sending requests but keep waiting for responses hit the `s` key.

Tag groups are prepared by choosing a tag of the configured type at random and grouping it
with all its parent tags, so a set of 5 tags might look like:

```
[
  78060,
  77427,
  8782%2C8781%2C22%2C10,
  12494%2C8445%2C9011,
  5078%2C58%2C20%2C15
]
```
