package ftc19656.azconductor

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color


const val canvasLineWidth = 2f

const val curveDrawStep = 1000

const val canvasRotateDeg = 0f

// 逻辑原点在画布中的比例
// (0f, 0f) 为左上角，(0.5f, 0.5f) 为正中心，(1f, 1f) 为右下角
const val originRatioX = 0.5f
const val originRatioY = 0.5f

val pathLineColor = Color.LightGray

// 定义一些有“科技感”或符合机器人竞赛主题的颜色
val RobotBlue = Color(0xFF00529B)
val RobotOrange = Color(0xD500FF90)
val DarkGrey = Color(0xFF1C1B1F)
val LightGrey = Color(0xFFE6E1E5)

// 浅色主题配置
val MyLightColors = lightColorScheme(
    primary = RobotBlue,       // 主色：路点、主要按钮
    secondary = RobotOrange,   // 辅助色：向量手柄、控制线
    surface = Color.White,     // 表面色：卡片背景
    background = Color.White,  // 背景色
    // 你还可以定义 onPrimary (主色上的文字颜色) 等等
)

// 深色主题配置
private val MyDarkColors = darkColorScheme(
    primary = Color(0xFFD0BCFF),
    secondary = RobotOrange,
    surface = DarkGrey,
    background = Color(0xFF1C1B1F)
)



// ---------------- 临时区域 ------------------

// 逻辑上的画布大小
// 无论屏幕多大，路径算法都基于这个尺寸进行计算
const val canvasLogicalWidth = 144f
const val canvasLogicalHeight = 144f

const val KVelocityHandle = 2.0  // 这个数字越大，那么每单位长度速度向量手柄代表的dx、dy越大，也就是说更短的手柄可以代表更大的速度
