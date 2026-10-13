# 积分卡 Android 应用

安装文件：`dist/points-card-1.0.0.apk`，应用名称“积分卡”，包名 `cn.yaoyao.pointscard`。

## 使用

1. 将 APK 下载到安卓手机或学习机，点击安装；系统提示时允许该下载来源安装应用。
2. 首次打开没有预置课程和积分，可直接添加课程并打卡。页面、样式和图标内置于 APK，无需启动电脑服务。
3. 需要与电脑共享时，点击右上角“同步设置”，填写电脑服务地址，例如 `http://电脑IP:4173`。
4. 同一局域网的设备访问同一电脑服务；电脑需保持开机且服务运行。Android App 可通过原生网络连接 HTTP 局域网服务，不依赖 PWA 安装的 HTTPS 条件。
5. 离线时改动留在应用中，恢复连接后同步；已在手机添加的课程与电脑课程合并，打卡不会重复积分。
6. 同步地址留空会停止共享同步，继续本机保存。切换到其他服务时，待同步的本机改动将合并到新服务。

最低 Android API 为 23（Android 6.0），目标 API 为 35。应用依赖系统 Android System WebView；系统较旧的学习机需使用支持现代 JavaScript 的 WebView。是否允许安装 APK 取决于学习机的管理权限。

应用数据保存在 Android 应用私有存储，卸载或“清除应用数据”会删除本机记录。用相同签名覆盖安装新版本通常保留记录。

## 构建

在项目目录用 PowerShell 7 执行：

```powershell
./scripts/prepare-android.ps1
./scripts/build-android.ps1
./scripts/verify-android.ps1
```

- 工具下载到 `.local-data/android-toolchain/`，不改动系统 Java 或 Android SDK 设置。SDK 和库来自 Google，JDK 来自 Eclipse Temurin，并核对下载校验和。
- 使用 Android 官方 AAPT2、D8、zipalign、apksigner 编译和签名，不依赖 Android Studio 或 Gradle。
- Android 使用 AndroidX WebViewAssetLoader 从应用内置的 HTTPS 来源加载页面；JavaScript 接口只连接本机页面，网络操作只访问设置地址的 `/api/state`。
- 仅申请 INTERNET 权限，不申请文件、相机、定位或联系人权限。
- 签名密钥和密码在 `.local-data/android-signing/`，均不进入 APK。请妥善备份此目录，后续覆盖安装需要使用同一密钥。不要公开分享该目录。
- 更新版本时修改 `android/app/src/main/AndroidManifest.xml` 的 `versionCode` / `versionName` 和构建脚本的输出文件名。

## 验证

- `node tests/android.test.cjs`：用 Playwright 模拟 Android JavaScript 接口，验证本机保存、可选同步、离线恢复和手机布局。测试服务使用临时目录，不改动正式记录。
- `node tests/pwa.test.cjs`：验证原有网页安装、离线和同步功能。
- 构建时校验 APK 签名与安装清单；`verify-android.ps1` 额外检查 ZIP 结构和打包资源，排除私钥、服务端数据与测试数据。
- 尚未连接真实 Android 设备进行安装测试；浏览器的接口模拟不代替实机测试。

AndroidX 组件遵循 Apache License 2.0。官方资料：[本地页面加载](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)、[APK 签名校验](https://developer.android.com/tools/apksigner)。
