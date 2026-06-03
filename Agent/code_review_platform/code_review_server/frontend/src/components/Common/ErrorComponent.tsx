import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"

const ErrorComponent = () => {
  const resetSession = () => {
    localStorage.removeItem("access_token")
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center flex-col p-4"
      data-testid="error-component"
    >
      <div className="flex items-center z-10">
        <div className="flex flex-col ml-4 items-center justify-center p-4">
          <span className="text-6xl md:text-8xl font-bold leading-none mb-4">
            出错了
          </span>
          <span className="text-2xl font-bold mb-2">请稍后重试</span>
        </div>
      </div>

      <p className="text-lg text-muted-foreground mb-4 text-center z-10">
        系统发生异常，请重新登录后再试。
      </p>
      <Link to="/login" onClick={resetSession}>
        <Button>返回登录</Button>
      </Link>
    </div>
  )
}

export default ErrorComponent
