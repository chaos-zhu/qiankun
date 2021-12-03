/**
 * @author Kuitos
 * @since 2019-10-21
 */
import { execScripts } from 'import-html-entry';
import { isFunction } from 'lodash';
import { frameworkConfiguration } from '../../../apis';

import * as css from '../css';

export const rawHeadAppendChild = HTMLHeadElement.prototype.appendChild;
const rawHeadRemoveChild = HTMLHeadElement.prototype.removeChild;
const rawBodyAppendChild = HTMLBodyElement.prototype.appendChild;
const rawBodyRemoveChild = HTMLBodyElement.prototype.removeChild;
const rawHeadInsertBefore = HTMLHeadElement.prototype.insertBefore;
const rawRemoveChild = HTMLElement.prototype.removeChild;

const SCRIPT_TAG_NAME = 'SCRIPT';
const LINK_TAG_NAME = 'LINK';
const STYLE_TAG_NAME = 'STYLE';

export function isHijackingTag(tagName?: string) {
  return (
    tagName?.toUpperCase() === LINK_TAG_NAME ||
    tagName?.toUpperCase() === STYLE_TAG_NAME ||
    tagName?.toUpperCase() === SCRIPT_TAG_NAME
  );
}

/**
 * Check if a style element is a styled-component liked.
 * A styled-components liked element is which not have textContext but keep the rules in its styleSheet.cssRules.
 * Such as the style element generated by styled-components and emotion.
 * @param element
 */
export function isStyledComponentsLike(element: HTMLStyleElement) {
  return (
    !element.textContent &&
    ((element.sheet as CSSStyleSheet)?.cssRules.length || getStyledElementCSSRules(element)?.length)
  );
}

function patchCustomEvent(
  e: CustomEvent,
  elementGetter: () => HTMLScriptElement | HTMLLinkElement | null,
): CustomEvent {
  Object.defineProperties(e, {
    srcElement: {
      get: elementGetter,
    },
    target: {
      get: elementGetter,
    },
  });

  return e;
}

function manualInvokeElementOnLoad(element: HTMLLinkElement | HTMLScriptElement) {
  // we need to invoke the onload event manually to notify the event listener that the script was completed
  // here are the two typical ways of dynamic script loading
  // 1. element.onload callback way, which webpack and loadjs used, see https://github.com/muicss/loadjs/blob/master/src/loadjs.js#L138
  // 2. addEventListener way, which toast-loader used, see https://github.com/pyrsmk/toast/blob/master/src/Toast.ts#L64
  const loadEvent = new CustomEvent('load');
  const patchedEvent = patchCustomEvent(loadEvent, () => element);
  if (isFunction(element.onload)) {
    element.onload(patchedEvent);
  } else {
    element.dispatchEvent(patchedEvent);
  }
}

function manualInvokeElementOnError(element: HTMLLinkElement | HTMLScriptElement) {
  const errorEvent = new CustomEvent('error');
  const patchedEvent = patchCustomEvent(errorEvent, () => element);
  if (isFunction(element.onerror)) {
    element.onerror(patchedEvent);
  } else {
    element.dispatchEvent(patchedEvent);
  }
}

function convertLinkAsStyle(
  element: HTMLLinkElement,
  postProcess: (styleElement: HTMLStyleElement) => void,
  fetchFn = fetch,
): HTMLStyleElement {
  // 创建style tag
  const styleElement = document.createElement('style');
  const { href } = element;
  // add source link element href
  styleElement.dataset.qiankunHref = href;

  // 请求style href
  fetchFn(href)
    .then((res: any) => res.text())
    .then((styleContext: string) => {
      // 将style text插入创建的style标签
      styleElement.appendChild(document.createTextNode(styleContext));
      // 执行scope css
      postProcess(styleElement);
      // 生成一些事件订阅(用处？)
      manualInvokeElementOnLoad(element);
    })
    .catch(() => manualInvokeElementOnError(element));

  return styleElement;
}

const styledComponentCSSRulesMap = new WeakMap<HTMLStyleElement, CSSRuleList>();
const dynamicScriptAttachedCommentMap = new WeakMap<HTMLScriptElement, Comment>();
const dynamicLinkAttachedInlineStyleMap = new WeakMap<HTMLLinkElement, HTMLStyleElement>();

