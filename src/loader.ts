/**
 * @author Kuitos
 * @since 2020-04-01
 */

import { importEntry } from 'import-html-entry';
import { concat, forEach, mergeWith } from 'lodash';
import type { LifeCycles, ParcelConfigObject } from 'single-spa';
import getAddOns from './addons';
import { QiankunError } from './error';
import { getMicroAppStateActions } from './globalState';
import type {
  FrameworkConfiguration,
  FrameworkLifeCycles,
  HTMLContentRender,
  LifeCycleFn,
  LoadableApp,
  ObjectType,
} from './interfaces';
import { createSandboxContainer, css } from './sandbox';
import {
  Deferred,
  getContainer,
  getDefaultTplWrapper,
  getWrapperId,
  isEnableScopedCSS,
  toArray,
  validateExportLifecycle,
} from './utils';

function assertElementExist(element: Element | null | undefined, msg?: string) {
  if (!element) {
    if (msg) {
      throw new QiankunError(msg);
    }

    throw new QiankunError('element not existed!');
  }
}

// 执行钩子，返回resolve
function execHooksChain<T extends ObjectType>(
  hooks: Array<LifeCycleFn<T>>,
  app: LoadableApp<T>,
  global = window,
): Promise<any> {
  if (hooks.length) {
    return hooks.reduce((chain, hook) => chain.then(() => hook(app, global)), Promise.resolve());
  }

  return Promise.resolve();
}

async function validateSingularMode<T extends ObjectType>(
  validate: FrameworkConfiguration['singular'],
  app: LoadableApp<T>,
): Promise<boolean> {
  return typeof validate === 'function' ? validate(app) : !!validate;
}

// @ts-ignore
const supportShadowDOM = document.head.attachShadow || document.head.createShadowRoot;

// 创建根元素 css 隔离
function createElement(
  appContent: string,
  strictStyleIsolation: boolean,
  scopedCSS: boolean,
  appName: string,
): HTMLElement {
  const containerElement = document.createElement('div');
  containerElement.innerHTML = appContent;
  const appElement = containerElement.firstChild as HTMLElement;
  // 为true 且浏览器支持shadow dom 返回以shadow dom包裹的DOM结构
  if (strictStyleIsolation) {
    if (!supportShadowDOM) {
      console.warn(
        '[qiankun]: As current browser not support shadow dom, your strictStyleIsolation configuration will be ignored!',
      );
    } else {
      const { innerHTML } = appElement;
      appElement.innerHTML = '';
      let shadow: ShadowRoot;

      if (appElement.attachShadow) {
        shadow = appElement.attachShadow({ mode: 'open' });
      } else {
        // 废弃的创建shadowDom api
        shadow = (appElement as any).createShadowRoot();
      }
      shadow.innerHTML = innerHTML;
    }
  }

  if (scopedCSS) {
    const attr = appElement.getAttribute(css.QiankunCSSRewriteAttr);
    if (!attr) {
      appElement.setAttribute(css.QiankunCSSRewriteAttr, appName);
    }

    // 为每一个style节点下的选择器添加 scoped 前缀
    const styleNodes = appElement.querySelectorAll('style') || [];
    forEach(styleNodes, (stylesheetElement: HTMLStyleElement) => {
      css.process(appElement!, stylesheetElement, appName);
    });
  }

  return appElement;
}

/** generate app wrapper dom getter */
function getAppWrapperGetter(
  appName: string,
  appInstanceId: string,
  useLegacyRender: boolean,
  strictStyleIsolation: boolean,
  scopedCSS: boolean,
  elementGetter: () => HTMLElement | null,
) {
  return () => {
    if (useLegacyRender) {
      if (strictStyleIsolation) throw new QiankunError('strictStyleIsolation can not be used with legacy render!');
      if (scopedCSS) throw new QiankunError('experimentalStyleIsolation can not be used with legacy render!');

      const appWrapper = document.getElementById(getWrapperId(appInstanceId));
      assertElementExist(appWrapper, `Wrapper element for ${appName} with instance ${appInstanceId} is not existed!`);
      return appWrapper!;
    }

    const element = elementGetter();
    assertElementExist(element, `Wrapper element for ${appName} with instance ${appInstanceId} is not existed!`);

    if (strictStyleIsolation && supportShadowDOM) {
      return element!.shadowRoot!;
    }

    return element!;
  };
}

const rawAppendChild = HTMLElement.prototype.appendChild;
const rawRemoveChild = HTMLElement.prototype.removeChild;
type ElementRender = (
  props: { element: HTMLElement | null; loading: boolean; container?: string | HTMLElement },
  phase: 'loading' | 'mounting' | 'mounted' | 'unmounted',
) => any;

