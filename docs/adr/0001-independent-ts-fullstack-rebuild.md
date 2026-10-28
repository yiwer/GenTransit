# 独立重建为 TS 全栈，与旧系统不交换数据

旧平台（rid-rs：Java / Spring Boot + MyBatis；sign-mgt-web：Vue 3 + Ant Design Vue）的站点、线路、站牌集都建在版本链之上，原地删减等于重写持久化层，还会留下与模板、制作、依据等模块的大量耦合残留。决定在 GenTransit 新建项目：前端 React（重新设计视觉与交互语言，组件重建），后端 NestJS + Prisma，前后端同一个 pnpm monorepo；新旧系统运行时互不调用、不同步数据，导入模板也不兼容旧系统导出格式。

## Considered Options

- 在旧仓库原地删减：版本链与跨模块耦合残留过多。
- 新建项目但沿用 Java + Vue：可复用旧代码，但不符合本次 TS 全栈与重做交互体验的选择。

## Consequences

- 旧前端的地图封装、表单、编排编辑器不能直接复用，只作为行为参考。
- 初始数据只能通过新格式的 Excel 导入或手工录入。
