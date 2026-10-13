# services-drora-extensions

自研接入模块，迁移策略见 `specs/upstream-v3.15.1-migration.md`。
官方业务状态仍由 Agent、scoped Host 和官方远控 manager 持有。这里只做装配、部署选择或展示。
凭据按 origin 捕获，不使用可被其他窗口改变的 active-origin；LAN 以持久化 registry 为身份域。
关闭由宿主生命周期调用，所有业务命令复用官方路径。禁止加入第二份任务队列/会话状态。

知识 Host 装配通过 `@drora/services/node` 暴露。设置读取失败降级为词法检索；Jev 配置每轮解析，不缓存用户凭据。
