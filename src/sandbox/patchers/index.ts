/**
 * @author Kuitos
 * @since 2019-04-11
 */

import type { Freer, SandBox } from '../../interfaces';
import { SandBoxType } from '../../interfaces';
import * as css from './css';
import { patchLooseSandbox, patchStrictSandbox } from './dynamicAppend';
import patchHistoryListener from './historyListener';
import patchInterval from './interval';
import patchWindowListener from './windowListener';

// 全局变量补丁
export function patchAtMounting(
  appName: string,
  elementGetter: () => HTMLElement | ShadowRoot,
  sandbox: SandBox,
  scopedCSS: boolean,
  excludeAssetFilter?: CallableFunction,
): Freer[] {
  // 防止内存泄漏
  const basePatchers = [
    () => patchInterval(sandbox.proxy), // 定时器劫持
    () => patchWindowListener(sandbox.proxy), // 事件监听劫持
    () => patchHistoryListener(), // 修复umi的bug, 不管
  ];

  const patchersInSandbox = {
    [SandBoxType.LegacyProxy]: [
      ...basePatchers,
      () => patchLooseSandbox(appName, elementGetter, sandbox.proxy, true, scopedCSS, excludeAssetFilter),
    ],
    // proxy环境
    [SandBoxType.Proxy]: [
      ...basePatchers,
      () => patchStrictSandbox(appName, elementGetter, sandbox.proxy, true, scopedCSS, excludeAssetFilter),
    ],
    [SandBoxType.Snapshot]: [
      ...basePatchers,
      () => patchLooseSandbox(appName, elementGetter, sandbox.proxy, true, scopedCSS, excludeAssetFilter),
    ],
  };

  // 返回unpatch 还原函数
  return patchersInSandbox[sandbox.type]?.map((patch) => patch());
}

// 初始化阶段给 createElement、appendChild、insertBefore 三个方法打一个 patch
// 每个子应用只初始化一次
export function patchAtBootstrapping(
  appName: string,
  elementGetter: () => HTMLElement | ShadowRoot,
  sandbox: SandBox,
  scopedCSS: boolean,
  excludeAssetFilter?: CallableFunction,
): Freer[] {
  const patchersInSandbox = {
    // 一般不会进来这里
    [SandBoxType.LegacyProxy]: [
      () => patchLooseSandbox(appName, elementGetter, sandbox.proxy, false, scopedCSS, excludeAssetFilter),
    ],
    // 支持window.proxy 单实例主要执行这里
    [SandBoxType.Proxy]: [
      () => patchStrictSandbox(appName, elementGetter, sandbox.proxy, false, scopedCSS, excludeAssetFilter),
    ],
    // 快照沙箱
    [SandBoxType.Snapshot]: [
      () => patchLooseSandbox(appName, elementGetter, sandbox.proxy, false, scopedCSS, excludeAssetFilter),
    ],
  };
  // 返回free方法，调用返回rebuild css方法【优化】
  return patchersInSandbox[sandbox.type]?.map((patch) => patch());
}

export { css };
