/**
 * @author Saviio
 * @since 2020-4-19
 */

// https://developer.mozilla.org/en-US/docs/Web/API/CSSRule
enum RuleType {
  // type: rule will be rewrote
  STYLE = 1,
  MEDIA = 4,
  SUPPORTS = 12,

  // type: value will be kept
  IMPORT = 3,
  FONT_FACE = 5,
  PAGE = 6,
  KEYFRAMES = 7,
  KEYFRAME = 8,
}

const arrayify = <T>(list: CSSRuleList | any[]) => {
  return [].slice.call(list, 0) as T[];
};

const rawDocumentBodyAppend = HTMLBodyElement.prototype.appendChild;

export class ScopedCSS {
  private static ModifiedTag = 'Symbol(style-modified-qiankun)';

  private sheet: StyleSheet;

  private swapNode: HTMLStyleElement;

  constructor() {
    const styleNode = document.createElement('style');
    rawDocumentBodyAppend.call(document.body, styleNode);

    this.swapNode = styleNode;
    this.sheet = styleNode.sheet!;
    this.sheet.disabled = true;
  }

  process(styleNode: HTMLStyleElement, prefix: string = '') {
    // 给子应用根节点 tag 加 div[data-qian-appName] 前缀 ？？？
    if (styleNode.textContent !== '') {
      // 创建个临时的textNode节点，存储 sytle 中的css文本
      const textNode = document.createTextNode(styleNode.textContent || '');
      // 插入process实例的style tag
      this.swapNode.appendChild(textNode);
      // style标签的 sheet 对象
      const sheet = this.swapNode.sheet as any; // type is missing
      // 浅拷贝一份
      const rules = arrayify<CSSRule>(sheet?.cssRules ?? []);
      // 【关键】重写css 选择器(加个选择器前缀，达到 scope css 效果)
      const css = this.rewrite(rules, prefix);
      // eslint-disable-next-line no-param-reassign
      styleNode.textContent = css;

      // cleanup
      this.swapNode.removeChild(textNode);
      return;
    }

    // 监听style节点 子节点更新
    const mutator = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i += 1) {
        const mutation = mutations[i];

        if (ScopedCSS.ModifiedTag in styleNode) {
          return;
        }

        if (mutation.type === 'childList') {
          const sheet = styleNode.sheet as any;
          const rules = arrayify<CSSRule>(sheet?.cssRules ?? []);
          const css = this.rewrite(rules, prefix);

          // eslint-disable-next-line no-param-reassign
          styleNode.textContent = css;
          // eslint-disable-next-line no-param-reassign
          (styleNode as any)[ScopedCSS.ModifiedTag] = true;
        }
      }
    });

    // since observer will be deleted when node be removed
    // we dont need create a cleanup function manually
    // see https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/disconnect
    mutator.observe(styleNode, { childList: true });
  }

  private rewrite(rules: CSSRule[], prefix: string = '') {
    let css = '';

    rules.forEach((rule) => {
      switch (rule.type) {
        case RuleType.STYLE:
          css += this.ruleStyle(rule as CSSStyleRule, prefix);
          break;
        case RuleType.MEDIA:
          css += this.ruleMedia(rule as CSSMediaRule, prefix);
          break;
        case RuleType.SUPPORTS:
          css += this.ruleSupport(rule as CSSSupportsRule, prefix);
          break;
        default:
          css += `${rule.cssText}`;
          break;
      }
    });

    return css;
  }

  // handle case:
  // .app-main {}
  // html, body {}

  // eslint-disable-next-line class-methods-use-this
  private ruleStyle(rule: CSSStyleRule, prefix: string) {
    const rootSelectorRE = /((?:[^\w\-.#]|^)(body|html|:root))/gm;
    const rootCombinationRE = /(html[^\w{[]+)/gm;

    const selector = rule.selectorText.trim();

    let { cssText } = rule;
    // handle html { ... }
    // handle body { ... }
    // handle :root { ... }
    if (selector === 'html' || selector === 'body' || selector === ':root') {
      return cssText.replace(rootSelectorRE, prefix);
    }

    // handle html body { ... }
    // handle html > body { ... }
    if (rootCombinationRE.test(rule.selectorText)) {
      const siblingSelectorRE = /(html[^\w{]+)(\+|~)/gm;

      // since html + body is a non-standard rule for html
      // transformer will ignore it
      if (!siblingSelectorRE.test(rule.selectorText)) {
        cssText = cssText.replace(rootCombinationRE, '');
      }
    }

    // handle grouping selector, a,span,p,div { ... }
    cssText = cssText.replace(/^[\s\S]+{/, (selectors) =>
      selectors.replace(/(^|,\n?)([^,]+)/g, (item, p, s) => {
        // handle div,body,span { ... }
        if (rootSelectorRE.test(item)) {
          return item.replace(rootSelectorRE, (m) => {
            // do not discard valid previous character, such as body,html or *:not(:root)
            const whitePrevChars = [',', '('];

            if (m && whitePrevChars.includes(m[0])) {
              return `${m[0]}${prefix}`;
            }

            // replace root selector with prefix
            return prefix;
          });
        }

        return `${p}${prefix} ${s.replace(/^ */, '')}`;
      }),
    );

    return cssText;
  }

  // handle case:
  // @media screen and (max-width: 300px) {}
  private ruleMedia(rule: CSSMediaRule, prefix: string) {
    const css = this.rewrite(arrayify(rule.cssRules), prefix);
    return `@media ${rule.conditionText} {${css}}`;
  }

  // handle case:
  // @supports (display: grid) {}
  private ruleSupport(rule: CSSSupportsRule, prefix: string) {
    const css = this.rewrite(arrayify(rule.cssRules), prefix);
    return `@supports ${rule.conditionText} {${css}}`;
  }
}

let processor: ScopedCSS;

export const QiankunCSSRewriteAttr = 'data-qiankun';
export const process = (
  appWrapper: HTMLElement,
  stylesheetElement: HTMLStyleElement | HTMLLinkElement,
  appName: string,
): void => {
  // lazy singleton pattern
  if (!processor) {
    processor = new ScopedCSS(); // 创建一个空style tag 对象并插入到 dom
  }

  // link 经过entry-html处理一般不会存在
  if (stylesheetElement.tagName === 'LINK') {
    console.warn('Feature: sandbox.experimentalStyleIsolation is not support for link element yet.');
  }

  const mountDOM = appWrapper;
  if (!mountDOM) {
    return;
  }

  const tag = (mountDOM.tagName || '').toLowerCase();

  // 给每个选择器加特定前缀 实现多实例样式隔离
  if (tag && stylesheetElement.tagName === 'STYLE') {
    const prefix = `${tag}[${QiankunCSSRewriteAttr}="${appName}"]`;
    processor.process(stylesheetElement, prefix);
  }
};
