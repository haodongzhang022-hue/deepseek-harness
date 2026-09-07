---
name: pixelle-video
description: AI 全自动短视频引擎。输入一个主题即可自动生成短视频，涵盖文案撰写、AI 配图/视频生成、语音解说 TTS、背景音乐与一键合成。当用户想用 AI 自动从主题生成短视频、写视频文案、合成配音、生成视频成片，或调用 Pixelle-Video 平台时使用；通过 REST API（首选）、Python SDK 或 Streamlit Web UI 直接调用。
---

# Pixelle-Video（AI 全自动短视频引擎）

> 版本：v0.2.0（本文档编辑于 2026-08-26，以此为准）
> 克隆位置：`e:/1shuju/1gitgengxin/Pixelle-Video`（上游 `ATH-MaaS/Pixelle-Video`）
> 供 Trae / DeepSeek Harness 等 AI 智能体直接调用，**功能声明 + 用法**一体。

## 1. 功能声明

输入一个**主题**即可端到端完成：撰写旁白 → 生成 AI 配图/视频 → 合成 TTS 语音 → 添加 BGM → ffmpeg 合成 MP4。零剪辑经验。

LLM 支持任意 OpenAI 兼容协议（Qwen / DeepSeek / GPT / Ollama 等）；媒体生成可走云服务（RunningHub）或本地 ComfyUI。调用形态：

| 形态 | 入口 |
|------|------|
| REST API（智能体首选） | `uv run python api/app.py --port 8000` |
| Python SDK | `from pixelle_video.service import PixelleVideoCore` |
| Web UI | `uv run streamlit run web/app.py` |

## 2. 前置配置（首次必须）

```bash
cd e:/1shuju/1gitgengxin/Pixelle-Video
uv sync                       # 安装依赖；需 Python>=3.11 与 ffmpeg
cp config.example.yaml config.yaml
# 编辑 config.yaml：
#   llm.api_key / base_url / model   必填（如 DeepSeek: https://api.deepseek.com / deepseek-chat）
#   comfyui.runninghub_api_key       云服务密钥（推荐）或本地 comfyui_url
```
> `config.yaml` 含密钥，禁止提交。未配 LLM Key 会失败，先测 `/health` 与 `/api/llm/chat` 连通再走生成链路。

## 3. 启动

```bash
uv run python api/app.py --host 0.0.0.0 --port 8000
# Swagger: http://localhost:8000/docs   （接口前缀 /api）
```

## 4. REST API 端点清单

基址 `http://localhost:8000`：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/api/llm/chat` | LLM 通用对话 |
| POST | `/api/tts/synthesize` | 文本转语音 |
| POST | `/api/image/generate` | AI 生图 |
| POST | `/api/content/narration` | 主题→旁白 |
| POST | `/api/content/image-prompt` | 生成配图提示词 |
| POST | `/api/content/title` | 生成标题 |
| POST | `/api/video/generate/sync` | 同步生成视频（<30s） |
| POST | `/api/video/generate/async` | 异步生成视频（返回 task_id） |
| GET | `/api/tasks` / `/api/tasks/{id}` | 任务列表 / 查询状态 |
| DELETE | `/api/tasks/{id}` | 删除任务 |
| POST | `/api/frame/render` | 渲染单帧 |
| GET | `/api/frame/template/params` | 模板参数 |
| GET | `/api/files/{file_path}` | 下载产物（如 final.mp4） |
| GET | `/api/resources/workflows/tts\|image\|media` | 可用工作流 |
| GET | `/api/resources/templates` / `/api/resources/bgm` | 模板 / BGM |

### 端到端示例（智能体推荐流程）

```bash
# 1) 生成旁白
curl -X POST http://localhost:8000/api/content/narration -H "Content-Type: application/json" \
  -d '{"text":"为什么要养成阅读习惯","mode":"generate","n_scenes":5}'
# 2) 异步生成视频
curl -X POST http://localhost:8000/api/video/generate/async -H "Content-Type: application/json" \
  -d '{"text":"为什么要养成阅读习惯","mode":"generate","n_scenes":5,"frame_template":"1080x1920/image_default.html"}'
# 3) 轮询 curl http://localhost:8000/api/tasks/<task_id> 直至 status=completed
# 4) 下载 curl -o final.mp4 http://localhost:8000/api/files/<result.video_url>
```

常用请求参数字段：`text`(主题/文案，必填)、`mode`(`generate`/`fixed`)、`n_scenes`(1-20)、`title`、`frame_template`、`template_params`、`media_workflow`、`tts_workflow`、`ref_audio`(声音克隆)、`prompt_prefix`(风格)、`bgm_path`、`bgm_volume`(默认0.3)。

## 5. Python SDK

```python
import asyncio
from pixelle_video.service import PixelleVideoCore

async def main():
    pixelle = PixelleVideoCore()   # 读 config.yaml
    await pixelle.initialize()
    r = await pixelle.generate_video(text="为什么要养成阅读习惯", mode="generate",
                                     n_scenes=5, frame_template="1080x1920/image_default.html")
    print(r.video_path, r.duration)

asyncio.run(main())
```
需在项目根目录运行。

## 6. 数据与文件

- 生成产物通过 `/api/files/{file_path}` 下载（MP4/音频/图片）。
- 任务结果在 `GET /api/tasks/{id}`，异步生成务必轮询。
- 帧模板在 `templates/`（`1080x1920` 竖屏 / `1080x1080` 方屏 / `1920x1080` 横屏）；工作流在 `workflows/{runninghub,selfhost}/`。

## 7. 排障要点

- 400 错误：多为工作流路径或 API Key 错，先查 `resources/workflows/*` 确认名字；SelfHost 工作流需本机 ComfyUI 先验证。
- TTS 不稳定：本项目锁定 `edge-tts==7.2.7`，勿升级。
- 端口占用：换 `--port` 并在请求基址同步替换。
- 未配 LLM Key 时文案/成片会失败，先测连通。

## 8. 变更记录

- **2026-08-26 (v1)**：新建本调用技能；克隆 `ATH-MaaS/Pixelle-Video`（v0.2.0）至 `1gitgengxin/Pixelle-Video`；整理 REST API 端点清单与端到端用法。