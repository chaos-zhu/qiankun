import { createApp } from 'vue'
import App from './App.vue'
import './index.scss'

import { registerMicroApps, runAfterFirstMounted, setDefaultMountApp, start, initGlobalState } from '../../../src/index'

createApp(App).mount('#app')

registerMicroApps(
  [
    {
      name: 'react16',
      entry: '//localhost:7100',
      container: '#subapp-viewport',
      activeRule: '/react16',
    },
    {
      name: 'react15',
      entry: '//localhost:7102',
      container: '#subapp-viewport',
      activeRule: '/react15',
    },
    {
      name: 'vue',
      entry: '//localhost:7101',
      container: '#subapp-viewport',
      activeRule: '/vue',
    },
    {
      name: 'purehtml',
      entry: '//localhost:7104',
      container: '#subapp-viewport',
      activeRule: '/purehtml',
    },
    {
      name: 'vue3',
      entry: '//localhost:7105',
      container: '#subapp-viewport',
      activeRule: '/vue3',
    },
  ],
  {
    beforeLoad: [
      // app => {
      //   console.log('[LifeCycle] before load %c%s', 'color: green', app.name)
      // },
    ],
    beforeMount: [
      // app => {
      //   console.log('[LifeCycle] before mount %c%s', 'color: green', app.name)
      // },
    ],
    afterUnmount: [
      // app => {
      //   console.log('[LifeCycle] after unmount %c%s', 'color: green', app.name)
      // },
    ],
  },
)

// function test(params: any) {
//   console.log(params.timeRemaining())
// }

// (requestIdleCallback as any)(test)

// const { onGlobalStateChange, setGlobalState } = initGlobalState({
//   user: 'qiankun',
// })

// onGlobalStateChange((value, prev) => console.log('[onGlobalStateChange - master]:', value, prev))

// setGlobalState({
//   ignore: 'master',
//   user: {
//     name: 'master',
//   },
// })

/**
 * Step3 设置默认进入的子应用
 */
// setDefaultMountApp('/react16')

/**
 * Step4 启动应用
 */
start({
  // prefetch: false,
  sandbox: {
    // strictStyleIsolation: true, // shadow dom
    // experimentalStyleIsolation: true // scope css
  }
})

runAfterFirstMounted(() => {
  console.log('[MainApp] first app mounted')
})
