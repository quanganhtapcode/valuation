export default function Loading() {
    return (
        <div role="status" aria-label="Đang tải / Loading" className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6">
            <div aria-hidden="true" className="animate-pulse motion-reduce:animate-none">
                <div className="mb-5 h-8 w-56 rounded bg-slate-200 dark:bg-slate-800" />
                <div className="mb-5 h-28 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
                <div className="grid gap-5 lg:grid-cols-3">
                    <div className="h-96 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:col-span-2" />
                    <div className="h-96 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
                </div>
            </div>
        </div>
    );
}
