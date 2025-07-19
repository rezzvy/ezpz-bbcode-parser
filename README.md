# EZPZ BBCode Parser

## Overview

A simple JavaScript library for parsing BBCode.

- Super easy to use: define your templates, parse the input, and done
- `forbidden()` method lets you control tag behavior
- Custom line break rendering
- Optional auto-wrapping for loose text
- Basic error validation built-in
- Full API access for advanced customization
- and more to explore

## How It Works

It takes your BBCode string, breaks it into tokens, builds a nested tree, checks for forbidden patterns, and then renders everything into clean HTML using your custom templates.

## Installation

Just include the script in your webpage using the CDN from jsDelivr:

```html
<script src="https://cdn.jsdelivr.net/gh/rezzvy/ezpz-bbcode-parser@latest/dist/ezpz-bbcode-parser.min.js"></script>
```

## Usage

### Create the parser and define your templates

Start by creating a new parser instance and passing in your custom BBCode rules:

```javascript
const parser = new EZPZ_BBCode_Parser([
  {
    template: "[b]$text[/b]",
    render: "<strong>$text</strong>",
  },
  {
    template: "[box=$title]$content[/box]",
    render: `
      <details>
        <summary>$title</summary>
        $content
      </details>
    `,
  },
]);
```

### Call the `parse()` method

Now parse your BBCode string:

```javascript
const raw = `  
[box=Show me]
  [b]You are awesome![/b]
[/box]`;

const parsed = parser.parse(raw);
console.log(parsed.output);
```

**Expected Output:**

```html
<details>
  <summary>Show me</summary>
  <strong>You are awesome!</strong>
</details>
```

## Examples

### Restrict or override specific tags

Use `forbidden()` to block tags or replace them with fallback HTML:

```javascript
parser.forbidden((check) => {
  // Block [spoiler] completely
  check((api) => api.node.current.name === "spoiler", "Oops! You can't use [spoiler]");

  // Block [b] inside [box]
  check((api) => api.node.current.name === "b" && api.node.parent?.name === "box", "[b] is not allowed inside [box]").then(() => {
    return `<span class='error'>Oops! Not allowed!</span>`;
  });
});
```

### Custom newline handling

Customize how line breaks (`\n`) are rendered using `lineBreakTemplate`:

```javascript
parser.lineBreakTemplate = (api) => {
  if (api.node.previous?.name === "b") {
    return "<br class='after-bold'>";
  }
  return "<br>";
};
```

## Documentation

### Placeholder Variables

In your `template` and `render` definitions, you can use placeholders like `$content`, `$text`, or `$title`. The parser will automatically extract and fill in these variables during rendering.

### String-based rendering

```js
{
  template: "[box=$title]$content[/box]",
  render: "<div><h3>$title</h3><p>$content</p></div>"
}
```

### Function-based rendering

```js
{
  template: "[box=$title]$content[/box]",
  render: ({ variables }) => {
    return `<div class="box"><h4>${variables.title}</h4>${variables.content}</div>`;
  }
}
```

Placeholders must start with `$` and be exactly the same in both `template` and `render`.

### Public Methods

#### `addRule(rule)`

Add a new BBCode rule.

```js
parser.addRule({
  template: "[b]$content[/b]",
  render: "<strong>$content</strong>",
});
```

#### `setRules(rules)`

Replace all BBCode rules at once.

- `rules`: Array of rule objects

#### `parse()` Method

```js
parse(inputText, (options = { wrapText: false, strictUnknownTag: true, strictClosingTag: false }));
```

Parse BBCode input into HTML and metadata.

- `inputText`: `string` — Raw BBCode input
- `wrapText`: `boolean` — Automatically wrap loose text in `[text]...[/text]`
- `strictUnknownTag`: `boolean` — Strict mode for unknown tags
- `strictClosingTag`: `boolean` — Strict mode for closing tags

Returns:

```js
{
  output: "<rendered html>",
  errors: [ /* error objects */ ],
  tokens: [ /* token list */ ],
  tree: { /* parsed AST */ },
  raw: ""
}
```

##### Strict Mode Options

##### `strictUnknownTag`

- **true**: Unknown tags will be **excluded** from output.

  - If the tag contains only text or known inner tags → the content is rendered.
  - If it contains unknown inner tags → it’s removed and an `unknown-tag` error is reported.

