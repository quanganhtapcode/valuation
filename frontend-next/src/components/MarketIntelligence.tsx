"use client"
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import createGlobe from 'cobe';

function GlobeCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        let phi = 4;
        let globe: ReturnType<typeof createGlobe>;

        if (canvasRef.current) {
            globe = createGlobe(canvasRef.current, {
                devicePixelRatio: 2,
                width: 800 * 2,
                height: 800 * 2,
                phi: 0,
                theta: -0.3,
                dark: 0,
                diffuse: 1.2,
                mapSamples: 30000,
                mapBrightness: 13,
                mapBaseBrightness: 0.01,
                baseColor: [1, 1, 1],
                glowColor: [1, 1, 1],
                markerColor: [100, 100, 100],
                markers: [
                    { location: [14.0583, 108.2772], size: 0.03 } // Vietnam center approx
                ],
                onRender: (state) => {
                    state.phi = phi;
                    phi += 0.0005;
                },
            });
        }

        return () => {
            if (globe) {
                globe.destroy();
            }
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{ width: 800, height: 800 }}
            className="absolute -right-72 top-40 z-0 aspect-square size-full max-w-fit transition-transform group-hover:scale-[1.01] sm:top-12 lg:-right-60 lg:top-0"
        />
    );
}

export default function MarketIntelligence() {
    return (
        <section aria-labelledby="market-intelligence-title" className="mx-auto mt-20 w-full max-w-6xl px-3">
            <h2 id="market-intelligence-title" className="sr-only">Market Intelligence</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* Left Card - Real-time market intelligence */}
                <div className="group relative overflow-hidden rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
                    <div className="relative z-10 flex h-full flex-col justify-between">
                        <div>
                            <h3 className="text-2xl font-semibold text-gray-900 dark:text-gray-50">
                                Real-time market intelligence
                            </h3>
                            <p className="mt-4 max-w-[60%] text-gray-600 dark:text-gray-400">
                                Track price action, volume shifts, and valuation signals across the Vietnamese market in one place.
                            </p>
                        </div>
                        <div className="mt-8">
                            <Link href="/overview" className="inline-flex items-center text-sm font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-400">
                                Explore platform
                                <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </Link>
                        </div>
                    </div>
                    {/* Globe Canvas */}
                    <GlobeCanvas />

                    {/* Add a subtle gradient overlay to make text readable if needed, though with Globe moved right it might be fine without heavily obstructing text */}
                    {/* <div className="absolute inset-0 bg-gradient-to-r from-white via-white/80 to-transparent dark:from-gray-900 dark:via-gray-900/80 pointer-events-none" /> */}
                </div>

                {/* Right Card - Blue Quote */}
                <div className="relative overflow-hidden rounded-2xl bg-blue-600 p-8 shadow-sm text-white">
                    <div className="relative z-10 flex h-full flex-col justify-between">
                        <blockquote className="text-xl font-medium leading-relaxed">
                            &quot;We built this platform to make research faster, clearer, and more accessible to every investor.&quot;
                        </blockquote>
                        <div className="mt-8">
                            <p className="font-semibold">Product Team</p>
                            <p className="text-blue-200">Market Insights Desk</p>
                        </div>
                    </div>
                    {/* Decorative circles */}
                    <div className="absolute top-0 right-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-blue-500/30 blur-3xl"></div>
                    <div className="absolute bottom-0 left-0 -ml-16 -mb-16 h-64 w-64 rounded-full bg-blue-700/30 blur-3xl"></div>
                </div>
            </div>
        </section>
    );
}
