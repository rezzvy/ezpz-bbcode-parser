class EZPZ_BBCode_Parser {
  constructor(templateRules = []) {
    this.rules = this.compile(templateRules);

    this.init();
  }

  init() {
    this.utils = {
      toListItems: (content) =>
        content.split(/\[\*\]/).reduce((html, item) => {
          const trimmed = item.trim();
          return trimmed ? html + `<li>${trimmed}</li>` : html;
        }, ""),

      getYoutubeVideoID: (link) => {
        const trimmed = link.trim();
        const match = trimmed.match(
          /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^/]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
        );
        if (match) return match[1];
        if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
        return null;
      },
    };
  }

  compile(templateRules) {
    return templateRules.map(({ template, html, replace }) => {
      const patternString = template.replace(/\$([0-9]+)/g, (_, n) => `__CAPTURE${n}__`);
      const escapedPattern = patternString.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
      const finalPattern = escapedPattern.replace(/__CAPTURE([0-9]+)__/g, "([\\s\\S]*?)");
      const pattern = new RegExp(finalPattern, "gi");

      const wrappedReplace =
        typeof replace === "function"
          ? (...args) => {
              const [match, ...rest] = args;
              const groupCount = rest.length - 2;
              return replace({
                match: match,
                content: rest.slice(0, groupCount),
                index: rest[groupCount],
                input: rest[groupCount + 1],
              });
            }
          : replace;

      return {
        pattern,
        replace: wrappedReplace || html,
      };
    });
  }

  parse(inputText) {
    let result = inputText;
    this.rules.forEach((rule) => {
      result = result.replace(rule.pattern, rule.replace);
    });
    return result;
  }

  setRules(templateRules) {
    this.rules = this.compile(templateRules);
  }

  addRule(rule) {
    this.rules.push(...this.compile([rule]));
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = EZPZ_BBCode_Parser;
} else {
  window.EZPZ_BBCode_Parser = EZPZ_BBCode_Parser;
}
