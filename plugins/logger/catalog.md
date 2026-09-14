# gwb-logger

**定位**：日志管道（core）——kernel / plugin / renderer 三路汇进 `<home>/gwb.log` 与日志窗格；插件说话的正规出口是 ctx.logger，不是 console。

## 提供

`gwbLogger`：薄服务面留空：消费方一律 ctx.logger(名) 写；本件挂第二个 cordis exporter 收历史、经内核桥推窗格

## 依赖

<!-- 来源 ../plugins/logger/src/index.ts:21-21 · 未确认 -->

```ts
export const inject = ['gwbCommands']
```

`gwbCommands`（硬依赖，inject）

## 命令

命令清单不存卡——**现扫 `/surface`**（`?plugin=gwb-logger` 取这一组的形状）。
