# ComfyUI-PointAndPrompt

**Point & Prompt (点选提示器)** - Human-in-the-loop 多模态提示词编辑节点

## 功能特性

- 🖼️ **实时图片预览** - 选择图片后立即在节点上显示，无需等待 Queue 运行
- 🎯 **可视化标记** - 在图片上点击生成带圈数字标记 (①②③...)
- 📝 **富文本编辑** - 自动在文本框中插入对应的胶囊标签
- 🔥 **标记烧录** - 执行时将标记永久绘制到输出图像上

## 安装方法

### 方法一：手动安装
1. 将 `ComfyUI-PointAndPrompt` 文件夹复制到 ComfyUI 的 `custom_nodes` 目录
2. 重启 ComfyUI

### 方法二：Git Clone
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/your-repo/ComfyUI-PointAndPrompt.git
```

## 使用说明

### 节点位置
在 ComfyUI 节点菜单中找到：`VisualPrompting` → `Point & Prompt (点选提示器)`

### 操作步骤
1. **上传图片** - 点击 image 控件选择本地图片
2. **添加标记** - 在预览图上点击想要标注的位置
3. **编辑指令** - 在文本框中输入描述，标记会自动插入
4. **执行工作流** - 点击 Queue 运行，输出带标记的图像和提示词

### 输入输出

| 端口 | 类型 | 说明 |
|------|------|------|
| image | Widget | 图片上传控件 |
| IMAGE | 输出 | 带标记的图像 Tensor |
| prompt | 输出 | 最终提示词字符串 |

## 依赖

- ComfyUI (最新版本)
- Pillow (PIL)
- PyTorch
- NumPy

## 许可证

MIT License

## 更新日志

### v1.0.0
- 初始版本发布
- 实现实时图片预览
- 实现点击标记功能
- 实现标记烧录到输出图像