export function recordStyledComponentsCSSRules(styleElements: HTMLStyleElement[]): void {
  styleElements.forEach((styleElement) => {
    /*
     With a styled-components generated style element, we need to record its cssRules for restore next re-mounting time.
     We're doing this because the sheet of style element is going to be cleaned automatically by browser after the style element dom removed from document.
     see https://www.w3.org/TR/cssom-1/#associated-css-style-sheet
     */
    if (styleElement instanceof HTMLStyleElement && isStyledComponentsLike(styleElement)) {
      if (styleElement.sheet) {
        // record the original css rules of the style element for restore
        styledComponentCSSRulesMap.set(styleElement, (styleElement.sheet as CSSStyleSheet).cssRules);
      }
    }
  });
}

export function getStyledElementCSSRules(styledElement: HTMLStyleElement): CSSRuleList | undefined {
  return styledComponentCSSRulesMap.get(styledElement);
}

export type ContainerConfig = {
  appName: string;
  proxy: WindowProxy;
  strictGlobal: boolean;
  dynamicStyleSheetElements: HTMLStyleElement[];
  appWrapperGetter: CallableFunction;
  scopedCSS: boolean;
  excludeAssetFilter?: CallableFunction;
};

function getOverwrittenAppendChildOrInsertBefore(opts: {
  rawDOMAppendOrInsertBefore: <T extends Node>(newChild: T, refChild?: Node | null) => T;
  isInvokedByMicroApp: (element: HTMLElement) => boolean;
  containerConfigGetter: (element: HTMLElement) => ContainerConfig;
}) {
  // 覆盖原生 appendChild 的方法
  return function appendChildOrInsertBefore<T extends Node>(
    this: HTMLHeadElement | HTMLBodyElement,
    newChild: T,
    refChild?: Node | null,
  ) {
    // createElement 动态创建的元素
    let element = newChild as any;
    const { rawDOMAppendOrInsertBefore, isInvokedByMicroApp, containerConfigGetter } = opts;
    // 非style、link、script直接调用原生方法插入【不做缓存】
    if (!isHijackingTag(element.tagName) || !isInvokedByMicroApp(element)) {
      return rawDOMAppendOrInsertBefore.call(this, element, refChild) as T;
    }

    if (element.tagName) {
      // 根据element作为key从Map中取出containerConfig【对应forStrictSandBox row:63】
      const containerConfig = containerConfigGetter(element);
      const {
        appName,
        appWrapperGetter,
        proxy,
        strictGlobal,
        dynamicStyleSheetElements, // 当前实例动态插入的css list
        scopedCSS,
        excludeAssetFilter,
      } = containerConfig; // 【对应forStrictSandBox row:103】
      // console.log(containerConfig);
      // debugger;

      switch (element.tagName) {
        case LINK_TAG_NAME:
        case STYLE_TAG_NAME: {
          // 动态加入的style标签
          let stylesheetElement: HTMLLinkElement | HTMLStyleElement = newChild as any;
          const { href } = stylesheetElement as HTMLLinkElement;

          // 特殊资源直接加载(调用start/loadMicroApp时配置)
          if (excludeAssetFilter && href && excludeAssetFilter(href)) {
            return rawDOMAppendOrInsertBefore.call(this, element, refChild) as T;
          }

          // 子应用包裹dom【从loader.ts一路传过来的。。。】
          const mountDOM = appWrapperGetter();

          // 设置scoped css隔离
          if (scopedCSS) {
            // exclude link elements like <link rel="icon" href="favicon.ico">
            // 判断是否使用link标签动态插入的style
            const linkElementUsingStylesheet =
              element.tagName?.toUpperCase() === LINK_TAG_NAME &&
              (element as HTMLLinkElement).rel === 'stylesheet' &&
              (element as HTMLLinkElement).href;

            if (linkElementUsingStylesheet) {
              // 判断是否使用用户自定义的fetch加载sytle/script等资源
              const fetch =
                typeof frameworkConfiguration.fetch === 'function'
                  ? frameworkConfiguration.fetch
                  : frameworkConfiguration.fetch?.fn; // import-html-entry 中提供的原生fetch
              // 请求style href资源并创建style，使用scoped包裹插入到Dom
              stylesheetElement = convertLinkAsStyle(
                element,
                // 给css加上作用域，及scope css
                (styleElement) => css.process(mountDOM, styleElement, appName),
                fetch,
              );
              // 动态缓存sytle
              dynamicLinkAttachedInlineStyleMap.set(element, stylesheetElement);
            } else {
              // 不缓存，直接挂载(加上scope)
              css.process(mountDOM, stylesheetElement, appName);
            }
          }

          // eslint-disable-next-line no-shadow
          dynamicStyleSheetElements.push(stylesheetElement); // push到css list中, 下次加载时直接从这里取出来！

          // 插入到dom中
          const referenceNode = mountDOM.contains(refChild) ? refChild : null; // 判断是否后代节点
          return rawDOMAppendOrInsertBefore.call(mountDOM, stylesheetElement, referenceNode);
        }

        // 缓存逻辑同style加载
        case SCRIPT_TAG_NAME: {
          const { src, text } = element as HTMLScriptElement;
          // 过滤
          if (excludeAssetFilter && src && excludeAssetFilter(src)) {
            return rawDOMAppendOrInsertBefore.call(this, element, refChild) as T;
          }

          const mountDOM = appWrapperGetter();
          const { fetch } = frameworkConfiguration;
          const referenceNode = mountDOM.contains(refChild) ? refChild : null; // 是否后代节点

          if (src) {
            // 加载 script src, 执行环境为 proxy
            execScripts(null, [src], proxy, {
              fetch,
              strictGlobal,
              beforeExec: () => {
                // 执行前的一些操作。。。
                const isCurrentScriptConfigurable = () => {
                  const descriptor = Object.getOwnPropertyDescriptor(document, 'currentScript');
                  return !descriptor || descriptor.configurable;
                };
                if (isCurrentScriptConfigurable()) {
                  Object.defineProperty(document, 'currentScript', {
                    get(): any {
                      return element;
                    },
                    configurable: true,
                  });
                }
              },
              success: () => {
                // 脚本执行完成 手动触发script load event
                manualInvokeElementOnLoad(element);
                element = null;
              },
              error: () => {
                // 脚本执行出错 手动触发script error event
                manualInvokeElementOnError(element);
                element = null;
              },
            });

            // 添加提示到html
            const dynamicScriptCommentElement = document.createComment(`dynamic script ${src} replaced by qiankun`);
            // 缓存动态加载的script (例 vue-router 的按需加载的js组件模块)
            dynamicScriptAttachedCommentMap.set(element, dynamicScriptCommentElement);
            // 插入到dom
            return rawDOMAppendOrInsertBefore.call(mountDOM, dynamicScriptCommentElement, referenceNode);
          }

          // 执行除src外的内联script js代码
          execScripts(null, [`<script>${text}</script>`], proxy, { strictGlobal });
          // 添加提示到html
          const dynamicInlineScriptCommentElement = document.createComment('dynamic inline script replaced by qiankun');
          // 缓存动态加载的script (例 vue-router 的按需加载的js组件模块)
          dynamicScriptAttachedCommentMap.set(element, dynamicInlineScriptCommentElement);
          // 插入到dom
          return rawDOMAppendOrInsertBefore.call(mountDOM, dynamicInlineScriptCommentElement, referenceNode);
        }

        default:
          break;
      }
    }

    // 规避特殊情况
    return rawDOMAppendOrInsertBefore.call(this, element, refChild);
  };
}

