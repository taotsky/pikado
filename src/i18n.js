import runtime from './i18n/runtime.js';
import ui from './i18n/ui.js';
import dialogs from './i18n/dialogs.js';
import features from './i18n/features.js';

/**
 * Local Simplified-Chinese vocabulary for the user-facing Pikado interface.
 *
 * Pikado did not ship an i18n layer. Keeping the vocabulary in one module
 * means the UI can fall back to the original English string when a new
 * upstream feature has not yet been translated, without changing command IDs,
 * saved documents, keyboard bindings, or file formats.
 */
const zhCN = {
  ...runtime,
  ...ui,
  ...dialogs,
  ...features,
  'Image studio': '图像工作室', 'Recent projects': '最近项目', 'New Document': '新建文档',
  'Create': '创建', 'Presets': '预设', 'Units': '单位', 'Orientation': '方向',
  'Portrait': '纵向', 'Landscape': '横向', 'Artboards': '画板',
  'Wrap content in an artboard': '将内容放入画板', 'Color Mode': '颜色模式',
  'Background Contents': '背景内容', 'Flat memory': '平面图像内存',
  'Pixels': '像素', 'Inches': '英寸', 'Centimeters': '厘米', 'Millimeters': '毫米',
  'Points': '点', 'Picas': '派卡', 'Pixels/Inch': '像素/英寸', 'Pixels/Centimeter': '像素/厘米',
  'White': '白色', 'Black': '黑色', 'Transparent': '透明', 'Custom...': '自定…',
  'Bitmap': '位图', 'Photo': '照片', 'Print': '印刷', 'Art & Illustration': '艺术与插画',
  'Web': '网页', 'Mobile': '移动设备', 'Film & Video': '影视与视频',
  'Lock': '锁定', 'Fill': '填充', 'Filter type': '筛选类型', 'Blending mode': '混合模式',
  'Lock transparent pixels': '锁定透明像素', 'Lock image pixels': '锁定图像像素',
  'Lock position': '锁定位置', 'Lock all': '全部锁定',
  'Turn layer filtering on/off': '开启或关闭图层筛选',
  'File': '文件', 'Edit': '编辑', 'Image': '图像', 'Layer': '图层', 'Type': '文字',
  'Select': '选择', 'Filter': '滤镜', 'View': '视图', 'Window': '窗口', 'Help': '帮助',
  'New…': '新建…', 'Open…': '打开…', 'Close': '关闭', 'Close All': '关闭全部',
  'Save': '保存', 'Save As…': '另存为…', 'Export As…': '导出为…',
  'Quick Export as PNG': '快速导出为 PNG', 'Revert': '恢复到已保存版本', 'Print…': '打印…',
  'File Info…': '文件信息…', 'Clear Recent File List': '清除最近文件列表',
  'Undo': '撤销', 'Redo': '重做', 'Step Forward': '前进一步', 'Step Backward': '后退一步',
  'Fade…': '渐隐…', 'Cut': '剪切', 'Copy': '复制', 'Copy Merged': '复制合并结果',
  'Paste': '粘贴', 'Paste Into': '粘贴到内部', 'Paste Outside': '粘贴到外部',
  'Clear': '清除', 'Fill…': '填充…', 'Fill with Foreground Color': '使用前景色填充',
  'Fill with Background Color': '使用背景色填充', 'Stroke…': '描边…',
  'Content-Aware Fill…': '内容识别填充…', 'Generative Fill…': '生成式填充…',
  'Free Transform': '自由变换', 'Again': '再次变换', 'Scale': '缩放', 'Rotate': '旋转',
  'Skew': '倾斜', 'Distort': '扭曲', 'Perspective': '透视', 'Warp': '变形',
  'Flip Horizontal': '水平翻转', 'Flip Vertical': '垂直翻转',
  'Keyboard Shortcuts…': '键盘快捷键…', 'Preferences…': '首选项…', 'AI Settings…': 'AI 设置…',
  'RGB Color': 'RGB 颜色', 'Grayscale': '灰度', 'Image Size…': '图像大小…',
  'Canvas Size…': '画布大小…', 'Rotate Canvas': '旋转画布', 'Crop': '裁剪',
  'Duplicate Layer…': '复制图层…', 'Delete Layer': '删除图层', 'New Layer…': '新建图层…',
  'New Group': '新建组', 'New Fill Layer': '新建填充图层', 'New Adjustment Layer': '新建调整图层',
  'Layer Style…': '图层样式…', 'Rasterize': '栅格化', 'Merge Down': '向下合并',
  'Merge Visible': '合并可见图层', 'Flatten Image': '拼合图像',
  'Select All': '全选', 'Deselect': '取消选择', 'Reselect': '重新选择', 'Inverse': '反向选择',
  'All': '全部', 'None': '无', 'Cancel': '取消', 'OK': '确定', 'Apply': '应用',
  'Delete': '删除', 'Remove': '移除', 'Reset': '重置',
  'No document': '没有打开的文档', 'Unsaved changes': '未保存的更改', '(empty)': '（空）',
  'Layers': '图层', 'Channels': '通道', 'Paths': '路径', 'Color': '颜色',
  'Swatches': '色板', 'Properties': '属性', 'History': '历史记录',
  'Navigator': '导航器', 'Info': '信息', 'Character': '字符', 'Timeline': '时间轴',
  'Foreground Color': '前景色', 'Background Color': '背景色', 'Foreground colour': '前景色',
  'Background colour': '背景色', 'Swap colours (X)': '交换前景色和背景色 (X)',
  'Default colours (D)': '默认颜色 (D)', 'Text Color': '文字颜色',
  'Brush Tool': '画笔工具', 'Pencil Tool': '铅笔工具', 'Color Replacement Tool': '颜色替换工具',
  'Mixer Brush Tool': '混合器画笔工具', 'Crop Tool': '裁剪工具',
  'Perspective Crop Tool': '透视裁剪工具', 'Slice Tool': '切片工具',
  'Eraser Tool': '橡皮擦工具', 'Background Eraser Tool': '背景橡皮擦工具',
  'Magic Eraser Tool': '魔术橡皮擦工具', 'Eyedropper Tool': '吸管工具',
  'Color Sampler Tool': '颜色取样器工具', 'Ruler Tool': '标尺工具', 'Note Tool': '注释工具',
  'Blur Tool': '模糊工具', 'Sharpen Tool': '锐化工具', 'Smudge Tool': '涂抹工具',
  'Gradient Tool': '渐变工具', 'Paint Bucket Tool': '油漆桶工具',
  'Spot Healing Brush Tool': '污点修复画笔工具', 'Healing Brush Tool': '修复画笔工具',
  'Patch Tool': '修补工具', 'Red Eye Tool': '红眼工具',
  'History Brush Tool': '历史记录画笔工具', 'Art History Brush Tool': '历史艺术画笔工具',
  'Move Tool': '移动工具', 'Artboard Tool': '画板工具', 'Pen Tool': '钢笔工具',
  'Freeform Pen Tool': '自由钢笔工具', 'Curvature Pen Tool': '曲率钢笔工具',
  'Add Anchor Point Tool': '添加锚点工具', 'Delete Anchor Point Tool': '删除锚点工具',
  'Convert Point Tool': '转换点工具', 'Rectangular Marquee Tool': '矩形选框工具',
  'Elliptical Marquee Tool': '椭圆选框工具', 'Single Row Marquee Tool': '单行选框工具',
  'Single Column Marquee Tool': '单列选框工具', 'Lasso Tool': '套索工具',
  'Polygonal Lasso Tool': '多边形套索工具', 'Magnetic Lasso Tool': '磁性套索工具',
  'Magic Wand Tool': '魔棒工具', 'Quick Selection Tool': '快速选择工具',
  'Hand Tool': '抓手工具', 'Rotate View Tool': '旋转视图工具', 'Zoom Tool': '缩放工具',
  'Horizontal Type Tool': '横排文字工具', 'Vertical Type Tool': '直排文字工具',
  'Type Mask Tool': '文字蒙版工具', 'Path Selection Tool': '路径选择工具',
  'Direct Selection Tool': '直接选择工具', 'Rectangle Tool': '矩形工具',
  'Rounded Rectangle Tool': '圆角矩形工具', 'Ellipse Tool': '椭圆工具',
  'Polygon Tool': '多边形工具', 'Line Tool': '直线工具', 'Custom Shape Tool': '自定形状工具',
  'Clone Stamp Tool': '仿制图章工具', 'Pattern Stamp Tool': '图案图章工具',
  'Desktop': '桌面', 'Square post': '方形帖子', 'Story': '竖版故事',
  'Social banner': '社交横幅', 'A4 at 300 dpi': 'A4（300 dpi）', 'Sketch': '草图',
  'New document': '新建文档', 'Open file…': '打开文件…',
  'Open file': '打开文件', 'Open File': '打开文件',
  'A layered image editor that runs entirely on your machine. Start a blank canvas, open a photo, or pick up where you left off.': '在你的设备上完全本地运行的多图层图像编辑器。新建画布、打开照片，或继续上次的工作。',
  'or drop a file — or an image from another tab — anywhere on this window': '或将文件（也可以是其他标签页中的图像）拖放到此窗口任意位置',
  'RECENT PROJECTS': '最近项目', 'No document open.': '没有打开的文档。',
  'Auto-Select': '自动选择', 'Show Transform Controls': '显示变换控件', 'ALIGN': '对齐',
  'Align left edges': '左边缘对齐', 'Align horizontal centres': '水平居中对齐',
  'Align right edges': '右边缘对齐', 'Align top edges': '顶部对齐',
  'Align vertical centres': '垂直居中对齐', 'Align bottom edges': '底部对齐',
  'Distribute horizontal centres': '水平分布中心点', 'Distribute vertical centres': '垂直分布中心点',
  'Swap Colors (X)': '交换颜色 (X)', 'Default Foreground and Background (D)': '默认前景色和背景色 (D)',
  'Edit in Quick Mask Mode (Q)': '在快速蒙版模式中编辑 (Q)', 'Standard Screen Mode (F)': '标准屏幕模式 (F)',
  'Panel menu': '面板菜单', 'Collapse': '折叠', 'Link layers': '链接图层',
  'Add a layer style': '添加图层样式', 'Add layer mask': '添加图层蒙版',
  'Create new fill or adjustment layer': '创建新的填充或调整图层',
  'Create a new group': '创建新组', 'Create a new layer': '创建新图层',
  'Delete layer': '删除图层', 'Click to set the foreground, Alt-click for the background': '单击设置前景色，按住 Alt 单击设置背景色',
  'Custom': '自定', 'Fit on Screen': '适合屏幕', 'Fill Screen': '填满屏幕',
  'Document Sizes': '文档大小', 'Document Profile': '文档配置文件',
  'Document Dimensions': '文档尺寸', 'Scratch Sizes': '暂存盘大小', 'Efficiency': '效率',
  'Timing': '计时', 'Current Tool': '当前工具', 'Status information': '状态信息',
  'Zoom level': '缩放级别', 'Zoom presets': '缩放预设',
  'RGB Sliders': 'RGB 滑块', 'HSB Sliders': 'HSB 滑块', 'CMYK Sliders': 'CMYK 滑块',
  'Lab Sliders': 'Lab 滑块', 'Grayscale Slider': '灰度滑块', 'Web Color Sliders': '网页颜色滑块',
  'Start from a template': '从模板开始', 'No projects yet — anything you make is kept here automatically as you work.': '还没有项目——你的创作会在工作时自动保存在这里。',
  'Your work is kept in this browser as you go': '你的作品会在浏览器中自动保存。',
  'Remove from this browser': '从此浏览器移除', 'Remove project': '移除项目',
  'Working…': '正在处理…', 'Loading…': '正在加载…', 'Export': '导出', 'Import': '导入',
  'Opacity': '不透明度', 'Mode': '模式', 'Blending': '混合', 'Blend Mode': '混合模式',
  'Width': '宽度', 'Height': '高度', 'Resolution': '分辨率', 'Name': '名称',
  'Position': '位置', 'Angle': '角度', 'Gradient': '渐变',
  'Pattern': '图案', 'Preview': '预览', 'Preserve Transparency': '保留透明度',
  'Brightness': '亮度', 'Contrast': '对比度', 'Exposure': '曝光度', 'Saturation': '饱和度',
  'Vibrance': '自然饱和度', 'Hue': '色相', 'Lightness': '明度', 'Levels': '色阶',
  'Curves': '曲线', 'Threshold': '阈值', 'Invert': '反相', 'Posterize': '色调分离',
  'Gaussian Blur…': '高斯模糊…', 'Motion Blur…': '动感模糊…', 'Sharpen': '锐化',
  'Blur': '模糊', 'Noise': '杂色', 'Pixelate': '像素化',
  'Render': '渲染', 'Stylize': '风格化', 'Other': '其他',
  'Add Layer Mask': '添加图层蒙版', 'Add Vector Mask': '添加矢量蒙版',
  'Show all channels': '显示所有通道', 'Hide all channels': '隐藏所有通道',
  'Exit Quick Mask': '退出快速蒙版', 'Toggle Quick Mask': '切换快速蒙版',
  'New channel': '新建通道', 'Delete channel': '删除通道',
};

