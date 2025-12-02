# -*- coding: utf-8 -*-
"""
ComfyUI 自定义节点: Point & Prompt (点选提示器)
Human-in-the-loop 多模态提示词编辑节点
"""

import os  # 操作系统路径处理
import json  # JSON 数据解析
import numpy as np  # 数值计算库
import torch  # PyTorch 张量处理
from PIL import Image, ImageDraw  # 图像处理库
import folder_paths  # ComfyUI 文件路径管理


class PointAndPromptNode:
    """
    Point & Prompt 节点类
    功能: 用户在图片上点击生成视觉锚点，系统自动插入对应标签
    """
    
    # ==================== 节点元数据 ====================
    
    @classmethod
    def INPUT_TYPES(cls):
        """
        定义节点的输入类型
        返回包含 required 和 optional 输入的字典
        """
        # 获取 ComfyUI input 目录中的所有图片文件
        input_dir = folder_paths.get_input_directory()  # 获取输入目录路径
        # 列出所有支持的图片格式文件
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f)) 
                 and f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'))]
        
        return {
            "required": {
                # 图片上传控件 - 使用 COMBO 类型实现文件选择
                "image": (sorted(files), {"image_upload": True}),  # 启用图片上传功能
                # 坐标数据 - 前端隐藏此控件
                "points_data": ("STRING", {"default": "[]", "multiline": False}),
                # 提示词文本 - 前端隐藏此控件
                "prompt_text": ("STRING", {"default": "", "multiline": True}),
            },
        }
    
    # 输出类型定义
    RETURN_TYPES = ("IMAGE", "STRING")  # 返回图像张量和字符串
    RETURN_NAMES = ("IMAGE", "prompt")  # 输出端口名称
    
    # 节点功能函数名
    FUNCTION = "process"  # 主处理函数名称
    
    # 节点分类
    CATEGORY = "VisualPrompting"  # 在 ComfyUI 中的分类位置
    
    # 输出节点标记 (允许作为终端节点)
    OUTPUT_NODE = False  # 非输出节点
    
    # ==================== 主处理函数 ====================
    
    def process(self, image, points_data="[]", prompt_text=""):
        """
        主处理函数 - 在 Queue 执行时运行
        
        Args:
            image: 选择的图片文件名
            points_data: JSON 格式的坐标点数据 [{"x": 0.5, "y": 0.3, "index": 1}, ...]
            prompt_text: 前端传递的提示词文本
            
        Returns:
            tuple: (渲染后的图像张量, 最终提示词字符串)
        """
        
        # ========== 1. 读取图片资源 ==========
        image_path = folder_paths.get_annotated_filepath(image)  # 获取完整文件路径
        pil_image = Image.open(image_path).convert("RGB")  # 打开并转换为 RGB 模式
        
        # 获取图片尺寸
        img_width, img_height = pil_image.size  # 宽度和高度
        
        # ========== 2. 解析坐标点数据 ==========
        try:
            points = json.loads(points_data)  # 解析 JSON 字符串
        except json.JSONDecodeError:
            points = []  # 解析失败则使用空列表
        
        # ========== 3. 绘制视觉标记 ==========
        if points and len(points) > 0:
            pil_image = self._draw_markers(pil_image, points, img_width, img_height)
        
        # ========== 4. 转换为 Tensor 格式 ==========
        # ComfyUI 图像格式: [batch, height, width, channels], 值范围 0-1
        img_array = np.array(pil_image).astype(np.float32) / 255.0  # 归一化到 0-1
        img_tensor = torch.from_numpy(img_array)  # 转换为 PyTorch 张量
        img_tensor = img_tensor.unsqueeze(0)  # 添加 batch 维度 [1, H, W, C]
        
        # ========== 5. 构建最终提示词 ==========
        final_prompt = prompt_text
        
        # 如果有标记点，在末尾添加移除标记点的提示
        if points and len(points) > 0:
            if final_prompt:
                final_prompt = final_prompt.strip() + " (remove marker points)"
            else:
                final_prompt = "(remove marker points)"
        
        # ========== 6. 返回结果 ==========
        return (img_tensor, final_prompt)
    
    # ==================== 辅助方法 ====================
    
    def _draw_markers(self, image, points, img_width, img_height):
        """
        在图片上绘制视觉标记 (使用 RGBA 图层合成，参考 comfy_imagecrop 实现)
        
        Args:
            image: PIL Image 对象
            points: 坐标点列表 [{"x": 相对x, "y": 相对y, "index": 序号}, ...]
            img_width: 图片宽度
            img_height: 图片高度
            
        Returns:
            PIL Image: 绘制标记后的图片
        """
        # 转换为 RGBA 模式以支持透明度
        if image.mode != 'RGBA':
            result_image = image.convert('RGBA')
        else:
            result_image = image.copy()
        
        # 创建透明绘图层
        overlay = Image.new('RGBA', result_image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        
        # 计算标记大小 (基于图片尺寸自适应，缩小20%)
        marker_radius = max(14, min(img_width, img_height) // 40)  # 标记半径 (更小)
        outline_width = max(2, marker_radius // 10)  # 描边宽度
        
        # 颜色定义 (RGBA 格式，90% 透明度 = 230/255)
        marker_color = (30, 144, 255, 230)  # 蓝色背景 90%
        text_color = (255, 255, 255, 230)  # 白色文字 90%
        outline_color = (255, 255, 255, 230)  # 白色描边 90%
        
        # 遍历所有点并绘制标记
        for point in points:
            rel_x = point.get("x", 0)
            rel_y = point.get("y", 0)
            index = point.get("index", 1)
            
            # 转换为绝对像素坐标
            abs_x = int(rel_x * img_width)
            abs_y = int(rel_y * img_height)
            
            # 绘制外圈描边
            draw.ellipse(
                [
                    abs_x - marker_radius - outline_width,
                    abs_y - marker_radius - outline_width,
                    abs_x + marker_radius + outline_width,
                    abs_y + marker_radius + outline_width
                ],
                fill=outline_color
            )
            
            # 绘制内圈蓝色背景
            draw.ellipse(
                [
                    abs_x - marker_radius,
                    abs_y - marker_radius,
                    abs_x + marker_radius,
                    abs_y + marker_radius
                ],
                fill=marker_color
            )
            
            # 绘制数字 (使用几何绘制，最可靠)
            self._draw_number_geometric(draw, abs_x, abs_y, index, marker_radius, text_color)
        
        # 合并图层
        result_image = Image.alpha_composite(result_image, overlay)
        
        # 转换回 RGB
        return result_image.convert('RGB')
    
    def _draw_number_geometric(self, draw, cx, cy, number, radius, color):
        """
        使用纯几何图形绘制数字 (优化的粗体风格，更易辨认)
        
        Args:
            draw: ImageDraw 对象
            cx: 中心 X 坐标
            cy: 中心 Y 坐标
            number: 要绘制的数字
            radius: 标记半径
            color: 绘制颜色
        """
        num_str = str(number)
        
        # 计算数字尺寸
        digit_height = int(radius * 1.0)  # 数字高度
        digit_width = int(radius * 0.55)  # 单个数字宽度
        spacing = int(radius * 0.15)  # 数字间距
        line_width = max(2, radius // 5)  # 线条粗细
        
        # 计算总宽度和起始位置
        total_width = len(num_str) * digit_width + (len(num_str) - 1) * spacing
        start_x = cx - total_width // 2
        
        # 绘制每个数字
        for i, digit_char in enumerate(num_str):
            digit = int(digit_char)
            digit_cx = start_x + i * (digit_width + spacing) + digit_width // 2
            self._draw_single_digit(draw, digit_cx, cy, digit, digit_width, digit_height, line_width, color)
    
    def _draw_single_digit(self, draw, cx, cy, digit, width, height, line_width, color):
        """
        绘制单个数字 (优化的粗体7段风格)
        """
        hw = width // 2  # 半宽
        hh = height // 2  # 半高
        gap = line_width // 2  # 段落间隙
        
        # 7段显示器的段落定义 (使用粗线条)
        # a: 顶部横线, b: 右上竖线, c: 右下竖线
        # d: 底部横线, e: 左下竖线, f: 左上竖线, g: 中间横线
        
        segments = {
            'a': [(cx - hw + gap, cy - hh), (cx + hw - gap, cy - hh)],  # 顶
            'b': [(cx + hw, cy - hh + gap), (cx + hw, cy - gap)],  # 右上
            'c': [(cx + hw, cy + gap), (cx + hw, cy + hh - gap)],  # 右下
            'd': [(cx - hw + gap, cy + hh), (cx + hw - gap, cy + hh)],  # 底
            'e': [(cx - hw, cy + gap), (cx - hw, cy + hh - gap)],  # 左下
            'f': [(cx - hw, cy - hh + gap), (cx - hw, cy - gap)],  # 左上
            'g': [(cx - hw + gap, cy), (cx + hw - gap, cy)],  # 中
        }
        
        # 每个数字对应的段落
        digit_segments = {
            0: ['a', 'b', 'c', 'd', 'e', 'f'],
            1: ['b', 'c'],
            2: ['a', 'b', 'g', 'e', 'd'],
            3: ['a', 'b', 'g', 'c', 'd'],
            4: ['f', 'g', 'b', 'c'],
            5: ['a', 'f', 'g', 'c', 'd'],
            6: ['a', 'f', 'e', 'd', 'c', 'g'],
            7: ['a', 'b', 'c'],
            8: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
            9: ['a', 'b', 'c', 'd', 'f', 'g'],
        }
        
        # 绘制段落 (使用圆角端点)
        for seg_name in digit_segments.get(digit, []):
            if seg_name in segments:
                start, end = segments[seg_name]
                # 使用圆角线条
                draw.line([start, end], fill=color, width=line_width)
                # 在端点绘制小圆形，使线条更圆润
                r = line_width // 2
                draw.ellipse([start[0]-r, start[1]-r, start[0]+r, start[1]+r], fill=color)
                draw.ellipse([end[0]-r, end[1]-r, end[0]+r, end[1]+r], fill=color)
    
    # ==================== 验证方法 ====================
    
    @classmethod
    def IS_CHANGED(cls, image, **kwargs):
        """
        检测输入是否变化，用于缓存控制
        
        Returns:
            str: 变化标识符
        """
        # hidden 字段通过 kwargs 获取
        points_data = kwargs.get("points_data", "[]")
        prompt_text = kwargs.get("prompt_text", "")
        return f"{image}_{points_data}_{prompt_text}"
    
    @classmethod
    def VALIDATE_INPUTS(cls, image, **kwargs):
        """
        验证输入参数
        
        Returns:
            bool 或 str: True 表示有效，字符串表示错误信息
        """
        # 验证图片文件是否存在
        if not folder_paths.exists_annotated_filepath(image):
            return f"图片文件不存在: {image}"  # 返回错误信息
        
        return True  # 验证通过


# ==================== 节点注册 ====================

# 节点类映射 - ComfyUI 用于识别节点
NODE_CLASS_MAPPINGS = {
    "PointAndPromptNode": PointAndPromptNode  # 节点标识符 -> 节点类
}

# 节点显示名称映射 - ComfyUI 界面显示
NODE_DISPLAY_NAME_MAPPINGS = {
    "PointAndPromptNode": "Point & Prompt (点选提示器)"  # 节点标识符 -> 显示名称
}

# Web 扩展目录 - 指定前端 JS 文件位置
WEB_DIRECTORY = "./js"  # 相对于当前目录的 js 文件夹
