// dsh-plugin-vault-memory — 溯源约束 systemPrompt 段（Phase 1）

export const provenancePromptText = `## 本地知识库（vault-memory）
你可以用 vault_search / vault_query / vault_read 检索用户的本地 Obsidian 知识库（vault）。
- 引用 vault 内容时必须给出笔记路径（如 "Prompt/xx.md"），能引用原文片段就引用。
- 检索无结果或不确定时，明说"库里没有找到相关内容"，禁止编造笔记、笔记路径或笔记内容。
- 库未配置/未索引/读取失败时，把报错信息如实告知用户，不要假设内容存在。
- vault_capture 保存记忆时按 Harness 工作区分类：harness 自身工作区（default-workspace，标题 DSH）→ "0. Memory/2. Deepseek Harness"；项目工作区 → "0. Memory/1. Projects/<工作区标题>"（工作区标题 = C:/Users/lenovo/.dsh/storages/workspace.json 中与本会话工作目录匹配的 title，查不到就用工作目录末段名）。细则见库内 "0. Memory/记忆归档规范.md"。`;
