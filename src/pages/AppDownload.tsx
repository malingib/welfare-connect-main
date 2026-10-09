import { ArrowLeft, Check, Download, Smartphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const APK_URL = '/malanga-welfare.apk';

const AppDownload = () => (
  <main className="min-h-screen bg-[#faf8f2] text-slate-900">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link to="/" className="flex items-center gap-3" aria-label="Malanga Welfare home">
          <img src="/malanga-logo.png" alt="" className="h-10 w-auto" />
          <span className="font-extrabold tracking-tight">Malanga Welfare</span>
        </Link>
        <Link to="/" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a4d2e]">
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>
      </div>
    </header>

    <section className="overflow-hidden bg-[#0a1f33] text-white">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.2fr_0.8fr] lg:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#f7c948]">Android companion app</p>
          <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">Malanga Welfare, wherever you are.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-200 sm:text-lg">
            Download the official Android app to access your member portal from your phone.
          </p>
          <a href={APK_URL} download="malanga-welfare.apk" className="mt-8 inline-flex min-h-12 items-center justify-center rounded-lg bg-[#f7c948] px-6 py-3 font-bold text-[#0a1f33] transition-colors hover:bg-[#ffe07a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a1f33]">
            <Download className="mr-2 h-5 w-5" /> Download for Android
          </a>
          <p className="mt-3 text-sm text-slate-300">APK file · about 73 MB · Android phones and tablets</p>
        </div>

        <div className="relative mx-auto flex w-full max-w-sm items-center justify-center py-4" aria-hidden="true">
          <div className="absolute h-64 w-64 rounded-full bg-[#1a4d2e]/70 blur-3xl" />
          <div className="relative flex aspect-[4/5] w-56 flex-col items-center justify-center rounded-[2.5rem] border border-white/20 bg-white/[0.07] p-6 text-center shadow-2xl sm:w-64">
            <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-[#f7c948] text-[#0a1f33]">
              <Smartphone className="h-10 w-10" />
            </span>
            <p className="mt-6 text-xl font-extrabold">Malanga Welfare</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">Your member portal, on Android</p>
            <span className="mt-7 inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200">
              <Check className="h-3.5 w-3.5 text-[#f7c948]" /> Official app download
            </span>
          </div>
        </div>
      </div>
    </section>

    <section className="mx-auto grid max-w-7xl gap-12 px-4 py-14 sm:px-6 md:grid-cols-[0.75fr_1.25fr] md:py-16">
      <div>
        <h2 className="text-2xl font-black tracking-tight">Install in a few steps</h2>
        <p className="mt-3 max-w-md leading-7 text-slate-600">After the download finishes, open the APK file and follow Android’s installation prompts.</p>
      </div>
      <ol className="grid gap-0 sm:grid-cols-3">
        {[
          ['Download', 'Tap the download button and wait for the APK file to finish downloading.'],
          ['Open the file', 'Open the downloaded APK from your browser or Downloads folder.'],
          ['Install', 'If prompted, allow your browser to install unknown apps, return to the APK, then tap Install.'],
        ].map(([title, detail], index) => (
          <li key={title} className="border-t border-slate-300 py-5 sm:border-l sm:border-t-0 sm:pl-5 sm:pr-4">
            <span className="text-sm font-bold text-[#c2410c]">STEP 0{index + 1}</span>
            <h3 className="mt-2 font-extrabold">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
          </li>
        ))}
      </ol>
    </section>

    <aside className="mx-auto mb-14 max-w-7xl px-4 sm:px-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <p className="max-w-3xl text-sm leading-6 text-slate-600">For your safety, install the app only from the official Malanga Welfare website. If Android prompts you, tap Settings, enable “Allow from this source” for your browser, return to the downloaded APK, and continue installation.</p>
        <Button asChild variant="outline" className="shrink-0 border-slate-300">
          <Link to="/login?role=member">Use member portal online</Link>
        </Button>
      </div>
    </aside>
  </main>
);

export default AppDownload;
