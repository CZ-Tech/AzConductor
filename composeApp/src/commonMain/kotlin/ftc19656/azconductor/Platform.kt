package ftc19656.azconductor

interface Platform {
    val name: String


}

expect fun getPlatform(): Platform
