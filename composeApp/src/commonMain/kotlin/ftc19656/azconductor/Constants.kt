package ftc19656.azconductor

import androidx.compose.ui.graphics.Color


const val canvasLineWidth = 2f

const val curveDrawStep = 1000

const val canvasRotateDeg = 0f

// 逻辑原点在画布中的比例
// (0f, 0f) 为左上角，(0.5f, 0.5f) 为正中心，(1f, 1f) 为右下角
const val originRatioX = 0.5f
const val originRatioY = 0.5f

val pathLineColor = Color.LightGray



// ---------------- 临时区域 ------------------

// 逻辑上的画布大小
// 无论屏幕多大，路径算法都基于这个尺寸进行计算
const val canvasLogicalWidth = 144f
const val canvasLogicalHeight = 144f