/**
 * Get the render function
 * If the legacy render function is provide, used as it, otherwise we will insert the app element to target container by qiankun
 * @param appName
 * @param appContent
 * @param legacyRender
 */
// 判断用户自定义渲染还是默认renden函数渲染
function getRender(appName: string, appContent: string, legacyRender?: HTMLContentRender) {
  const render: ElementRender = ({ element, loading, container }, phase) => {
    // 自定义渲染函数
    if (legacyRender) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          '[qiankun] Custom rendering function is deprecated, you can use the container element setting instead!',
        );
      }
      return legacyRender({ loading, appContent: element ? appContent : '' });
    }
    const containerElement = getContainer(container!);
    // 渲染时子应用容器不存在抛出错误
    if (phase !== 'unmounted') {
      const errorMsg = (() => {
        switch (phase) {
          case 'loading':
          case 'mounting':
            return `Target container with ${container} not existed while ${appName} ${phase}!`;

          case 'mounted':
            return `Target container with ${container} not existed after ${appName} ${phase}!`;

          default:
            return `Target container with ${container} not existed while ${appName} rendering!`;
        }
      })();
      assertElementExist(containerElement, errorMsg);
    }

    if (containerElement && !containerElement.contains(element)) {
      // 容器中有子元素先清空子应用容器内容
      while (containerElement!.firstChild) {
        rawRemoveChild.call(containerElement, containerElement!.firstChild);
      }
      // 再把 html template 插入到 子应用容器
      if (element) {
        rawAppendChild.call(containerElement, element);
      }
    }

    return undefined;
  };

  return render;
}

function getLifecyclesFromExports(
  scriptExports: LifeCycles<any>,
  appName: string,
  global: WindowProxy,
  globalLatestSetProp?: PropertyKey | null,
) {
  if (validateExportLifecycle(scriptExports)) {
    return scriptExports;
  }

  // fallback to sandbox latest set property if it had
  if (globalLatestSetProp) {
    const lifecycles = (<any>global)[globalLatestSetProp];
    if (validateExportLifecycle(lifecycles)) {
      return lifecycles;
    }
  }

  if (process.env.NODE_ENV === 'development') {
    console.warn(
      `[qiankun] lifecycle not found from ${appName} entry exports, fallback to get from window['${appName}']`,
    );
  }

  // fallback to global variable who named with ${appName} while module exports not found
  const globalVariableExports = (global as any)[appName];

  if (validateExportLifecycle(globalVariableExports)) {
    return globalVariableExports;
  }

  throw new QiankunError(`You need to export lifecycle functions in ${appName} entry`);
}

let prevAppUnmountedDeferred: Deferred<void>;

export type ParcelConfigObjectGetter = (remountContainer?: string | HTMLElement) => ParcelConfigObject;