- **false**: Unknown tags are treated as **plain text**, and no error is added.

Example:

```js
const result = parser.parse("[weird]hello[/weird]", { strictUnknownTag: true });
console.log(result.errors); // Contains error for unknown tag
```

#### `strictClosingTag`

- **true**: If a tag is opened but never closed (including any of its nested children), the entire tag including all its contents will be treated as **plain text**.  
  An `unclosed-tag` error will be added to the `errors` array.

- **false**: If a tag is opened but not closed, it will be **automatically closed** at the end of the input or before its parent closes.  
  This allows malformed BBCode to still render as valid HTML.

##### Example 1 — `strictClosingTag: true`

```js
const result = parser.parse("[b]bold", { strictClosingTag: true });
console.log(result.output); // => "[b]bold"
```

> The `[b]` tag is unclosed, so it renders as plain text instead of bold text.

##### Example 2 — `strictClosingTag: false`

```js
const result = parser.parse("[b]bold", { strictClosingTag: false });
console.log(result.output); // => "<strong>bold</strong>"
```

> The `[b]` tag is auto-closed, and renders properly.

#### `forbidden(registerFn)`

Define logic to block or replace tags during rendering.

```js
parser.forbidden((check) => {
  check((api) => api.node.current.name === "img", "[img] is not allowed!");
  check((api) => api.node.current.name === "spoiler", "No spoilers!").then(() => `<span class="blocked">Spoiler blocked!</span>`);
});
```

### Configurable Setters

#### `lineBreakTemplate = (api) => {}`

Customize how newlines are rendered in the output:

```js
parser.lineBreakTemplate = (api) => {
  return api.node.parent?.name === "*" ? "\n" : "<br>";
};
```

#### `textWrapTags = { inline: [], recursive: [] }`

Control which tags are considered inline/block for text wrapping:

```js
parser.textWrapTags = {
  inline: ["b", "i", "u", "color", "link"],
  recursive: ["quote", "box"],
};
```

## Rule Object Structure

### String-based rule

```js
{
  name: "bold", // optional
  template: "[b]$content[/b]",
  render: "<strong>$content</strong>"
}
```

### Function-based rule

```js
{
  template: "[box=$title]$content[/box]",
  render: ({ variables }) => {
    return `<div class="box"><h4>${variables.title}</h4>${variables.content}</div>`;
  }
}
```

## API Object Format

The API object passed into `render()` and `forbidden()` includes:

```js
{
  node: {
    current,   // current tag or text node
    parent,    // parent node
    root,      // root node
    previous,  // previous sibling node
    next       // next sibling node
  },
  pointer: {
    index,     // index in current parent's children array
    path,      // dot path, e.g. "0.1.2"
    depth      // depth level in tree
  },
  variables // extracted values from tag attributes and content
}
```

## Node Object Structure

Each node inside the parsed tree has this structure:

### For tag nodes:

```js
{
  type: "tag",
  name: "b",
  value: null, // or a string from [tag=value]
  children: [ /* nested tag or text nodes */ ],
  position: {
    start: 12,
    end: 18
  },
  closingPosition: {
    start: 25,
    end: 29
  }
}
```

### For text nodes:

```js
{
  type: "text",
  content: "hello world",
  position: {
    start: 30,
    end: 42
  }
}
```

This tree allows full introspection and rendering control.

## Error Handling

### Types of Errors

| Type                 | Description                           |
| -------------------- | ------------------------------------- |
| `unexpected-closing` | Found a closing tag with no opener    |
| `unclosed-tag`       | Tag opened but never closed           |
| `unknown-tag`        | Tag not defined in rules              |
| `forbidden`          | Tag was blocked by `forbidden()` rule |

### Error Object

```js
{
  errorType: "unexpected-closing" | "unclosed-tag" | "unknown-tag" | "forbidden",
  message: "Only for forbidden errors",
  node: {
    current, parent, root, previous, next
  },
  pointer: {
    index, path, depth
  }
}
```

## Note

This parser isn't perfect yet. I'm still learning and plan to optimize it more in the future once I gain more coding knowledge.

## Contributing

There's always room for improvement. Feel free to contribute!

## License

The app is licensed under MIT License. Check the license file for more details.
