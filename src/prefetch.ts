/**
 * @author Kuitos
 * @since 2019-02-26
 */

import type { Entry, ImportEntryOpts } from 'import-html-entry';
import { importEntry } from 'import-html-entry';
import { isFunction } from 'lodash';
import { getAppStatus, getMountedApps, NOT_LOADED } from 'single-spa';
import type { AppMetadata, PrefetchStrategy } from './interfaces';

declare global {
  interface NetworkInformation {
    saveData: boolean;
    effectiveType: string;
  }
}

// RIC and shim for browsers setTimeout() without it
// 某帧渲染低于1000ms/60(即低于16ms)时 执行
const requestIdleCallback =
  (window as any).requestIdleCallback ||
  function requestIdleCallback(cb: CallableFunction) {
    const start = Date.now();
    return setTimeout(() => {
      cb({
        didTimeout: false,
        timeRemaining() {
          return Math.max(0, 50 - (Date.now() - start));
        },
      });
    }, 1);
  };

const navigation = (navigator as any);
const isSlowNetwork = navigation.connection
  ? navigation.connection.saveData ||
    (navigation.connection.type !== 'wifi' &&
      navigation.connection.type !== 'ethernet' &&
      /([23])g/.test(navigation.connection.effectiveType))
  : false;

/**
 * prefetch assets, do nothing while in mobile network
 * @param entry
 * @param opts
 */
function prefetch(entry: Entry, opts?: ImportEntryOpts): void {
  if (!navigator.onLine || isSlowNetwork) {
    // Don't prefetch if in a slow network or offline
    return;
  }

  // 空闲时间加载 子应用&子应用资源(script/sytle)
  requestIdleCallback(async () => {
    // importEntry加载子应用入口文件，并返回getExternalScripts, getExternalStyleSheets方法
    // 调用这俩方法会加载对应子应用入口文件中的script、style的资源文件，最终返回promise
    // 【对于请求过的资源url，importEntry会添加缓存，下次直接返回结果】
    const { getExternalScripts, getExternalStyleSheets } = await importEntry(entry, opts);
    // console.log('getExternalStyleSheets：', getExternalStyleSheets());
    requestIdleCallback(getExternalStyleSheets);
    requestIdleCallback(getExternalScripts);
  });
}

function prefetchAfterFirstMounted(apps: AppMetadata[], opts?: ImportEntryOpts): void {
  // 监听single-spa发布的first-mout钩子，第一个子应用加载完成后开始加载其他子应用
  window.addEventListener('single-spa:first-mount', function listener() {
    // 判断是否加载过
    const notLoadedApps = apps.filter((app) => getAppStatus(app.name) === NOT_LOADED);

    if (process.env.NODE_ENV === 'development') {
      const mountedApps = getMountedApps();
      console.log(`[qiankun] prefetch starting after ${mountedApps} mounted...`, notLoadedApps);
    }

    // 开始预载
    notLoadedApps.forEach(({ entry }) => prefetch(entry, opts));

    // 加载启动，移除监听
    window.removeEventListener('single-spa:first-mount', listener);
  });
}

// 初始化时加载所有应用资源
export function prefetchImmediately(apps: AppMetadata[], opts?: ImportEntryOpts): void {
  if (process.env.NODE_ENV === 'development') {
    console.log('[qiankun] prefetch starting for apps...', apps);
  }
  apps.forEach(({ entry }) => prefetch(entry, opts));
}

// 预加载子应用
export function doPrefetchStrategy(
  apps: AppMetadata[],
  prefetchStrategy: PrefetchStrategy,
  importEntryOpts?: ImportEntryOpts,
) {
  const appsName2Apps = (names: string[]): AppMetadata[] => apps.filter((app) => names.includes(app.name));

  if (Array.isArray(prefetchStrategy)) {
    // 1数组：预加载指定子应用
    prefetchAfterFirstMounted(appsName2Apps(prefetchStrategy as string[]), importEntryOpts);

  } else if (isFunction(prefetchStrategy)) {
    // 2.函数：指定时机，自定义加载子应用
    (async () => {
      // 指定部分应用直接加载；另一部分使用requestIdleCallback预加载
      const { criticalAppNames = [], minorAppsName = [] } = await prefetchStrategy(apps);
      prefetchImmediately(appsName2Apps(criticalAppNames), importEntryOpts);
      prefetchAfterFirstMounted(appsName2Apps(minorAppsName), importEntryOpts);
    })();
  } else {
    // 3.字符串：
    switch (prefetchStrategy) {
      // 默认，第一个应用mount后开始预加载其他子应用tempalte资源(只加载缓存，不执行js)
      case true:
        prefetchAfterFirstMounted(apps, importEntryOpts);
        break;
      // start后立即加载所有子应用【不等待第一个应用mount】(只加载缓存，不执行js)
      case 'all':
        prefetchImmediately(apps, importEntryOpts);
        break;

      default:
        break;
    }
  }
}
