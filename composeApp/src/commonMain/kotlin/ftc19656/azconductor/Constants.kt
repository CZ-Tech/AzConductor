package ftc19656.azconductor

import androidx.compose.ui.graphics.Color

/**
 * 场地与坐标系配置
 */
object FieldConfig {
    // 逻辑上的画布大小
    // 无论屏幕多大，路径算法都基于这个尺寸进行计算
    const val CANVAS_LOGICAL_WIDTH = 144f
    const val CANVAS_LOGICAL_HEIGHT = 144f

    // 逻辑原点在画布中的比例
    // (0f, 0f) 为左上角，(0.5f, 0.5f) 为正中心，(1f, 1f) 为右下角
    const val ORIGIN_RATIO_X = 0.5f
    const val ORIGIN_RATIO_Y = 0.5f

    // 逻辑坐标系 X 轴正方向在屏幕上的映射
    // 用单位向量表示
    // 1f -> 屏幕右侧, -1f -> 屏幕左侧, 0f -> 无水平分量
    const val LOGICAL_X_MAP_TO_SCREEN_X = 0f
    // 1f -> 屏幕下方, -1f -> 屏幕上方, 0f -> 无垂直分量
    const val LOGICAL_X_MAP_TO_SCREEN_Y = 1f
    // 逻辑坐标系 Y 轴正方向在屏幕上的映射
    const val LOGICAL_Y_MAP_TO_SCREEN_X = 1f
    const val LOGICAL_Y_MAP_TO_SCREEN_Y = 0f

    /**
     * 逻辑 X 轴在屏幕坐标系中的角度 (单位：度)
     * 用于同步机器人组件的视觉朝向与逻辑朝向
     */
    val fieldXAngleDeg: Float 
        get() = kotlin.math.atan2(LOGICAL_X_MAP_TO_SCREEN_Y, LOGICAL_X_MAP_TO_SCREEN_X)
            .toDouble()
            .toDegrees()
            .toFloat()
}

/**
 * 机器人物理属性配置
 */
object RobotConfig {
    // 机器人逻辑尺寸 (英寸)
    const val ROBOT_LOGICAL_WIDTH = 18f
    const val ROBOT_LOGICAL_HEIGHT = 9f
}

/**
 * UI 表现与交互配置
 */
object UIConfig {
    const val EXPAND_ARROW_BUTTON_SIZE_DIP = 36
    const val EXPAND_ARROW_ICON_SIZE_DIP = 24

    const val CANVAS_LINE_WIDTH = 2f
    const val CURVE_DRAW_STEP = 1000
    const val CANVAS_ROTATE_DEG = 0f

    val PATH_LINE_COLOR = Color.LightGray

    // Win11 风格品牌色
    val WIN11_ACCENT = Color(0xFF0067C0)
    val WIN11_INACTIVE = Color.LightGray.copy(alpha = 0.5f)

    const val PATH_CARD_SIZE_DIP = 120

    const val RUN_MAP_HEIGHT_RATIO = 2f / 3f  // 运行页场地图高度占比

    const val Error_Time_Chart_HEIGHT_RATIO = 1f / 3f  //路径误差图表高度占比

    const val K_VELOCITY_HANDLE = 5.0  // 速度向量手柄缩放系数

    // NodeEditorDialog 中 ControlNode 属性的显示顺序
    val NODE_EDITOR_FIELD_ORDER = listOf("marker", "command", "commandParams", "heading", "dHeading", "duration", "delayAfterArrive", "x", "dx", "y", "dy")

    /**
     * 机器人组件触控容差系数
     * 允许的点击范围为圆点大小的多少倍？
     */
    const val ROBOT_COMPONENT_TOUCH_THRESHOLD_RATIO = 1.5f

}

/**
 * 定时器与轮询间隔配置
 */
object TimingConfig {
    /** 本地存储轮询间隔（自动保存检测 + 跨标签页同步） */
    const val STORAGE_POLL_MS = 50L
    /** 机器人同步间隔（冲突检测 + 指令列表刷新） */
    const val ROBOT_SYNC_INTERVAL_MS = 500L
    /** 时间线播放帧间隔 (~60fps) */
    const val PLAYBACK_FRAME_MS = 16L
    /** 时间线播放每帧时间步长 (秒) */
    const val PLAYBACK_FRAME_STEP = 0.016f
}
