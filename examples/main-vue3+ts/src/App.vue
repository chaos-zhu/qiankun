<template>
<div>
  <div class="mainapp">
    <!-- 标题栏 -->
    <header class="mainapp-header">
      <h1>QianKun</h1>
    </header>
    <div class="mainapp-main">
      <!-- 侧边栏 -->
      <ul class="mainapp-sidemenu">
        <li @click="push('/react16')">React16</li>
        <li @click="push('/react15')">React15</li>
        <li @click="push('/vue')">Vue</li>
        <li @click="push('/vue3')">Vue3</li>
        <li @click="push('/angular9')">Angular9</li>
        <li @click="push('/purehtml')">Purehtml</li>
      </ul>
      <!-- 子应用  -->
      <main id="subapp-viewport"></main>
    </div>
  </div>
</div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  methods: {
    push(subapp: string) {
      history.pushState(null, subapp, subapp)
    }
  }
})
</script>

<style lang="scss">
.mainapp-header {
  text-align: left;
}
#subapp-viewport {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}

</style>