class EZPZ_BBCode_Parser {
  #rules = [];
  #forbiddenRules = [];
  #lineBreakTemplate = null;

  #textWrapTags = {
    inline: ["b", "i", "s", "u", "link", "c", "spoiler", "img", "size", "color"],
    recursive: ["box", "quote", "notice", "centre", "spoilerbox"],
  };

  constructor(templateRules = []) {
    if (!Array.isArray(templateRules)) {
      throw new TypeError("templateRules must be an array.");
    }

    this.setRules(templateRules);
  }

  // Setter

  set lineBreakTemplate(fn) {
    if (typeof fn !== "function") {
      throw new TypeError("lineBreakTemplate must be a function.");
    }
    this.#lineBreakTemplate = fn;
  }

  set textWrapTags(obj) {
    if (typeof obj !== "object" || !Array.isArray(obj.inline) || !Array.isArray(obj.recursive)) {
      throw new TypeError("textWrapTags must be an object with 'inline' and 'recursive' arrays.");
    }
    this.#textWrapTags.inline = obj.inline;
    this.#textWrapTags.recursive = obj.recursive;
  }

  // Public Method

  addRule(rule) {
    if (!rule || typeof rule !== "object") {
      throw new TypeError("addRule expects a rule object.");
    }
    this.#rules.push(this.#validateRule(rule));
  }

  setRules(templateRules) {
    if (!Array.isArray(templateRules)) {
      throw new TypeError("setRules expects an array of rule objects.");
    }

    this.#rules = templateRules.map((rule) => {
      if (!rule || typeof rule !== "object") {
        throw new TypeError("Each rule must be an object.");
      }
      return this.#validateRule(rule);
    });
  }

  parse(inputText, options = { wrapText: false, strictUnknownTag: true, strictClosingTag: false }) {
    if (typeof inputText !== "string") {
      throw new TypeError("parse() expects the first argument to be a string.");
    }

    if (typeof options !== "object" || options === null) {
      options = {};
    }

    const { wrapText = false, strictUnknownTag = true, strictClosingTag = false } = options;

    let raw = inputText;
    if (wrapText) raw = this.#wrapNodeText(raw);

    const errors = [];

    const tokens = this.#tokenize(raw);
    const tree = this.#buildTree(tokens, errors, strictClosingTag);

    const output = this.#renderNode(tree, { errors }, strictUnknownTag, strictClosingTag);

    return { output, errors, tokens, tree, raw };
  }

  forbidden(registerFn) {
    if (typeof registerFn !== "function") {
      throw new TypeError("forbidden() expects a function.");
    }

    const rules = [];
    const check = (fn, msg = "This is forbidden.") => {
      if (typeof fn !== "function") {
        throw new TypeError("Forbidden check function must be a function.");
      }

      const rule = { fn, msg, handler: null };
      const then = (handlerFn) => {
        if (typeof handlerFn !== "function") {
          throw new TypeError("Forbidden 'then' handler must be a function.");
        }
        rule.handler = handlerFn;
        return undefined;
      };

      rules.push(rule);
      return { then };
    };

    registerFn(check);
    this.#forbiddenRules.push(...rules);
  }

  // Private Parser Methods

  #checkForbidden(api) {
    const messages = [];
    let override = null;
    for (const { fn, msg, handler } of this.#forbiddenRules) {
      if (fn(api)) {
        messages.push({
          errorType: "forbidden",
          message: msg,
          ...api,
        });
        if (typeof handler === "function") {
          const result = handler(api);
          if (result !== undefined && override === null) {
            override = result;
          }
        }
      }
    }
    return { messages, override };
  }

  #tokenize(input) {
    const tokens = [];
    let pos = 0;

    const readTag = () => {
      if (input[pos] !== "[") return null;
      let i = pos + 1;
      let tagName = "",
        tagValue = "";
      let isClosing = false,
        inValue = false,
        bracketDepth = 0;
      const startPos = pos;

      if (input[i] === "/") {
        isClosing = true;
        i++;
      }

      if (!isClosing && input[i] === "*") {
        i++;
        if (input[i] === "]") {
          const raw = input.slice(pos, i + 1);
          const endPos = i + 1;
          pos = endPos;
          return {
            type: "tag-open",
            name: "*",
            value: null,
            raw,
            position: { start: startPos, end: endPos },
          };
        }
      }

      while (i < input.length) {
        const char = input[i];
        if (!inValue && char === "=") {
          inValue = true;
          i++;
          continue;
        }

        if (char === "[" && inValue) bracketDepth++;
        if (char === "]") {
          if (bracketDepth > 0) {
            bracketDepth--;
          } else {
            break;
          }
        }

        if (!inValue) tagName += char;
        else tagValue += char;
        i++;
      }

      if (input[i] !== "]") return null;

      const full = input.slice(pos, i + 1);
      const endPos = i + 1;
      pos = endPos;

      return {
        type: isClosing ? "tag-close" : "tag-open",
        name: tagName.trim().toLowerCase(),
        value: inValue ? tagValue.trim() : null,
        raw: full,
        position: { start: startPos, end: endPos },
      };
    };

    while (pos < input.length) {
      if (input[pos] === "[") {
        const tag = readTag();
        if (tag) {
          tokens.push(tag);
          continue;
        } else {
          tokens.push({
            type: "text",
            content: "[",
            position: { start: pos, end: pos + 1 },
          });
          pos += 1;
          continue;
        }
      }

      let next = input.indexOf("[", pos);
      if (next === -1) next = input.length;

      tokens.push({
        type: "text",
        content: input.slice(pos, next),
        position: { start: pos, end: next },
      });
      pos = next;
    }

    return tokens;
  }

  #buildTree(tokens, errors = [], strictClosingTag = false) {
    const root = { type: "root", children: [] };
    const stack = [{ node: root, token: null }];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const current = stack[stack.length - 1].node;

      if (token.type === "text") {
        current.children.push({ type: "text", content: token.content, position: token.position });
      } else if (token.type === "tag-open") {
        if (token.name === "*") {
          const node = {
            type: "tag",
            name: "*",
            value: null,
            children: [],
            position: token.position,
          };
          i++;
          while (
            i < tokens.length &&
            !(tokens[i].type === "tag-open" && (tokens[i].name === "*" || tokens[i].name === "list")) &&
            !(tokens[i].type === "tag-close" && tokens[i].name === "list")
          ) {
            node.children.push(tokens[i]);
            i++;
          }
          i--;
          current.children.push(node);
        } else {
          const node = {
            type: "tag",
            name: token.name,
            value: token.value,
            children: [],
            position: token.position,
            closingPosition: null,
          };
          current.children.push(node);
          stack.push({ node, token });
        }
      } else if (token.type === "tag-close") {
        if (!strictClosingTag) {
          let matchedIndex = -1;
          for (let j = stack.length - 1; j >= 1; j--) {
            if (stack[j].node.name === token.name) {
              matchedIndex = j;
              break;
            }
          }

          if (matchedIndex !== -1) {
            const matched = stack[matchedIndex];
            matched.node.closingPosition = token.position;

            stack.splice(matchedIndex);
          } else {
            current.children.push({
              type: "text",
              content: `[/${token.name}]`,
              position: token.position,
            });

            errors?.push({
              errorType: "unexpected-closing",
              node: {
                current: {
                  children: null,
                  closingPosition: null,
                  name: token.name,
                  position: token.position,
                  type: "tag",
                  value: null,
                },
              },
              pointer: null,
            });
          }
        } else {
          const top = stack[stack.length - 1];
          if (stack.length > 1 && top.node.name === token.name) {
            top.node.closingPosition = token.position;
            stack.pop();
          } else {
            current.children.push({
              type: "text",
              content: `[/${token.name}]`,
              position: token.position,
            });

            errors?.push({
              errorType: "unexpected-closing",
              node: {
                current: {
                  children: null,
                  closingPosition: null,
                  name: token.name,
                  position: token.position,
                  type: "tag",
                  value: null,
                },
              },
              pointer: null,
            });
          }
        }
      }
    }

    if (strictClosingTag) {
      for (let i = stack.length - 1; i >= 1; i--) {
        const { node } = stack[i];

        const parent = stack[i - 1].node;
        const index = parent.children.indexOf(node);
        if (index !== -1) {
          const rawTag =
            `[${node.name}${node.value ? "=" + node.value : ""}]` +
            node.children
              .map((child) => {
                if (child.type === "text") return child.content;
                return this.#renderNode(child, {}, true, false); // Render child sebagai text
              })
              .join("");
          parent.children[index] = {
            type: "text",
            content: rawTag,
            position: node.position,
          };
        }

        errors?.push({
          errorType: "unclosed-tag",
          node: {
            current: node,
            parent: null,
            root: null,
            next: null,
            previous: null,
          },
          pointer: null,
        });
      }
    }

    return root;
  }

  #renderNode(node, context = {}, strictUnknownTag = true, strictClosingTag = false) {
    if (node.type === "text") {
      if (typeof this.#lineBreakTemplate === "function") {
        const position = {
          index: context.index ?? 0,
          path: context.path ?? "0",
          depth: (context.path ?? "0").split(".").length - 1,
        };

        let lines = node.content.split("\n");

        const isAllNewlines = lines.every((l) => l.trim() === "");

        if (isAllNewlines && lines.length > 1) {
          lines.pop();
        }

        const api = {
          node: {
            current: node,
            parent: context.parent ?? null,
            root: context.root ?? node,
            next: context.root?.children?.[context.index + 1] ?? null,
            previous: context.root?.children?.[context.index - 1] ?? null,
          },
          pointer: position,
        };

        return lines
          .map((line, index) => {
            if (index < lines.length - 1) {
              return line + this.#lineBreakTemplate(api);
            }

            return line;
          })
          .join("");
      }
      return node.content;
    }

    if (node.type === "tag") {
      const rule = this.#rules.find((r) => r.name === node.name);

      const inner = node.children.map((child) => this.#renderNode(child, context)).join("");
      const attr = node.value ? "=" + node.value : "";

      if (!rule) {
        if (strictUnknownTag === true) {
          const position = {
            index: context.index ?? 0,
            depth: (context.path ?? "0").split(".").length - 1,
            path: context.path ?? "0",
          };
          context.errors?.push({
            errorType: "unknown-tag",
            node: {
              current: node,
              parent: context.parent ?? null,
              root: context.root ?? node,
              next: context.root?.children?.[context.index + 1] ?? null,
              previous: context.root?.children?.[context.index - 1] ?? null,
            },
            pointer: position,
          });

          return inner;
        }

        return `[${node.name}${attr}]${inner}${node.closingPosition ? `[/${node.name}]` : ""}`;
      }

      const innerHTML = node.children
        .map((c, i) =>
          this.#renderNode(c, {
            ...context,
            index: i,
            path: (context.path ?? "") + "." + i,
            parent: node,
          })
        )
        .join("");

      const position = {
        index: context.index ?? 0,
        path: context.path ?? "0",
        depth: (context.path ?? "0").split(".").length - 1,
      };

      const api = {
        node: {
          current: node,
          parent: context.parent ?? null,
          root: context.root ?? node,
          next: context.root?.children?.[context.index + 1] ?? null,
          previous: context.root?.children?.[context.index - 1] ?? null,
        },
        pointer: position,
      };

      const { messages, override } = this.#checkForbidden(api);
      if (messages.length > 0) {
        context.errors?.push(...messages);
        return override ?? "";
      }

      const variables = {};
      for (let varName of rule.attrNames) {
        const parsedAttr = this.parse(node.value ?? "").output;
        variables[varName] = parsedAttr;
      }

      for (let varName of rule.contentNames) {
        variables[varName] = innerHTML.trim();
      }

      if (typeof rule.render === "function") {
        return rule.render({
          node: {
            current: node,
            parent: context.parent ?? null,
            root: context.root ?? node,
            next: context.root?.children?.[context.index + 1] ?? null,
            previous: context.root?.children?.[context.index - 1] ?? null,
          },
          pointer: position,
          variables,
        });
      }

      let renderedHtml = rule.render;
      for (let varName of rule.fullVars) {
        const val = variables[varName] ?? "";
        const regex = new RegExp(`\\$${varName}`, "g");
        renderedHtml = renderedHtml.replace(regex, val);
      }

      return renderedHtml;
    }

    if (node.type === "root") {
      return node.children
        .map((c, i) =>
          this.#renderNode(
            c,
            {
              index: i,
              path: `${i}`,
              parent: null,
              root: node,
              errors: context.errors ?? [],
            },
            strictUnknownTag,
            strictClosingTag
          )
        )
        .join("");
    }

    return "";
  }

  // Helper Methods

  #validateRule(rule) {
    const tagMatch = rule.template.match(/^\[([a-z0-9*]+)(.*?)\](.*?)$/i);
    if (!tagMatch) throw new Error("Invalid template format");

    const name = rule.name || tagMatch[1].toLowerCase();
    const attrPart = tagMatch[2];
    const contentPart = tagMatch[3];

    const attrNames = [...attrPart.matchAll(/\$([a-zA-Z0-9_]+)/g)].map((m) => m[1]);
    const contentNames = [...contentPart.matchAll(/\$([a-zA-Z0-9_]+)/g)].map((m) => m[1]);

    return {
      name,
      render: rule.render,
      attrNames,
      contentNames,
      fullVars: [...new Set([...attrNames, ...contentNames])],
    };
  }

  #wrapNodeText(inputText) {
    const INLINE_TAGS = this.#textWrapTags.inline;
    const RECURSIVE_BLOCK_TAGS = this.#textWrapTags.recursive;

    const NEWLINE = "<<<NEWLINE>>>";
    inputText = inputText.replace(/\r?\n/g, NEWLINE);

    const blockTagRegex = new RegExp(`\\[(${RECURSIVE_BLOCK_TAGS.join("|")})(=([^\\[\\]]|\\[[^\\[\\]]*\\])*)?\\]([\\s\\S]*?)\\[\\/\\1\\]`, "gi");

    inputText = inputText.replace(blockTagRegex, (_, tag, attr = "", __, content) => {
      const inner = this.#wrapNodeText(content.replaceAll(NEWLINE, "\n"), INLINE_TAGS, RECURSIVE_BLOCK_TAGS);
      return `[${tag}${attr}]${inner}[/${tag}]`;
    });

    const isInlineOnly = (line) => {
      if (!line.trim() || /^\s*\[\*\]/.test(line)) return false;
      const tags = [...line.matchAll(/\[\/?([a-zA-Z0-9*]+)[^\]]*\]/g)].map((m) => m[1].toLowerCase());
      return tags.every((t) => INLINE_TAGS.includes(t) || t === "text");
    };

    const lines = inputText.split(NEWLINE);
    const wrappedLines = [];
    let buffer = [];
    let tagBuffer = null;
    let insideBlock = false;

    const flush = () => {
      if (buffer.length) {
        const joined = buffer.join(NEWLINE);
        wrappedLines.push(insideBlock || joined.startsWith("[text]") ? joined : `[text]${joined}[/text]`);
        buffer = [];
      }
    };

    const openTagRegex = new RegExp(`^\\[(${RECURSIVE_BLOCK_TAGS.join("|")})(=.*)?$`, "i");
    const closeTagRegex = new RegExp(`^\\[\\/(${RECURSIVE_BLOCK_TAGS.join("|")})\\]$`, "i");

    for (let line of lines) {
      const trimmed = line.trim();

      if (tagBuffer) {
        tagBuffer += NEWLINE + line;
        if (trimmed.endsWith("]")) {
          flush();
          wrappedLines.push(tagBuffer);
          insideBlock = true;
          tagBuffer = null;
        }
        continue;
      }

      if (openTagRegex.test(trimmed) && !trimmed.endsWith("]")) {
        tagBuffer = line;
      } else if (openTagRegex.test(trimmed)) {
        flush();
        wrappedLines.push(line);
        insideBlock = true;
      } else if (closeTagRegex.test(trimmed)) {
        flush();
        wrappedLines.push(line);
        insideBlock = false;
      } else if (trimmed === "") {
        flush();
        wrappedLines.push("");
      } else if (!insideBlock && isInlineOnly(trimmed)) {
        buffer.push(line);
      } else {
        flush();
        wrappedLines.push(line);
      }
    }

    flush();
    return wrappedLines.join(NEWLINE).replaceAll(NEWLINE, "\n");
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = EZPZ_BBCode_Parser;
} else {
  window.EZPZ_BBCode_Parser = EZPZ_BBCode_Parser;
}
