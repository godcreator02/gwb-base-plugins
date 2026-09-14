# gwb-node-cli

**定位**：node 命令行运行器——外部 CLI 的稳定入口，登记即自动镜像成同名总线命令（回执带 stdout / exitCode 那套）。

## 提供

`gwbNodeCli`：`register({ name, description, entry, plugin? })`——entry 指 dist/ 里的编译产物绝对路径；plugin 选填（镜像命令的归属，缺省取调用方包名）

## 依赖

<!-- 来源 ../plugins/node-cli/src/index.ts:80-80 · 新鲜 -->

```ts
  static inject = ['gwbCommands']
```

`gwbCommands`（硬依赖，inject）、`gwbSkills`（局部注入）

## 命令

命令清单不存卡——**经门现扫**（MCP 门 `search`，`plugin` 用包名筛这一组）。
