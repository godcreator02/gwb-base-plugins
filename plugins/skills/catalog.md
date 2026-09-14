# gwb-skills

**定位**：说明书的收集与查询——各插件 skills/ 目录经它挂给 agent，全局单一命名空间（撞名的后到不挂）。

## 提供

`gwbSkills`：register(url) 挂一个 skills/ 目录（局部注入，报 file:// 地址）/ list() 现列 / read(name, file?) 读正文

## 依赖

<!-- 来源 ../plugins/skills/src/index.ts:55-55 · 新鲜 -->

```ts
  static inject = ['gwbCommands']
```

`gwbCommands`（硬依赖，inject）

## 命令

命令清单不存卡——**现扫 `/surface`**（`?plugin=gwb-skills` 取这一组的形状）。
