export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t py-4 px-6">
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-muted-foreground text-sm">
          沛城科技代码审查平台 - {currentYear}
        </p>
        <a
          href="https://www.paceic.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          paceic.com
        </a>
      </div>
    </footer>
  )
}
