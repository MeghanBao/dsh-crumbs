# dsh-crumbs

[English](./README.md) · [中文](./README.zh.md)

**用一条小小的真知识，填满干等的空隙。** 长任务在跑时，`dsh-crumbs` 冒出一条简短、经过核实的「碎屑」（crumb），内容跟你正在等的事相关；任务一结束，它立刻退场。

它**不碰** agent 的上下文、**不改**任务、**不出现在结果里**。它是给盯着转圈圈的人看的，不是给模型看的。

```
⏳ 正在执行： "git rebase --onto main feature~3 feature"

   💡 Git 是 Linus Torvalds 2005 年在几天之内写出来的——起因是 Linux 一直用的
      那个工具撤销了免费授权。

✅ 任务完成 —— 碎屑已清除。
```

## 为什么做这个

所有「长任务 agent」工具优化的都是同一件事：让 agent **无人值守**地跑——暂停/恢复、上下文压缩、状态轮询。但很多时候人**就在盯着**：本地跑、CLI 会话、非技术用户。这段「人在、注意力在、却无事可做」的时间，是块没人填的空白。加载页小贴士是静态且不相关的；通用冷知识 bot 又跟你在干什么无关。`dsh-crumbs` 就是填这个缝的小东西。

它是 [dsh-backstory](https://github.com/MeghanBao/dsh-backstory) 的兄弟：那个给代码补回「为什么」，这个给等待补回一点「意义」。

## 安装

```sh
dsh plugin add dsh-crumbs
```

## 三种出现方式

1. **等待时自动出现。** 当一个长任务工具调用（比如 shell 命令）跑超过 `minTaskMs`，碎屑就每隔 `intervalMs` 冒进通知区，并按你正在等的命令轻度选题——`git` 命令偏向编程冷知识，`planet` 偏向天文；否则就是完整的跨领域随机库。任务返回时自动停止并清除。
2. **`/crumb` 命令** —— 随手要一条：`/crumb`、`/crumb git`、`/crumb concrete`。
3. **`crumb` 工具** —— 模型可直接调用；命令内部用它，任何想要一条冷知识的 agent 流程也能用。

## `crumb` 工具

| 参数 | 类型 | 说明 |
|------|------|------|
| `topic` | string，可选 | 主题提示（`"concrete"`、`"git"`、`"space"`）。不填则任意主题。 |
| `mode` | `"fact"` \| `"quiz"` | `fact`（默认）直接陈述；`quiz` 先抛问、再揭晓答案。 |

最近出过的碎屑会被回避，所以反复调用内容会变。

## 配置

一切默认开启、可随时关闭，且都有安全默认值。

- **环境变量：** `DSH_CRUMBS_DISABLE=1` 完全关闭「长任务自动出现」（`/crumb` 命令和 `crumb` 工具仍可用）。
- **按仓库：** `.dsh/crumbs.config.json`

```jsonc
{
  "autoSurface": true,   // 长任务期间自动冒碎屑
  "minTaskMs": 8000,     // 任务至少跑这么久才触发
  "intervalMs": 12000,   // 任务持续时，两条碎屑之间的间隔
  "mode": "fact",        // "fact" | "quiz"
  "source": "auto",      // "pool" | "model" | "auto"（见下）
  "longTools": ["bash", "shell", "exec", "run"]  // 哪些工具调用算「长任务」
}
```

## 碎屑从哪来

| `source` | 行为 |
|----------|------|
| `pool` | 只用精选、经核实的静态库。零成本、离线、绝对准确。 |
| `model` | 由一个**侧模型**现生成一条——最好就讲你正在等的这件事。没有可用模型时返回空。 |
| `auto`（默认） | 先试侧模型；不可用或没生成出来，就回落静态库。 |

有两点必须讲清楚：

- **模型是「侧」调用。** 它绝不在主 agent 的上下文里跑、也不往里写。生成碎屑不会污染或拖慢你正在等的任务。如果 host 没有暴露模型接口（离线、内网隔离、没 endpoint），`auto` 会静默回落到静态库，插件永远能用。
- **模型碎屑未经核实。** 它们回来时带 `verified: false`，用 `✨` 渲染（静态库碎屑用 `💡`、`verified: true`）。现生成的冷知识可能一本正经地错——插件明确告诉模型绝不引用/据此推理，你也应把 `✨` 那些当消遣、别当事实。

## 碎屑库

碎屑都在 [`data/crumbs.json`](./data/crumbs.json) —— 精选、经核实、通用不限领域。标签覆盖 `coding`、`science`、`space`、`nature`、`history`、`geography`、`language`、`math`、`art`、`food`、`body`。每条都有一段 `text` 陈述，外加一个 `quiz` 问答形式。主题相关性靠的是「当前任务关键词 ↔ 标签」的纯匹配——不调模型、不联网。

碎屑是消遣，不是事实来源。它们在我们能力范围内力求准确，但插件明确告诉模型：不要引用它、也不要基于它继续推理。

## 不装 host 也能试

```sh
node --experimental-strip-types scripts/demo.ts --topic "git rebase" --task 9000
node --experimental-strip-types scripts/demo.ts --topic "octopus" --mode quiz
node --experimental-strip-types scripts/demo.ts --source auto --mock-model   # 看 ✨ 现生成路径 + 静态库回落
```

## 开发

```sh
npm test          # 24 个单元测试：库解析、排序、主题选题、配置
npm run demo      # 在终端里看等待体验
```

目录结构：

```
src/crumbs.ts   库的 加载/排序/挑选/渲染   （纯函数）
src/topic.ts    任务文本 → 主题标签         （纯函数）
src/source.ts   pool / model / auto 三种碎屑来源（纯函数 + best-effort 调用）
src/config.ts   环境变量 + 按仓库配置        （纯函数）
src/skill.ts    /crumb 命令载荷             （纯函数）
src/index.ts    插件：crumb 工具 + 长任务钩子 + skill 接线
data/crumbs.json  精选碎屑库
```

## 许可证

MIT © MeghanBao