function getNewRemoveChild(
  headOrBodyRemoveChild: typeof HTMLElement.prototype.removeChild,
  appWrapperGetterGetter: (element: HTMLElement) => ContainerConfig['appWrapperGetter'],
) {
  // 移除dom(判断是从主应用中移除还是从子应用移除)
  return function removeChild<T extends Node>(this: HTMLHeadElement | HTMLBodyElement, child: T) {
    const { tagName } = child as any;
    // 非 style、link、script 直接移除dom
    if (!isHijackingTag(tagName)) return headOrBodyRemoveChild.call(this, child) as T;

    // 尝试从动态缓存的Map中取出 Dom
    try {
      let attachedElement: Node;
      switch (tagName) {
        case LINK_TAG_NAME: {
          attachedElement = (dynamicLinkAttachedInlineStyleMap.get(child as any) as Node) || child;
          break;
        }
        case SCRIPT_TAG_NAME: {
          attachedElement = (dynamicScriptAttachedCommentMap.get(child as any) as Node) || child;
          break;
        }
        default: {
          attachedElement = child;
        }
      }

      const appWrapperGetter = appWrapperGetterGetter(child as any);
      const container = appWrapperGetter();
      // 是否后代节点
      if (container.contains(attachedElement)) {
        // 从页面移除dom
        return rawRemoveChild.call(container, attachedElement) as T;
      }
    } catch (e) {
      console.warn(e);
    }

    return headOrBodyRemoveChild.call(this, child) as T;
  };
}

