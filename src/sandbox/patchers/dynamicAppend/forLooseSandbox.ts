/**
 * @author Kuitos
 * @since 2020-10-13
 */

import { checkActivityFunctions } from 'single-spa';
import type { Freer } from '../../../interfaces';
import { patchHTMLDynamicAppendPrototypeFunctions, rebuildCSSRules, recordStyledComponentsCSSRules } from './common';

let bootstrappingPatchCount = 0;
let mountingPatchCount = 0;

/**
 * Just hijack dynamic head append, that could avoid accidentally hijacking the insertion of elements except in head.
 * Such a case: ReactDOM.createPortal(<style>.test{color:blue}</style>, container),
 * this could made we append the style element into app wrapper but it will cause an error while the react portal unmounting, as ReactDOM could not find the style in body children list.
 * @param appName
 * @param appWrapperGetter
 * @param proxy
 * @param mounting
 * @param scopedCSS
 * @param excludeAssetFilter
 */
export function patchLooseSandbox(
  appName: string,
  appWrapperGetter: () => HTMLElement | ShadowRoot,
  proxy: Window,
  mounting = true,
  scopedCSS = false,
  excludeAssetFilter?: CallableFunction,
): Freer {
  let dynamicStyleSheetElements: Array<HTMLLinkElement | HTMLStyleElement> = [];

  const unpatchDynamicAppendPrototypeFunctions = patchHTMLDynamicAppendPrototypeFunctions(
    () => checkActivityFunctions(window.location).some((name) => name === appName),
    () => ({
      appName,
      appWrapperGetter,
      proxy,
      strictGlobal: false,
      scopedCSS,
      dynamicStyleSheetElements,
      excludeAssetFilter,
    }),
  );

  if (!mounting) bootstrappingPatchCount++;
  if (mounting) mountingPatchCount++;

  // 返回取消劫持部分原生api的方法
  return function free() {
    if (!mounting && bootstrappingPatchCount !== 0) bootstrappingPatchCount--;
    if (mounting) mountingPatchCount--;

    const allMicroAppUnmounted = mountingPatchCount === 0 && bootstrappingPatchCount === 0;
    if (allMicroAppUnmounted) unpatchDynamicAppendPrototypeFunctions();

    // 记录加载过的子应用css
    recordStyledComponentsCSSRules(dynamicStyleSheetElements);

    // 重新切换已经加载过的子应用时调用rebuild，不需要重新加载css【优化】
    return function rebuild() {
      rebuildCSSRules(dynamicStyleSheetElements, (stylesheetElement) => {
        const appWrapper = appWrapperGetter();
        if (!appWrapper.contains(stylesheetElement)) {
          document.head.appendChild.call(appWrapper, stylesheetElement);
          return true;
        }
        return false;
      });

      if (mounting) {
        dynamicStyleSheetElements = [];
      }
    };
  };
}