// 加载子应用
export async function loadApp<T extends ObjectType>(
  app: LoadableApp<T>,
  configuration: FrameworkConfiguration = {},
  lifeCycles?: FrameworkLifeCycles<T>,
): Promise<ParcelConfigObjectGetter> {
  const { entry, name: appName } = app;
  const appInstanceId = `${appName}_${+new Date()}_${Math.floor(Math.random() * 1000)}`;

  const {
    singular = false, // 单实例指的是同一时间只会渲染一个微应用, 在start时默认设置为true
    sandbox = true, // css ShadowDOM 沙箱, 在start时默认设置为true. 保证不同子应用之间样式隔离。无法保证主子应用样式冲突
    excludeAssetFilter,
    globalContext = window,
    ...importEntryOpts
  } = configuration;

  // console.log('configuration: ', configuration);

  // get the entry html content and script executor
  // console.log(importEntryOpts); // { prefetch: true }
  const { template, execScripts, assetPublicPath } = await importEntry(entry, importEntryOpts);
  // console.log('template: \n', template); // 外联的css加载后被内联
  // console.log('execScripts:  \n', execScripts); // 执行template中所有的js(可指定上下文)
  // console.log('assetPublicPath:  \n', assetPublicPath); // 公共路径

  // 单实例模式时 需等待上一个应用卸载(unmount时 resolve)【疑惑: 这里的判断有点多余，在mount时有该判断】
  // console.log(singular); // 默认true
  if (await validateSingularMode(singular, app)) {
    // await undefined 无影响
    await (prevAppUnmountedDeferred && prevAppUnmountedDeferred.promise);
  }

  // 子应用容器包裹一层dom【为scoped css隔离方案预备用】
  // <div id="__qiankun_microapp_wrapper_for_${appInstanceId}__" data-name="${appName}">${template}</div>
  const appContent = getDefaultTplWrapper(appInstanceId, appName)(template);
  // console.log('appContent: \n', appContent); // 【包含了html根元素⭐】

  // 是否开启shadow dom css隔离
  const strictStyleIsolation = typeof sandbox === 'object' && !!sandbox.strictStyleIsolation; // 默认false
  // 是否启用scope css隔离【注意：开启 strictStyleIsolation 优先级更高】
  const scopedCSS = isEnableScopedCSS(sandbox); // 默认false

  // 判断是否开启css隔离，则将 appContent 的子元素即微应用入口模版用 shadow dom 包裹起来
  let initialAppWrapperElement: HTMLElement | null = createElement(
    appContent,
    strictStyleIsolation,
    scopedCSS,
    appName,
  );
  // console.log('initialAppWrapperElement: \n', initialAppWrapperElement); // 【html根元素自动给干掉了⭐】
  // debugger;

  const initialContainer = 'container' in app ? app.container : undefined;

  // 渲染 html template
  const legacyRender = 'render' in app ? app.render : undefined; // 兼容 v1 ,v2 弃用 不推荐使用
  const render = getRender(appName, appContent, legacyRender);
  // 渲染初始化的html模板，不包含执行js后生成的dom
  // 【(解决)疑惑: 这里的插入仅仅是为了判断 loading 阶段主应用Container是否存在
  //   在single-spa执行mount的时候会把最终的dom插入到页面】
  // 【期望: 只需判断主应用容器是否存在，而不需要渲染一次页面(多余开销)；或者压根不需要判断，因为mount调用render时还是会判断一次】
  // 在这里render一次是因为后面执行 execScripts 时可能会创建script、style等标签，然后插入到 initialAppWrapperElement 中
  render({ element: initialAppWrapperElement, loading: true, container: initialContainer }, 'loading');
  // console.log(initialAppWrapperElement);
  // debugger;

  // getAppWrapperGetter：获取最初状态的子应用 root 元素（如果支持shadow dom return shadow dom root element）
  // <div id="__qiankun_microapp_wrapper_for_${appInstanceId}__" data-name="${appName}">${template}</div>
  const initialAppWrapperGetter = getAppWrapperGetter(
    appName,
    appInstanceId,
    !!legacyRender,
    strictStyleIsolation,
    scopedCSS,
    () => initialAppWrapperElement,
  );
  // console.log(initialAppWrapperGetter());
  // debugger;

  // 开始处理 运行沙箱
  let global = globalContext; // 全局环境 window
  let mountSandbox = () => Promise.resolve();
  let unmountSandbox = () => Promise.resolve();
  // v2版本loose配置已废弃, useLooseSandbox为false
  const useLooseSandbox = typeof sandbox === 'object' && !!(sandbox as any).loose;
  let sandboxContainer;
  // 创建沙箱 (js执行沙箱、css隔离沙箱、css缓存优化)
  if (sandbox) {
    sandboxContainer = createSandboxContainer(
      appName,
      initialAppWrapperGetter,
      scopedCSS,
      useLooseSandbox,
      excludeAssetFilter,
      global,
    );
    // 用沙箱的代理对象作为接下来使用的全局对象
    global = sandboxContainer.instance.proxy as typeof window;
    // 激活沙箱
    mountSandbox = sandboxContainer.mount;
    // 失活沙箱
    unmountSandbox = sandboxContainer.unmount;
  }

  // 合并内部与外部传入的生命周期
  const {
    beforeUnmount = [],
    afterUnmount = [],
    beforeLoad = [], // QIANKUN环境变量与公共路径设置
    afterMount = [],
    beforeMount = [], // 取消QIANKUN环境变量与公共路径设置
    // getAddOns 中内部生命周期配置 微前端 加载的环境变量 __POWERED_BY_QIANKUN__
  } = mergeWith({}, getAddOns(global, assetPublicPath), lifeCycles, (v1, v2) => concat(v1 ?? [], v2 ?? []));
  // console.log({
  //   beforeUnmount,
  //   afterUnmount,
  //   beforeLoad,
  //   afterMount,
  //   beforeMount,
  // });

  // 立即执行 beforeLoad 钩子(变量&publicPath配置)
  await execHooksChain(toArray(beforeLoad), app, global);

  // 在沙箱中执行 子应用js脚本 返回值：scriptExports 为子应用暴露的钩子
  const scriptExports: any = await execScripts(global, sandbox && !useLooseSandbox); // p1: 全局环境 p2: 是否严格模式

  // 获取&校验子应用暴露的钩子【一般来讲执行子应用入口文件，此时还未执行 render 】
  const { bootstrap, mount, unmount, update } = getLifecyclesFromExports(
    scriptExports,
    appName,
    global,
    sandboxContainer?.instance?.latestSetProp,
  );

  // 主子应用通信(发布订阅那一套)
  const { onGlobalStateChange, setGlobalState, offGlobalStateChange }: Record<string, CallableFunction> =
    getMicroAppStateActions(appInstanceId);

  // FIXME temporary way
  const syncAppWrapperElement2Sandbox = (element: HTMLElement | null) => (initialAppWrapperElement = element);

  // 返回的一系列钩子供 single-spa 适当时机调用
  const parcelConfigGetter: ParcelConfigObjectGetter = (remountContainer = initialContainer) => {

    let appWrapperElement: HTMLElement | null;
    let appWrapperGetter: ReturnType<typeof getAppWrapperGetter>;

    const parcelConfig: ParcelConfigObject = {
      name: appInstanceId,
      // 子应用暴露的bootstrap
      bootstrap,
      // 子应用挂载时调用
      mount: [
        // 【状态机】单实例模式判断，等待其他子应用卸载完成才开始挂载新的子应用
        // 【在调用unmount时，该状态机(promise)会被resolve】
        async () => {
          if ((await validateSingularMode(singular, app)) && prevAppUnmountedDeferred) {
            return prevAppUnmountedDeferred.promise;
          }
          return undefined;
        },
        // 获取当前应用的相关配置
        async () => {
          appWrapperElement = initialAppWrapperElement;
          appWrapperGetter = getAppWrapperGetter(
            appName,
            appInstanceId,
            !!legacyRender,
            strictStyleIsolation,
            scopedCSS,
            () => appWrapperElement,
          );
        },
        async () => {
          const useNewContainer = remountContainer !== initialContainer;
          if (useNewContainer || !appWrapperElement) {
            // console.log('===========');
            // 二次挂载initialContainer(可能)会被销毁，需重新构建一次
            appWrapperElement = createElement(appContent, strictStyleIsolation, scopedCSS, appName);
            syncAppWrapperElement2Sandbox(appWrapperElement);
          }
          // 渲染页面【疑问：二次激活时继续调用render】
          render({ element: appWrapperElement, loading: true, container: remountContainer }, 'mounting');
          // console.log(appWrapperElement);
          // debugger;
        },
        // 激活沙箱
        mountSandbox,
        // 执行内部 beforeMount 钩子
        async () => execHooksChain(toArray(beforeMount), app, global),
        // 执行子应用暴露的mount钩子【子应用执行自己的render】
        async (props) => mount({ ...props, container: appWrapperGetter(), setGlobalState, onGlobalStateChange }),
        // 子应用执行mount钩子后 渲染一次页面【重复渲染，loading实际貌似没啥用】
        async () => render({ element: appWrapperElement, loading: false, container: remountContainer }, 'mounted'),
        // 执行内部 afterMount 钩子
        async () => execHooksChain(toArray(afterMount), app, global),
        // 单实例模式时，存储一个pending状态的promise
        async () => {
          if (await validateSingularMode(singular, app)) {
            prevAppUnmountedDeferred = new Deferred<void>();
          }
        }
      ],
      // 子应用卸载时调用(在子应用激活阶段， single-spa会activeRule未命中时将会触发 unmount)
      unmount: [
        // 执行内部 beforeUnmount 钩子(移除QIANKUN全局变量&publicPath变量)
        async () => execHooksChain(toArray(beforeUnmount), app, global),
        // 执行子应用 unmount 钩子(销毁子应用实例)
        async (props) => unmount({ ...props, container: appWrapperGetter() }),
        // 失活沙箱(缓存free返回得rebuild钩子，等待重建)
        unmountSandbox,
        // 执行 afterUnmount 钩子【start时传入的钩子】
        async () => execHooksChain(toArray(afterUnmount), app, global),
        async () => {
          // 卸载应用(element: null)
          render({ element: null, loading: false, container: remountContainer }, 'unmounted');
          // 关闭状态共享
          offGlobalStateChange(appInstanceId);
          // for gc
          appWrapperElement = null;
          syncAppWrapperElement2Sandbox(appWrapperElement);
        },
        async () => {
          // 子应用卸载完毕，resolve promise. 下一个应用构建时promise不再时pending
          if ((await validateSingularMode(singular, app)) && prevAppUnmountedDeferred) {
            prevAppUnmountedDeferred.resolve();
          }
        },
      ],
    };

    // 手动调用 loadMicroApp 时 子应用增加的update钩子
    if (typeof update === 'function') {
      parcelConfig.update = update;
    }

    return parcelConfig;
  };

  return parcelConfigGetter;
}
