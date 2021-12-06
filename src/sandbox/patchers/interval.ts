/* eslint-disable no-param-reassign */
/**
 * @author Kuitos
 * @since 2019-04-11
 */

import { noop } from 'lodash';

const rawWindowInterval = window.setInterval;
const rawWindowClearInterval = window.clearInterval;

// 【关键】记录子应用所有的定时器，在卸载时清空它们(setTimeout无需劫持)
// 如果调用原生的window interval，子应用卸载时无法知道有哪些定时器需要清除
// 【方式2】在创建沙箱时，使用Object.defineProperty劫持setInterval和clearInterval可以做到同样效果
export default function patch(global: Window) {
  let intervals: number[] = []; // 用于记录调用过的定时器

  global.clearInterval = (intervalId: number) => {
    // 清空定时器，移除对应的id
    intervals = intervals.filter((id) => id !== intervalId);
    return rawWindowClearInterval.call(window, intervalId as any);
  };

  global.setInterval = (handler: CallableFunction, timeout?: number, ...args: any[]) => {
    const intervalId = rawWindowInterval(handler, timeout, ...args);
    // 记录所有定时器ID
    intervals = [...intervals, intervalId];
    return intervalId;
  };

  // 返回free函数，取消劫持
  return function free() {
    intervals.forEach((id) => global.clearInterval(id)); // 卸载子应用时清空所有定时器，防止内存泄漏
    // 还原setInterval
    global.setInterval = rawWindowInterval;
    global.clearInterval = rawWindowClearInterval;
    return noop;
  };
}
