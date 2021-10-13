// async函数返回一个Promise对象
// await用于等待一个表达式的返回值
// 注意：表达式可以是一个任意的数据类型(除了arrow function)
// await 表达式会暂停当前 async function 的执行，等待 Promise 处理完成

// 若 Promise 正常处理(fulfilled)，其回调的resolve函数参数作为 await 表达式的值，继续执行 async function
// 如果 await 操作符后的表达式的【值】不是一个 Promise，则返回该值本身
// 若 Promise 处理异常(rejected)，await 表达式会把 Promise 的异常原因抛出，且await后面代码不再执行

async function async1() {
  // 没搞懂下面这两种写法有啥区别？得到的答案完全不一样
  await async2();
  // await new Promise((res) => {
  //   res();
  // });
  console.log(2);
}
async function async2() {
  return new Promise((res) => {
    res();
  });
}

async1();

new Promise(function(resolve) {
  resolve();
}).then(function() {
  console.log(7);
}).then(function() {
  console.log(7);
});
