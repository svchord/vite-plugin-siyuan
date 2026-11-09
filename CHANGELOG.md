# Changelog

## [0.3.2](https://github.com/svchord/vite-plugin-siyuan/compare/v0.3.1...v0.3.2) (2026-11-09)


### Bug Fixes

* 按内核自报工作区解析安装目录 ([daca244](https://github.com/svchord/vite-plugin-siyuan/commit/daca244b470b2f56430b357113d196c6c837473a))

## [0.3.1](https://github.com/svchord/vite-plugin-siyuan/compare/v0.3.0...v0.3.1) (2026-11-09)


### Bug Fixes

* 精简用户可见日志并修正构建完成信号 ([5183453](https://github.com/svchord/vite-plugin-siyuan/commit/518345312a31a6bece70c11a65a2027caa1284ab))

## [0.3.0](https://github.com/svchord/vite-plugin-siyuan/compare/v0.2.0...v0.3.0) (2026-11-08)


### ⚠ BREAKING CHANGES

* 清单必须放在 public/ 下，项目根布局不再支持。

### Features

* 只有 README 从项目根搬，其余一律 public/ ([1e849bc](https://github.com/svchord/vite-plugin-siyuan/commit/1e849bc358d70bb02064cc4ce6d90586c370c4a8))
* 清单只从 public/ 读 ([8315cac](https://github.com/svchord/vite-plugin-siyuan/commit/8315caccf8c0373557b7544d7a58d6212c11d635))


### Bug Fixes

* 按实际 publicDir 找清单，README 以 public 优先 ([349b6bf](https://github.com/svchord/vite-plugin-siyuan/commit/349b6bffa3ff72f82bf4e7c7f140365ab9943709))

## [0.2.0](https://github.com/svchord/vite-plugin-siyuan/compare/v0.1.0...v0.2.0) (2026-11-08)


### ⚠ BREAKING CHANGES

* siyuan() 现在必须传 entry。

### Features

* entry 改为必填 ([43bab8d](https://github.com/svchord/vite-plugin-siyuan/commit/43bab8d96bdb7ac3e1f4e507376b3f0eeecfd52c))


### Bug Fixes

* 清单探测不再默认扫 dist/ ([412f53a](https://github.com/svchord/vite-plugin-siyuan/commit/412f53a6143f6340ac24250b53186b7765f09578))
