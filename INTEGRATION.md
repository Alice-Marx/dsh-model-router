# Bot 一体化工程

当前按已确认的 **1.1 方案**实施，最终范围保持不变。

- [完整方案与全部附录](docs/integration/plan/20261026_master_plan.md)
- [当前进度、待办与接手说明](docs/integration/PROGRESS.md)
- [机器可读任务台账](docs/integration/tasks.json)
- [需求、功能与验收目录](docs/integration/scope.json)
- [冻结源码与功能出处](docs/integration/feature-inventory.json)
- [M0 实机/组合结论与后续缺口](docs/integration/M0_FINDINGS.md)
- [逐入口行为审查](docs/integration/behavior-audit.json)

在项目根目录运行：

```sh
npm run integration:status
npm run integration:check
npm run test:integration
```

任务完成、验收通过和完整版本可发布分别记录。M0 的单元测试或探针通过不会自动将产品功能标为完成。
