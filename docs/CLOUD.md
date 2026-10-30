# 云端文字处理配置

默认 TEXT_PROVIDER=mock，任何文字处理都为模拟。仅把凭据放入环境不会自动开启云端，需显式选择 ark。选择 ark 但缺少或错误配置时启动失败，不会静默返回模拟结果。

在启动应用的进程环境配置：
- TEXT_PROVIDER：ark
- ARK_API_KEY：火山方舟 API Key
- ARK_MODEL：你账号可调用的模型标识或推理接入点
- TEXT_TIMEOUT_MS：可选，默认30000，范围1—120000毫秒

随后启动 npm start。页面会展示云端状态，每次提交请求需带明确文本上传授权。浏览器不会收到密钥，也不能指定服务地址。取消会传递到服务端及上游连接；不能保证供应商停止计费或撤回已上传文字。

原型只从进程环境读取凭据，不写入项目、浏览器存储或日志。不要把真实密钥填写到转写文本或提交到代码仓库；当前 .env 文件不会自动加载。桌面版的系统凭据存储尚待实现，环境变量方案仅用于开发者原型。

接口固定为 https://ark.cn-beijing.volces.com/api/v3/chat/completions，使用 Bearer 鉴权和非流式 messages 请求。输出读取 choices[0].message.content。禁用自动跳转、超时覆盖响应读取、限制返回体1MiB，不自动重试避免重复费用；错误只显示分类提示，不回显供应商错误正文。

参考：火山官方SDK示例 https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkexamples/volcenginesdkarkruntime/completions.py 。官方接口文档 https://www.volcengine.com/docs/82379/1494384 在本轮网页检索中无法读取，因此接口仍需账号真实调用验收。自动测试用本地HTTP替身，不能代表真实云端或模型质量通过。