export function patchHTMLDynamicAppendPrototypeFunctions(
  isInvokedByMicroApp: (element: HTMLElement) => boolean,
  containerConfigGetter: (element: HTMLElement) => ContainerConfig,
) {
  // 判断是否劫持过 appendChild/insertBefore
  if (
    HTMLHeadElement.prototype.appendChild === rawHeadAppendChild &&
    HTMLBodyElement.prototype.appendChild === rawBodyAppendChild &&
    HTMLHeadElement.prototype.insertBefore === rawHeadInsertBefore
  ) {
    // appendChild 插入到head的劫持
    HTMLHeadElement.prototype.appendChild = getOverwrittenAppendChildOrInsertBefore({
      rawDOMAppendOrInsertBefore: rawHeadAppendChild, // 原生插入方法
      containerConfigGetter, // 通过创建的element 获取即将插入的style/script/link标签
      isInvokedByMicroApp, // 是否是子应用的插入，通过上面的 weakMap 判断
    }) as typeof rawHeadAppendChild;

    // appendChild 插入到body的劫持
    HTMLBodyElement.prototype.appendChild = getOverwrittenAppendChildOrInsertBefore({
      rawDOMAppendOrInsertBefore: rawBodyAppendChild,
      containerConfigGetter,
      isInvokedByMicroApp,
    }) as typeof rawBodyAppendChild;

    // 劫持 insertBefore
    HTMLHeadElement.prototype.insertBefore = getOverwrittenAppendChildOrInsertBefore({
      rawDOMAppendOrInsertBefore: rawHeadInsertBefore as any,
      containerConfigGetter,
      isInvokedByMicroApp,
    }) as typeof rawHeadInsertBefore;
  }

  // 判断是否劫持过 removeChild
  if (
    HTMLHeadElement.prototype.removeChild === rawHeadRemoveChild &&
    HTMLBodyElement.prototype.removeChild === rawBodyRemoveChild
  ) {
    HTMLHeadElement.prototype.removeChild = getNewRemoveChild(
      rawHeadRemoveChild,
      (element) => containerConfigGetter(element).appWrapperGetter,
    );
    HTMLBodyElement.prototype.removeChild = getNewRemoveChild(
      rawBodyRemoveChild,
      (element) => containerConfigGetter(element).appWrapperGetter,
    );
  }

  // 取消劫持 unpatch
  return function unpatch() {
    HTMLHeadElement.prototype.appendChild = rawHeadAppendChild;
    HTMLHeadElement.prototype.removeChild = rawHeadRemoveChild;
    HTMLBodyElement.prototype.appendChild = rawBodyAppendChild;
    HTMLBodyElement.prototype.removeChild = rawBodyRemoveChild;

    HTMLHeadElement.prototype.insertBefore = rawHeadInsertBefore;
  };
}

// 二次激活重新从缓存中获取css
export function rebuildCSSRules(
  styleSheetElements: HTMLStyleElement[],
  reAppendElement: (stylesheetElement: HTMLStyleElement) => boolean,
) {
  styleSheetElements.forEach((stylesheetElement) => {
    // re-append the dynamic stylesheet to sub-app container
    const appendSuccess = reAppendElement(stylesheetElement);
    if (appendSuccess) {
      /*
      get the stored css rules from styled-components generated element, and the re-insert rules for them.
      note that we must do this after style element had been added to document, which stylesheet would be associated to the document automatically.
      check the spec https://www.w3.org/TR/cssom-1/#associated-css-style-sheet
       */
      if (stylesheetElement instanceof HTMLStyleElement && isStyledComponentsLike(stylesheetElement)) {
        const cssRules = getStyledElementCSSRules(stylesheetElement);
        if (cssRules) {
          // eslint-disable-next-line no-plusplus
          for (let i = 0; i < cssRules.length; i++) {
            const cssRule = cssRules[i];
            const cssStyleSheetElement = stylesheetElement.sheet as CSSStyleSheet;
            cssStyleSheetElement.insertRule(cssRule.cssText, cssStyleSheetElement.cssRules.length);
          }
        }
      }
    }
  });
}
