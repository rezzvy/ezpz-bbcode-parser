class EZPZ_BBCode_Parser {
  constructor(templateRules = []) {
    this.setRules(templateRules);
    this.forbiddenRules = [];

    this.lineBreakTemplate = null;
  }

  setRules(templateRules) {
    this.rules = templateRules.map((rule) => {
      const tagMatch = rule.template.match(/^\[([a-z0-9*]+)(.*?)\](.*?)$/i);
      if (!tagMatch) throw new Error("Invalid template format");

      const name = rule.name || tagMatch[1].toLowerCase();
      const attrPart = tagMatch[2];
      const contentPart = tagMatch[3];

      const attrNames = [...attrPart.matchAll(/\$([a-zA-Z0-9_]+)/g)].map((m) => m[1]);
      const contentNames = [...contentPart.matchAll(/\$([a-zA-Z0-9_]+)/g)].map((m) => m[1]);

      return {
        name,
        html: rule.html,
        api: rule.api ?? null,
        attrNames,
        contentNames,
        fullVars: [...new Set([...attrNames, ...contentNames])],
      };
    });
  }

  forbidden(registerFn) {
    const rules = [];
    const check = (fn, msg = "This is forbidden.") => {
      const rule = { fn, msg, handler: null };
      const then = (handlerFn) => {
        rule.handler = handlerFn;
        return undefined;
      };
      rules.push(rule);
      return { then };
    };
    registerFn(check);
    this.forbiddenRules.push(...rules);
  }

  checkForbidden(api) {
    const messages = [];
    let override = null;
    for (const { fn, msg, handler } of this.forbiddenRules) {
      if (fn(api)) {
        messages.push({
          message: msg,
          type: "forbidden",
          tag: api.node?.name,
          position: api.position ?? {},
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

  tokenize(input) {
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

  buildTree(tokens, errors = []) {
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
            message: `Unexpected closing tag: [/${token.name}]`,
            type: "unexpected-closing",
            tag: token.name,
            position: token.position,
          });
        }
      }
    }

    for (let i = stack.length - 1; i >= 1; i--) {
      const { node, token } = stack[i];
      errors?.push({
        message: `Unclosed tag: [${node.name}]`,
        type: "unclosed-tag",
        tag: node.name,
        position: token?.position ?? {},
      });
    }

    return root;
  }

  renderNode(node, context = {}) {
    if (node.type === "text") {
      if (typeof this.lineBreakTemplate === "function") {
        const position = {
          index: context.index ?? 0,
          path: context.path ?? "0",
          depth: (context.path ?? "0").split(".").length - 1,
        };

        const api = {
          node,
          parent: context.parent ?? null,
          root: context.root ?? node,
          position,
        };

        return node.content
          .split("\n")
          .map((line, index, arr) => {
            if (index < arr.length - 1) {
              return line + this.lineBreakTemplate(api);
            }
            return line;
          })
          .join("");
      }
      return node.content;
    }

    if (node.type === "tag") {
      const rule = this.rules.find((r) => r.name === node.name);

      if (!rule) {
        const position = {
          index: context.index ?? 0,
          depth: (context.path ?? "0").split(".").length - 1,
          path: context.path ?? "0",
        };
        context.errors?.push({
          message: `Unknown tag: [${node.name}]`,
          type: "unknown-tag",
          tag: node.name,
          position,
        });
        const inner = node.children.map((child) => this.renderNode(child, context)).join("");
        const attr = node.value ? "=" + node.value : "";
        return `[${node.name}${attr}]${inner}[/${node.name}]`;
      }

      const innerHTML = node.children
        .map((c, i) =>
          this.renderNode(c, {
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
        node,
        parent: context.parent ?? null,
        root: context.root ?? node,
        position,
      };

      const { messages, override } = this.checkForbidden(api);
      if (messages.length > 0) {
        context.errors?.push(...messages);
        return override ?? "";
      }

      const variables = {};
      for (let varName of rule.attrNames) {
        variables[varName] = node.value ?? "";
      }

      for (let varName of rule.contentNames) {
        variables[varName] = innerHTML.trim();
      }

      if (typeof rule.api === "function") {
        return rule.api({
          variables,
          node,
          renderNode: (childNode) => this.renderNode(childNode, context),
          parent: context.parent ?? null,
          position,
          root: context.root ?? node,
        });
      }

      let renderedHtml = rule.html;
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
          this.renderNode(c, {
            index: i,
            path: `${i}`,
            parent: null,
            root: node,
            errors: context.errors ?? [],
          })
        )
        .join("");
    }

    return "";
  }

  parse(inputText) {
    const tokens = this.tokenize(inputText);
    const errors = [];
    const tree = this.buildTree(tokens, errors);
    const html = this.renderNode(tree, { errors });
    return { html, errors, tree };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = EZPZ_BBCode_Parser;
} else {
  window.EZPZ_BBCode_Parser = EZPZ_BBCode_Parser;
}