/** Translate an exact UI string, retaining English for unknown upstream text. */
export function t(value, params) {
  if (typeof value !== 'string') return value;
  const text = Object.hasOwn(zhCN, value) ? zhCN[value] : value;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(params, key) ? String(params[key]) : match);
}

// Localize built-in history messages without rewriting saved history or user names.
export function historyLabel(value) {
  if (typeof value !== 'string') return value;
  const exact = t(value);
  if (exact !== value) return exact;
  const templates = [
    [/^New (.+) Layer$/, 'New {name} Layer'],
    [/^Rotate ([-+\d.]+)°$/, 'Rotate {name}°'],
    [/^Assign Profile: (.+)$/, 'Assign Profile: {name}'],
    [/^Convert to Profile: (.+)$/, 'Convert to Profile: {name}'],
    [/^Smart Filter: (.+)$/, 'Smart Filter: {name}'],
    [/^Delete Smart Filter: (.+)$/, 'Delete Smart Filter: {name}'],
    [/^Show Smart Filter: (.+)$/, 'Show Smart Filter: {name}'],
    [/^Hide Smart Filter: (.+)$/, 'Hide Smart Filter: {name}'],
    [/^Snapshot: (.+)$/, 'Snapshot: {name}'],
  ];
  for (const [pattern, key] of templates) {
    const match = value.match(pattern);
    if (match) return t(key, { name: match[1] });
  }
  const action = value.match(/^(Fade|Show|Hide|Reset) (.+)$/);
  if (action) return t(`${action[1]} {name}`, { name: historyLabel(action[2]) });
  return value;
}
