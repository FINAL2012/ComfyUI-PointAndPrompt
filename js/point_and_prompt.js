/**
 * ComfyUI 自定义节点: Point & Prompt (点选提示器)
 * 前端 JavaScript 扩展 - 实现实时预览和点击交互
 */

import { app } from "../../scripts/app.js";  // ComfyUI 应用实例
import { api } from "../../scripts/api.js";  // ComfyUI API 接口

// 注册扩展
app.registerExtension({
    name: "Comfy.PointAndPrompt",  // 扩展唯一标识符
    
    /**
     * 节点创建前的钩子函数
     * @param {Object} nodeType - 节点类型对象
     * @param {Object} nodeData - 节点数据
     * @param {Object} appInstance - 应用实例
     */
    async beforeRegisterNodeDef(nodeType, nodeData, appInstance) {
        // 仅处理 PointAndPromptNode 节点
        if (nodeData.name !== "PointAndPromptNode") {
            return;  // 非目标节点直接返回
        }
        
        // 保存原始 onNodeCreated 方法
        const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
        
        /**
         * 节点创建时的回调
         */
        nodeType.prototype.onNodeCreated = function() {
            // 调用原始方法
            if (originalOnNodeCreated) {
                originalOnNodeCreated.apply(this, arguments);
            }
            
            // ========== 初始化节点状态 ==========
            this.pointsData = [];  // 存储点击坐标数据
            this.promptText = "";  // 存储提示词文本
            this.currentImage = null;  // 当前显示的图片元素
            this.imageUrl = null;  // 当前图片 URL
            this._isNewNode = true;  // 标记是否为新建节点
            
            // ========== 创建 UI 组件 ==========
            this._createImagePreview();  // 创建图片预览区域
            this._createPromptInput();   // 创建提示词输入框
            this._setupImageWidget();    // 设置图片选择控件
            
            // ========== 隐藏后端定义的控件 ==========
            setTimeout(() => {
                this._hideBackendWidgets();
            }, 50);
            
            // ========== 设置节点尺寸 ==========
            this.size = [420, 520];  // 默认节点尺寸 [宽, 高]
            this.serialize_widgets = true;  // 序列化控件状态
            
            // 禁止节点缩放 (避免标记点坐标偏移问题)
            this.resizable = false;
            
            // 禁用默认图片预览
            this.imgs = null;  // 清空图片数组，阻止默认预览
        };
        
        /**
         * 禁止节点缩放
         */
        nodeType.prototype.onResize = function() {
            // 强制保持固定尺寸
            this.size = [420, 520];
        };
        
        /**
         * 隐藏后端定义的控件并移除输入端口
         */
        nodeType.prototype._hideBackendWidgets = function() {
            if (!this.widgets) return;
            
            for (let i = this.widgets.length - 1; i >= 0; i--) {
                const widget = this.widgets[i];
                // 隐藏 points_data 和 prompt_text 控件 (由前端自定义 UI 管理)
                if (widget.name === "points_data" || widget.name === "prompt_text") {
                    // 完全隐藏控件
                    widget.type = "converted-widget";
                    widget.computeSize = () => [0, -4];
                    widget.serializeValue = async () => widget.value;
                    // 隐藏 DOM 元素
                    if (widget.inputEl) {
                        widget.inputEl.style.display = "none";
                    }
                    if (widget.element) {
                        widget.element.style.display = "none";
                    }
                }
            }
            
            // 移除 points_data 和 prompt_text 的输入端口
            if (this.inputs) {
                for (let i = this.inputs.length - 1; i >= 0; i--) {
                    const input = this.inputs[i];
                    if (input.name === "points_data" || input.name === "prompt_text") {
                        this.removeInput(i);
                    }
                }
            }
        };
        
        /**
         * 重写 onDrawBackground 阻止默认图片预览绘制
         */
        const originalOnDrawBackground = nodeType.prototype.onDrawBackground;
        nodeType.prototype.onDrawBackground = function(ctx) {
            // 确保不绘制默认图片预览
            this.imgs = null;
            
            if (originalOnDrawBackground) {
                originalOnDrawBackground.apply(this, arguments);
            }
        };
        
        /**
         * 创建图片预览区域
         */
        nodeType.prototype._createImagePreview = function() {
            const node = this;  // 保存节点引用
            
            // 定义容器尺寸 (用于坐标计算)
            this.CONTAINER_WIDTH = 400;   // 容器宽度
            this.CONTAINER_HEIGHT = 250;  // 容器高度
            
            // 创建图片预览容器
            const previewContainer = document.createElement("div");
            previewContainer.style.cssText = `
                position: relative;
                width: 100%;
                height: ${this.CONTAINER_HEIGHT}px;
                background: #1a1a1a;
                border: 1px solid #333;
                border-radius: 4px;
                overflow: hidden;
                cursor: crosshair;
            `;
            
            // 创建图片元素
            const imgElement = document.createElement("img");
            imgElement.style.cssText = `
                width: 100%;
                height: 100%;
                object-fit: contain;
                display: none;
            `;
            previewContainer.appendChild(imgElement);
            
            // 创建占位文本
            const placeholder = document.createElement("div");
            placeholder.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                color: #666;
                font-size: 14px;
                text-align: center;
            `;
            placeholder.textContent = "选择文件上传";
            previewContainer.appendChild(placeholder);
            
            // 创建标记覆盖层
            const markerOverlay = document.createElement("div");
            markerOverlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
            `;
            previewContainer.appendChild(markerOverlay);
            
            // 保存元素引用
            this.previewContainer = previewContainer;
            this.imgElement = imgElement;
            this.placeholder = placeholder;
            this.markerOverlay = markerOverlay;
            
            // ========== 绑定点击事件 ==========
            previewContainer.addEventListener("click", (e) => {
                node._handleImageClick(e);  // 处理图片点击
            });
            
            // 添加为自定义控件 (宽度自适应)
            const widget = this.addDOMWidget("image_preview", "customWidget", previewContainer, {
                serialize: false,  // 不序列化此控件
                hideOnZoom: false  // 缩放时不隐藏
            });
            widget.computeSize = (width) => [width - 20, this.CONTAINER_HEIGHT + 10];
        };
        
        /**
         * 创建提示词输入框
         */
        nodeType.prototype._createPromptInput = function() {
            const node = this;  // 保存节点引用
            
            // 创建输入容器
            const inputContainer = document.createElement("div");
            inputContainer.style.cssText = `
                width: 100%;
                padding: 5px;
            `;
            
            // 创建标题行 (标签 + 按钮)
            const headerRow = document.createElement("div");
            headerRow.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 5px;
            `;
            
            // 创建标签
            const label = document.createElement("div");
            label.style.cssText = `
                color: #aaa;
                font-size: 12px;
            `;
            label.textContent = "指令";
            headerRow.appendChild(label);
            
            // 创建操作按钮容器 (放在标签右侧)
            const buttonContainer = document.createElement("div");
            buttonContainer.style.cssText = `
                display: flex;
                gap: 5px;
            `;
            
            // 删除选中按钮
            const deleteBtn = document.createElement("button");
            deleteBtn.textContent = "删除选中";
            deleteBtn.style.cssText = `
                padding: 2px 8px;
                background: #444;
                border: none;
                border-radius: 3px;
                color: #fff;
                cursor: pointer;
                font-size: 11px;
            `;
            deleteBtn.onclick = () => node._deleteSelectedMarker();
            buttonContainer.appendChild(deleteBtn);
            
            // 清空按钮
            const clearBtn = document.createElement("button");
            clearBtn.textContent = "清空";
            clearBtn.style.cssText = `
                padding: 2px 8px;
                background: #444;
                border: none;
                border-radius: 3px;
                color: #fff;
                cursor: pointer;
                font-size: 11px;
            `;
            clearBtn.onclick = () => node._clearAllMarkers();
            buttonContainer.appendChild(clearBtn);
            
            headerRow.appendChild(buttonContainer);
            inputContainer.appendChild(headerRow);
            
            // 创建富文本输入框
            const textarea = document.createElement("div");
            textarea.contentEditable = true;  // 可编辑
            textarea.style.cssText = `
                width: 100%;
                min-height: 80px;
                max-height: 120px;
                overflow-y: auto;
                background: #2a2a2a;
                border: 1px solid #444;
                border-radius: 4px;
                padding: 8px;
                color: #fff;
                font-size: 13px;
                line-height: 1.5;
                outline: none;
            `;
            textarea.setAttribute("placeholder", "在此输入指令，点击图片添加标记...");
            inputContainer.appendChild(textarea);
            
            // 阻止粘贴事件冒泡到 ComfyUI
            textarea.addEventListener("paste", (e) => {
                e.stopPropagation();  // 阻止事件冒泡
                // 只粘贴纯文本
                e.preventDefault();
                const text = e.clipboardData.getData("text/plain");
                document.execCommand("insertText", false, text);
            });
            
            // 阻止复制和剪切事件冒泡
            textarea.addEventListener("copy", (e) => e.stopPropagation());
            textarea.addEventListener("cut", (e) => e.stopPropagation());
            
            // 阻止键盘事件冒泡 (防止 ComfyUI 快捷键干扰)
            textarea.addEventListener("keydown", (e) => e.stopPropagation());
            textarea.addEventListener("keyup", (e) => e.stopPropagation());
            
            // 保存元素引用
            this.promptTextarea = textarea;
            
            // 监听输入变化
            textarea.addEventListener("input", () => {
                node._updatePromptData();  // 更新提示词数据
            });
            
            // 设置标签拖放功能
            this._setupTagDragDrop();
            
            // 添加为自定义控件
            const widget = this.addDOMWidget("prompt_input", "customWidget", inputContainer, {
                serialize: false,
                hideOnZoom: false
            });
            widget.computeSize = (width) => [width - 20, 120];
        };
        
        /**
         * 设置图片选择控件
         */
        nodeType.prototype._setupImageWidget = function() {
            const node = this;  // 保存节点引用
            
            // 查找 image 控件
            const imageWidget = this.widgets?.find(w => w.name === "image");
            if (!imageWidget) return;
            
            // 保存原始回调
            const originalCallback = imageWidget.callback;
            
            // 重写回调函数
            imageWidget.callback = function(value) {
                // 调用原始回调
                if (originalCallback) {
                    originalCallback.call(this, value);
                }
                
                // 加载并显示图片
                if (value) {
                    node._loadImage(value);  // 加载选中的图片
                }
            };
            
            // 新建节点时不自动加载缓存图片，保持空白状态
            // 只有用户主动选择图片时才加载
            
            // 隐藏 ComfyUI 默认的图片预览控件
            this._hideDefaultImagePreview();
        };
        
        /**
         * 隐藏 ComfyUI 默认的图片预览控件
         */
        nodeType.prototype._hideDefaultImagePreview = function() {
            // 延迟执行以确保控件已创建
            setTimeout(() => {
                // 查找并隐藏默认图片预览
                if (this.widgets) {
                    this.widgets.forEach(w => {
                        // 隐藏 IMAGEUPLOAD 类型的默认预览
                        if (w.type === "IMAGEUPLOAD" || w.name === "upload") {
                            if (w.element) {
                                w.element.style.display = "none";
                            }
                        }
                    });
                }
                
                // 隐藏节点底部的图片预览 (如果存在)
                if (this.imgs) {
                    this.imgs = [];  // 清空图片数组
                }
                
                // 强制重绘
                this.setDirtyCanvas(true, true);
            }, 100);
        };
        
        /**
         * 加载并显示图片
         * @param {string} filename - 图片文件名
         */
        nodeType.prototype._loadImage = function(filename) {
            if (!filename) return;
            
            // 构建图片 URL
            const imageUrl = `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=`;
            
            // 设置图片源
            this.imgElement.src = imageUrl;
            this.imgElement.style.display = "block";  // 显示图片
            this.placeholder.style.display = "none";  // 隐藏占位符
            this.imageUrl = imageUrl;
            
            // 图片加载完成后的处理
            this.imgElement.onload = () => {
                this._clearAllMarkers();  // 清空旧标记
                this.setDirtyCanvas(true);  // 标记画布需要重绘
            };
            
            // 图片加载失败处理
            this.imgElement.onerror = () => {
                console.error("图片加载失败:", filename);
                this.placeholder.textContent = "图片加载失败";
                this.placeholder.style.display = "block";
                this.imgElement.style.display = "none";
            };
        };
        
        /**
         * 处理图片点击事件
         * @param {MouseEvent} e - 鼠标事件
         */
        nodeType.prototype._handleImageClick = function(e) {
            // 如果点击的是标记点或其子元素，不创建新标记
            let target = e.target;
            while (target && target !== this.previewContainer) {
                if (target.classList && target.classList.contains("marker-point")) {
                    return;  // 点击了标记点，由标记点自己处理
                }
                target = target.parentElement;
            }
            
            // 检查是否有图片
            if (!this.imgElement || this.imgElement.style.display === "none") {
                return;  // 无图片时不处理
            }
            
            // 获取容器的屏幕位置
            const containerRect = this.previewContainer.getBoundingClientRect();
            
            // 计算画布缩放比例 (容器实际显示尺寸 / 容器固定尺寸)
            const scaleX = containerRect.width / this.CONTAINER_WIDTH;
            const scaleY = containerRect.height / this.CONTAINER_HEIGHT;
            
            // 计算点击位置相对于容器的坐标 (还原画布缩放)
            const clickX = (e.clientX - containerRect.left) / scaleX;
            const clickY = (e.clientY - containerRect.top) / scaleY;
            
            // 使用固定容器尺寸计算图片显示区域
            const displayInfo = this._getImageDisplayInfo();
            if (!displayInfo) return;
            
            const { x: imgDisplayX, y: imgDisplayY, width: imgDisplayWidth, height: imgDisplayHeight } = displayInfo;
            
            // 检查点击是否在图片范围内
            if (clickX < imgDisplayX || clickX > imgDisplayX + imgDisplayWidth ||
                clickY < imgDisplayY || clickY > imgDisplayY + imgDisplayHeight) {
                return;  // 点击在图片外部
            }
            
            // 计算相对坐标 (0.0 - 1.0)
            const relX = (clickX - imgDisplayX) / imgDisplayWidth;
            const relY = (clickY - imgDisplayY) / imgDisplayHeight;
            
            // 添加新标记点
            const newIndex = this.pointsData.length + 1;  // 新标记序号
            this.pointsData.push({
                x: relX,      // 相对 X 坐标
                y: relY,      // 相对 Y 坐标
                index: newIndex  // 标记序号
            });
            
            // 更新 UI
            this._renderMarkers();      // 重新渲染标记
            this._insertMarkerTag(newIndex);  // 在文本框插入标签
            this._updatePointsWidget();  // 更新隐藏控件数据
            this._updatePromptData();   // 更新提示词数据
        };
        
        /**
         * 计算图片显示信息 (使用固定容器尺寸，不受缩放影响)
         */
        nodeType.prototype._getImageDisplayInfo = function() {
            if (!this.imgElement) return null;
            
            // 使用固定容器尺寸
            const containerWidth = this.CONTAINER_WIDTH;
            const containerHeight = this.CONTAINER_HEIGHT;
            const imgNaturalWidth = this.imgElement.naturalWidth || 1;
            const imgNaturalHeight = this.imgElement.naturalHeight || 1;
            
            const imgAspect = imgNaturalWidth / imgNaturalHeight;
            const containerAspect = containerWidth / containerHeight;
            
            let imgDisplayWidth, imgDisplayHeight, imgDisplayX, imgDisplayY;
            
            if (imgAspect > containerAspect) {
                imgDisplayWidth = containerWidth;
                imgDisplayHeight = containerWidth / imgAspect;
                imgDisplayX = 0;
                imgDisplayY = (containerHeight - imgDisplayHeight) / 2;
            } else {
                imgDisplayHeight = containerHeight;
                imgDisplayWidth = containerHeight * imgAspect;
                imgDisplayX = (containerWidth - imgDisplayWidth) / 2;
                imgDisplayY = 0;
            }
            
            return {
                x: imgDisplayX,
                y: imgDisplayY,
                width: imgDisplayWidth,
                height: imgDisplayHeight
            };
        };
        
        /**
         * 渲染所有标记点
         */
        nodeType.prototype._renderMarkers = function() {
            // 清空标记层
            this.markerOverlay.innerHTML = "";
            
            // 获取图片显示信息
            const displayInfo = this._getImageDisplayInfo();
            if (!displayInfo) return;
            
            const { x: imgDisplayX, y: imgDisplayY, width: imgDisplayWidth, height: imgDisplayHeight } = displayInfo;
            const node = this;
            
            // 遍历所有点并创建标记
            this.pointsData.forEach((point, idx) => {
                // 计算绝对位置
                const absX = imgDisplayX + point.x * imgDisplayWidth;
                const absY = imgDisplayY + point.y * imgDisplayHeight;
                
                // 创建标记元素
                const marker = document.createElement("div");
                marker.className = "marker-point";  // 添加类名用于识别
                marker.style.cssText = `
                    position: absolute;
                    left: ${absX}px;
                    top: ${absY}px;
                    transform: translate(-50%, -50%);
                    width: 22px;
                    height: 22px;
                    background: rgba(30, 144, 255, 0.9);
                    border: 2px solid rgba(255, 255, 255, 0.9);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 12px;
                    font-weight: bold;
                    pointer-events: auto;
                    cursor: grab;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    user-select: none;
                    z-index: 10;
                `;
                marker.textContent = this._getCircledNumber(point.index);
                marker.dataset.index = idx;  // 存储索引
                
                // 标记拖动功能
                let isDragging = false;
                let startX, startY;
                
                marker.onmousedown = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    isDragging = true;
                    startX = e.clientX;
                    startY = e.clientY;
                    marker.style.cursor = "grabbing";
                    node._selectMarker(idx);  // 选中此标记
                    
                    // 获取画布缩放比例
                    const containerRect = node.previewContainer.getBoundingClientRect();
                    const scaleX = containerRect.width / node.CONTAINER_WIDTH;
                    const scaleY = containerRect.height / node.CONTAINER_HEIGHT;
                    
                    const onMouseMove = (moveEvent) => {
                        if (!isDragging) return;
                        
                        // 计算移动距离 (还原画布缩放)
                        const deltaX = (moveEvent.clientX - startX) / scaleX;
                        const deltaY = (moveEvent.clientY - startY) / scaleY;
                        
                        // 更新相对坐标
                        let newRelX = point.x + deltaX / imgDisplayWidth;
                        let newRelY = point.y + deltaY / imgDisplayHeight;
                        
                        // 限制在图片范围内
                        newRelX = Math.max(0, Math.min(1, newRelX));
                        newRelY = Math.max(0, Math.min(1, newRelY));
                        
                        // 更新点数据
                        node.pointsData[idx].x = newRelX;
                        node.pointsData[idx].y = newRelY;
                        
                        // 更新标记位置
                        const newAbsX = imgDisplayX + newRelX * imgDisplayWidth;
                        const newAbsY = imgDisplayY + newRelY * imgDisplayHeight;
                        marker.style.left = `${newAbsX}px`;
                        marker.style.top = `${newAbsY}px`;
                        
                        startX = moveEvent.clientX;
                        startY = moveEvent.clientY;
                    };
                    
                    const onMouseUp = () => {
                        isDragging = false;
                        marker.style.cursor = "grab";
                        document.removeEventListener("mousemove", onMouseMove);
                        document.removeEventListener("mouseup", onMouseUp);
                        node._updatePointsWidget();  // 保存更新后的坐标
                    };
                    
                    document.addEventListener("mousemove", onMouseMove);
                    document.addEventListener("mouseup", onMouseUp);
                };
                
                this.markerOverlay.appendChild(marker);
            });
        };
        
        /**
         * 在文本框中插入标记标签
         * @param {number} index - 标记序号
         */
        nodeType.prototype._insertMarkerTag = function(index) {
            const circledNum = this._getCircledNumber(index);
            const node = this;
            
            // 创建胶囊标签
            const tag = document.createElement("span");
            tag.className = "marker-tag";
            tag.contentEditable = false;  // 标签不可编辑
            tag.draggable = true;  // 启用拖动
            tag.style.cssText = `
                display: inline-block;
                background: #1E90FF;
                color: white;
                padding: 2px 8px;
                border-radius: 12px;
                margin: 0 2px;
                font-size: 12px;
                cursor: grab;
                user-select: none;
            `;
            tag.textContent = circledNum;
            tag.dataset.markerIndex = index;
            
            // 标签拖动事件
            tag.ondragstart = (e) => {
                e.stopPropagation();
                node._draggedTag = tag;  // 记录被拖动的标签
                tag.style.opacity = "0.5";
            };
            
            tag.ondragend = (e) => {
                e.stopPropagation();
                tag.style.opacity = "1";
                node._draggedTag = null;
            };
            
            // 获取当前光标位置并插入
            const selection = window.getSelection();
            if (selection.rangeCount > 0 && this.promptTextarea.contains(selection.anchorNode)) {
                // 在光标位置插入
                const range = selection.getRangeAt(0);
                range.deleteContents();
                range.insertNode(tag);
                range.setStartAfter(tag);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            } else {
                // 追加到末尾
                this.promptTextarea.appendChild(tag);
            }
            
            this._updatePromptData();  // 更新提示词数据
        };
        
        /**
         * 设置文本框拖放区域
         */
        nodeType.prototype._setupTagDragDrop = function() {
            const node = this;
            const textarea = this.promptTextarea;
            
            // 允许放置
            textarea.ondragover = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };
            
            // 处理放置
            textarea.ondrop = (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (!node._draggedTag) return;
                
                // 获取放置位置
                const range = document.caretRangeFromPoint(e.clientX, e.clientY);
                if (range && textarea.contains(range.startContainer)) {
                    // 移除原位置的标签
                    node._draggedTag.remove();
                    // 在新位置插入
                    range.insertNode(node._draggedTag);
                    node._updatePromptData();
                }
            };
        };
        
        /**
         * 选中标记
         * @param {number} idx - 标记在数组中的索引
         */
        nodeType.prototype._selectMarker = function(idx) {
            this.selectedMarkerIndex = idx;  // 记录选中索引
            
            // 更新标记样式
            const markers = this.markerOverlay.children;
            for (let i = 0; i < markers.length; i++) {
                if (i === idx) {
                    markers[i].style.border = "3px solid #FFD700";  // 金色边框表示选中
                } else {
                    markers[i].style.border = "2px solid white";  // 恢复默认
                }
            }
        };
        
        /**
         * 删除选中的标记
         */
        nodeType.prototype._deleteSelectedMarker = function() {
            if (this.selectedMarkerIndex === undefined || this.selectedMarkerIndex === null) {
                return;  // 无选中标记
            }
            
            const idx = this.selectedMarkerIndex;
            const deletedPoint = this.pointsData[idx];
            
            // 从数组中移除
            this.pointsData.splice(idx, 1);
            
            // 重新编号
            this.pointsData.forEach((point, i) => {
                point.index = i + 1;
            });
            
            // 从文本框中移除对应标签
            const tags = this.promptTextarea.querySelectorAll(".marker-tag");
            tags.forEach(tag => {
                if (parseInt(tag.dataset.markerIndex) === deletedPoint.index) {
                    tag.remove();
                }
            });
            
            // 更新所有标签的序号
            this._updateTagNumbers();
            
            // 清除选中状态
            this.selectedMarkerIndex = null;
            
            // 重新渲染
            this._renderMarkers();
            this._updatePointsWidget();
            this._updatePromptData();
        };
        
        /**
         * 清空所有标记
         */
        nodeType.prototype._clearAllMarkers = function() {
            this.pointsData = [];  // 清空数据
            this.selectedMarkerIndex = null;  // 清除选中
            this.markerOverlay.innerHTML = "";  // 清空标记层
            
            // 清空文本框中的标签 (保留纯文本)
            const tags = this.promptTextarea.querySelectorAll(".marker-tag");
            tags.forEach(tag => tag.remove());
            
            this._updatePointsWidget();
            this._updatePromptData();
        };
        
        /**
         * 更新标签序号
         */
        nodeType.prototype._updateTagNumbers = function() {
            const tags = this.promptTextarea.querySelectorAll(".marker-tag");
            let currentIndex = 1;
            tags.forEach(tag => {
                tag.textContent = this._getCircledNumber(currentIndex);
                tag.dataset.markerIndex = currentIndex;
                currentIndex++;
            });
        };
        
        /**
         * 更新 points_data 隐藏控件
         */
        nodeType.prototype._updatePointsWidget = function() {
            const pointsWidget = this.widgets?.find(w => w.name === "points_data");
            if (pointsWidget) {
                pointsWidget.value = JSON.stringify(this.pointsData);  // 序列化为 JSON
            }
        };
        
        /**
         * 更新提示词数据
         */
        nodeType.prototype._updatePromptData = function() {
            // 获取文本框内容 (将标签转换为纯文本格式)
            let promptText = "";
            
            // 递归处理所有子节点
            const processNode = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    promptText += node.textContent;  // 纯文本
                } else if (node.classList?.contains("marker-tag")) {
                    // 标签转换为 "标记点X" 格式
                    const markerIndex = node.dataset.markerIndex || node.textContent;
                    promptText += `标记点${markerIndex}`;
                } else if (node.nodeName === "BR") {
                    promptText += "\n";  // 换行符
                } else if (node.nodeName === "DIV" || node.nodeName === "P") {
                    // 块级元素添加换行
                    if (promptText.length > 0 && !promptText.endsWith("\n")) {
                        promptText += "\n";
                    }
                    node.childNodes.forEach(child => processNode(child));
                } else if (node.childNodes && node.childNodes.length > 0) {
                    node.childNodes.forEach(child => processNode(child));
                } else if (node.textContent) {
                    promptText += node.textContent;
                }
            };
            
            this.promptTextarea.childNodes.forEach(node => processNode(node));
            
            // 清理多余的换行和空格
            promptText = promptText.trim();
            
            // 存储到节点属性 (供后端使用)
            this.promptText = promptText;
            
            // 更新 prompt_text 控件
            if (this.widgets) {
                for (const widget of this.widgets) {
                    if (widget.name === "prompt_text") {
                        widget.value = promptText;
                        break;
                    }
                }
            }
            
            // 标记节点需要重新执行
            if (this.graph) {
                this.graph.change();
            }
        };
        
        /**
         * 获取标记数字显示文本
         * @param {number} index - 数字序号
         * @returns {string} 数字字符串
         */
        nodeType.prototype._getCircledNumber = function(index) {
            // 直接返回普通数字，与后端保持一致
            return String(index);
        };
        
        /**
         * 序列化节点数据 - 保存完整状态
         */
        const originalSerialize = nodeType.prototype.serialize;
        nodeType.prototype.serialize = function() {
            const data = originalSerialize ? originalSerialize.call(this) : {};
            
            // 保存自定义数据 (确保前后端一致)
            data.pointsData = this.pointsData || [];
            data.promptText = this.promptText || "";
            data.currentImageName = this._getCurrentImageName();  // 保存当前图片名
            
            return data;
        };
        
        /**
         * 获取当前图片文件名
         */
        nodeType.prototype._getCurrentImageName = function() {
            const imageWidget = this.widgets?.find(w => w.name === "image");
            return imageWidget?.value || "";
        };
        
        /**
         * 反序列化节点数据 - 恢复完整状态 (加载工作流时调用)
         */
        const originalConfigure = nodeType.prototype.configure;
        nodeType.prototype.configure = function(data) {
            if (originalConfigure) {
                originalConfigure.call(this, data);
            }
            
            const node = this;
            node._isNewNode = false;  // 标记为加载的节点，非新建
            
            // 延迟恢复，确保 UI 组件已创建
            setTimeout(() => {
                // 检查是否有保存的数据
                const hasPointsData = data.pointsData && Array.isArray(data.pointsData) && data.pointsData.length > 0;
                const hasPromptText = data.promptText && data.promptText.trim() !== "";
                const imageWidget = node.widgets?.find(w => w.name === "image");
                const hasImage = imageWidget && imageWidget.value;
                
                // 恢复标记点数据
                if (hasPointsData) {
                    node.pointsData = data.pointsData;
                    node._updatePointsWidget();
                } else {
                    node.pointsData = [];
                    node._updatePointsWidget();
                }
                
                // 恢复提示词文本
                if (hasPromptText && node.promptTextarea) {
                    node.promptText = data.promptText;
                    node._restorePromptContent(data.promptText, data.pointsData || []);
                    node._updatePromptWidget();
                } else {
                    node.promptText = "";
                    if (node.promptTextarea) {
                        node.promptTextarea.innerHTML = "";
                    }
                }
                
                // 恢复图片显示 (与后端保持一致)
                if (hasImage) {
                    node._loadImage(imageWidget.value);
                    // 图片加载后再渲染标记点
                    setTimeout(() => {
                        if (hasPointsData) {
                            node._renderMarkers();
                        }
                    }, 200);
                }
            }, 150);
        };
        
        /**
         * 更新 prompt_text 控件值
         */
        nodeType.prototype._updatePromptWidget = function() {
            if (this.widgets) {
                for (const widget of this.widgets) {
                    if (widget.name === "prompt_text") {
                        widget.value = this.promptText || "";
                        break;
                    }
                }
            }
        };
        
        /**
         * 恢复提示词内容 (将纯文本转换回带标签的富文本)
         */
        nodeType.prototype._restorePromptContent = function(promptText, pointsData) {
            if (!this.promptTextarea) return;
            
            // 清空当前内容
            this.promptTextarea.innerHTML = "";
            
            if (!promptText) return;
            
            // 解析文本，将 "标记点X" 转换回标签
            let content = promptText;
            const markerRegex = /标记点(\d+)/g;
            let lastIndex = 0;
            let match;
            
            while ((match = markerRegex.exec(promptText)) !== null) {
                // 添加标记前的文本
                if (match.index > lastIndex) {
                    const textBefore = promptText.substring(lastIndex, match.index);
                    this.promptTextarea.appendChild(document.createTextNode(textBefore));
                }
                
                // 创建标签
                const markerIndex = parseInt(match[1]);
                const tag = document.createElement("span");
                tag.className = "marker-tag";
                tag.contentEditable = false;
                tag.dataset.markerIndex = markerIndex;
                tag.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 22px;
                    height: 22px;
                    background: #1E90FF;
                    border-radius: 50%;
                    color: white;
                    font-size: 12px;
                    font-weight: bold;
                    margin: 0 2px;
                    cursor: pointer;
                    user-select: none;
                    vertical-align: middle;
                `;
                tag.textContent = String(markerIndex);
                this.promptTextarea.appendChild(tag);
                
                lastIndex = match.index + match[0].length;
            }
            
            // 添加剩余文本
            if (lastIndex < promptText.length) {
                const textAfter = promptText.substring(lastIndex);
                this.promptTextarea.appendChild(document.createTextNode(textAfter));
            }
        };
    }
});
