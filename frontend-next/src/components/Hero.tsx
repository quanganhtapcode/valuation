import { RiPlayCircleFill, RiArrowRightLine } from "@remixicon/react"
import Link from "next/link"
import { Button } from "@/components/Button"

export default function Hero() {
    return (
        <section
            aria-labelledby="hero-title"
            className="relative mt-20 flex flex-col items-center justify-center text-center sm:mt-28 px-4 overflow-hidden"
        >
            {/* Background Glow */}
            {/* Background Glow removed as requested */}

            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200/50 bg-blue-50/50 px-4 py-1.5 text-sm font-semibold text-blue-600 backdrop-blur-md dark:border-blue-800/30 dark:bg-blue-900/20 dark:text-blue-400">
                <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                AI Agent
            </div>

            <h1
                id="hero-title"
                className="max-w-4xl inline-block animate-slide-up-fade bg-gradient-to-br from-gray-950 via-gray-800 to-gray-700 bg-clip-text p-2 text-5xl font-black tracking-tight text-transparent sm:text-7xl md:text-8xl dark:from-white dark:via-gray-200 dark:to-gray-400"
                style={{ animationDuration: "700ms", lineHeight: 1.1 }}
            >
                Investing <br className="hidden sm:block" /> with <span className="text-blue-600 dark:text-blue-500">Clarity</span>
            </h1>

            <p
                className="mt-8 max-w-2xl animate-slide-up-fade text-lg sm:text-xl text-gray-600 dark:text-gray-400 leading-relaxed"
                style={{ animationDuration: "900ms" }}
            >
                Experience professional-grade stock analysis and market intelligence. We bridge complex data and actionable decisions with AI-driven models.
            </p>

            <div
                className="mt-10 flex w-full animate-slide-up-fade flex-col justify-center items-center gap-4 px-3 sm:flex-row"
                style={{ animationDuration: "1100ms" }}
            >
                <Button className="h-12 px-8 font-bold text-base shadow-lg shadow-blue-500/20" asChild>
                    <Link href="/overview" className="flex items-center gap-2">
                        Get Started <RiArrowRightLine size={18} />
                    </Link>
                </Button>

                <Button
                    asChild
                    variant="light"
                    className="group h-12 gap-x-2 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm border border-gray-200 dark:border-gray-800 font-bold hover:bg-white dark:hover:bg-gray-800 transition-all shadow-sm"
                >
                    <Link href="#">
                        <RiPlayCircleFill
                            aria-hidden="true"
                            className="size-6 shrink-0 text-blue-600 dark:text-blue-400"
                        />
                        Watch Product Tour
                    </Link>
                </Button>
            </div>
        </section>
    )
}
