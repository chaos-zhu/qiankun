/* eslint-disable no-param-reassign */
/**
 * @author Kuitos
 * @since 2019-04-11
 */

import { noop } from 'lodash';

const rawWindowInterval = window.setInterval;
const rawWindowClearInterval = window.clearInterval;

export default function patch(global: Window) {
  let intervals: number[] = [];

  global.clearInterval = (intervalId: number) => {
    intervals = intervals.filter((id) => id !== intervalId);
    return rawWindowClearInterval.call(window, intervalId as any);
  };

  global.setInterval = (handler: CallableFunction, timeout?: number, ...args: any[]) => {
    const intervalId = rawWindowInterval(handler, timeout, ...args);
    // 记录所有定时器ID
    intervals = [...intervals, intervalId];
    return intervalId;
  };

  return function free() {
    intervals.forEach((id) => global.clearInterval(id)); // 卸载子应用时清空所有定时器
    // 还原setInterval
    global.setInterval = rawWindowInterval;
    global.clearInterval = rawWindowClearInterval;

    return noop;
  };
}
