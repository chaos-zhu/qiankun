/**
 * @author Kuitos
 * @since 2020-10-13
 */

import type { Freer } from '../../../interfaces';
import { getCurrentRunningApp } from '../../common';
import type { ContainerConfig } from './common';
import {
  isHijackingTag,
  patchHTMLDynamicAppendPrototypeFunctions,
  rawHeadAppendChild,
  rebuildCSSRules,
  recordStyledComponentsCSSRules,
} from './common';

declare global {
  interface Window {
    __proxyAttachContainerConfigMap__: WeakMap<WindowProxy, ContainerConfig>;
  }
}

// Get native global window with a sandbox disgusted way, thus we could share it between qiankun instances🤪
// eslint-disable-next-line no-new-func
const nativeGlobal: Window = new Function('return this')();
Object.defineProperty(nativeGlobal, '__proxyAttachContainerConfigMap__', { enumerable: false, writable: true });

// Share proxyAttachContainerConfigMap between multiple qiankun instance, thus they could access the same record
nativeGlobal.__proxyAttachContainerConfigMap__ =
  nativeGlobal.__proxyAttachContainerConfigMap__ || new WeakMap<WindowProxy, ContainerConfig>();
const proxyAttachContainerConfigMap = nativeGlobal.__proxyAttachContainerConfigMap__;

// 存放子应用调用createElement插入的style、link、script DOM【动态插入】
const elementAttachContainerConfigMap = new WeakMap<HTMLElement, ContainerConfig>();

const docCreatePatchedMap = new WeakMap<typeof document.createElement, typeof document.createElement>();

// 劫持document.createElement
function patchDocumentCreateElement() {
  // 初始化获取原生的createElement方法
  const docCreateElementFnBeforeOverwrite = docCreatePatchedMap.get(document.createElement);

  // 判断是否劫持过
  if (!docCreateElementFnBeforeOverwrite) {
    // 劫持原生 document.createElement 方法
    const rawDocumentCreateElement = document.createElement;
    Document.prototype.createElement = function createElement<K extends keyof HTMLElementTagNameMap>(
      this: Document, // ts 特性；编译后不存在
      tagName: K,
      options?: ElementCreationOptions,
    ): HTMLElement {
      // 调用原生方法创建dom
      const element = rawDocumentCreateElement.call(this, tagName, options);
      // 判断dom tag是否为为sytle、link、script
      if (isHijackingTag(tagName)) {
        const { window: currentRunningSandboxProxy } = getCurrentRunningApp() || {};
        if (currentRunningSandboxProxy) {
          // 从全局状态中取出当前沙箱配置
          const proxyContainerConfig = proxyAttachContainerConfigMap.get(currentRunningSandboxProxy);
          // console.log(proxyContainerConfig);
          if (proxyContainerConfig) {
            // 将tag保存到Map中【劫持插入API时使用】
            elementAttachContainerConfigMap.set(element, proxyContainerConfig);
          }
        }
      }

      return element;
    };

    if (document.hasOwnProperty('createElement')) {
      document.createElement = Document.prototype.createElement;
    }

    docCreatePatchedMap.set(Document.prototype.createElement, rawDocumentCreateElement);
  }

  // 返回unpatch 取消劫持
  return function unpatch() {
    if (docCreateElementFnBeforeOverwrite) {
      Document.prototype.createElement = docCreateElementFnBeforeOverwrite;
      document.createElement = docCreateElementFnBeforeOverwrite;
    }
  };
}

let bootstrappingPatchCount = 0;
let mountingPatchCount = 0;

export function patchStrictSandbox(
  appName: string,
  appWrapperGetter: () => HTMLElement | ShadowRoot,
  proxy: Window,
  mounting = true,
  scopedCSS = false,
  excludeAssetFilter?: CallableFunction,
): Freer {
  let containerConfig = proxyAttachContainerConfigMap.get(proxy);
  // console.log('containerConfig: \n', containerConfig);
  // debugger;

  // 首次patch初始化 子应用config
  if (!containerConfig) {
    containerConfig = {
      appName,
      proxy,
      appWrapperGetter,
      dynamicStyleSheetElements: [],
      strictGlobal: true,
      excludeAssetFilter,
      scopedCSS,
    };
    proxyAttachContainerConfigMap.set(proxy, containerConfig);
  }

  // 子应用的style引用对象，储存了所有动态插入的style
  const { dynamicStyleSheetElements } = containerConfig;
  // dynamicStyleSheetElements: (3) [style, style, style]

  // 劫持动态创建的script、style、link，返回取消劫持方法(优化) 
  const unpatchDocumentCreate = patchDocumentCreateElement();

  // 劫持创建(script、style、link)后动态插入, 目的：link与style是为了建立scopedCss和缓存优化(重建还原)；script是为能够在proxy环境下执行
  const unpatchDynamicAppendPrototypeFunctions = patchHTMLDynamicAppendPrototypeFunctions(
    (element) => elementAttachContainerConfigMap.has(element),
    (element) => elementAttachContainerConfigMap.get(element)!,
  );

  if (!mounting) bootstrappingPatchCount++;
  if (mounting) mountingPatchCount++;

  // 初始化完成后返回 free 函数
  return function free() {
    if (!mounting && bootstrappingPatchCount !== 0) bootstrappingPatchCount--;
    if (mounting) mountingPatchCount--;

    // 确保当前子应用都已卸载
    const allMicroAppUnmounted = mountingPatchCount === 0 && bootstrappingPatchCount === 0;
    // 所有子应用未挂在状态： 清除原生方法劫持、缓存动态添加的样式、返回 rebuild 函数
    if (allMicroAppUnmounted) {
      unpatchDynamicAppendPrototypeFunctions();
      unpatchDocumentCreate();
    }
    // 样式表不清除，缓存记录一份
    recordStyledComponentsCSSRules(dynamicStyleSheetElements);

    // free函数返回rebuild函数，用于从缓存中快速构建css
    return function rebuild() {
      // 把所有动态样式表的值全部都插入到页面
      rebuildCSSRules(dynamicStyleSheetElements, (stylesheetElement) => {
        const appWrapper = appWrapperGetter();
        if (!appWrapper.contains(stylesheetElement)) {
          rawHeadAppendChild.call(appWrapper, stylesheetElement);
          return true;
        }
        return false;
      });
    };
  };
}
