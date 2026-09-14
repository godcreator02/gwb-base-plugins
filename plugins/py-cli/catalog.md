# gwb-py-cli

**定位**：python 命令行运行器——venv 守卫自建在消费方插件包根（py/ 下），跑前重验版本；登记即镜像成总线命令。

## 提供

`gwbPyCli`：`register({ name, description, packageRoot, distName, version, command })`——后四样要跟 pyproject.toml 对得上

## 依赖

<!-- 来源 ../plugins/py-cli/src/index.ts:94-94 · 未确认 -->

```ts
  static inject = ['gwbCommands']
```

`gwbCommands`（硬依赖，inject）、`gwbSkills`（局部注入）

## 命令

命令清单不存卡——**现扫 `/surface`**（`?plugin=gwb-py-cli` 取这一组的形状）。
