import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  CalendarDays,
  Clock,
  Facebook,
  HandHeart,
  HeartHandshake,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  Menu,
  Phone,
  Play,
  Quote,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  X,
  Twitter,
  Heart,
  PiggyBank,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/* ---------------------------------- types --------------------------------- */

type HeroSlide = {
  eyebrow: string;
  titleA: string;
  titleB: string;
  body: string;
  image: string;
  statValue: string;
  statLabel: string;
};

type Cause = {
  id: string;
  category: 'Funeral' | 'Medical' | 'Emergency' | 'Education';
  title: string;
  excerpt: string;
  image: string;
  raised: number;
  goal: number;
  date: string;
};

type TeamMember = { name: string; role: string; image: string; initials: string };

/* ---------------------------------- data ---------------------------------- */

const HERO_SLIDES: HeroSlide[] = [
  {
    eyebrow: 'Malanga Community Welfare Group',
    titleA: 'Donate even a small one,',
    titleB: 'it can bring bigger change',
    body: 'Charity is a continuous process toward success and happiness. Join Malanga Welfare and help families access dignified funeral contributions and reliable medical care.',
    image:
      'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?q=80&w=1200&auto=format&fit=crop',
    statValue: 'KSh 115K',
    statLabel: 'Funeral contributions available',
  },
  {
    eyebrow: 'Member-first welfare circle',
    titleA: 'Happiness is not ready made,',
    titleB: 'it comes from helping',
    body: 'Alone we do not make much difference, but together we are strong. Affordable monthly contributions build a safety net for every member household.',
    image:
      'https://images.unsplash.com/photo-1593113598332-cd288d649433?q=80&w=1200&auto=format&fit=crop',
    statValue: 'KSh 200K',
    statLabel: 'Medical cover yearly maximum',
  },
  {
    eyebrow: 'For families across Kenya',
    titleA: 'Help today because tomorrow',
    titleB: 'you may need someone',
    body: 'Only when the society comes together and contributes are we able to make an impact. Fast claims, clear updates, compassionate guidance.',
    image:
      'https://images.unsplash.com/photo-1469571486292-0ba58a3f068b?q=80&w=1200&auto=format&fit=crop',
    statValue: '24/7',
    statLabel: 'Member wellbeing & contributions',
  },
];

const CATEGORIES = [
  {
    no: '01',
    title: 'Funeral Contributions',
    desc: 'Dignified burial assistance and family care.',
    icon: HeartHandshake,
    bg: 'bg-[#fdf6e3]',
  },
  {
    no: '02',
    title: 'Medical Care',
    desc: 'Hospital and consultation assistance.',
    icon: Stethoscope,
    bg: 'bg-[#e8f6f8]',
  },
  {
    no: '03',
    title: 'Emergency Relief',
    desc: 'Fast help when crisis strikes a home.',
    icon: HandHeart,
    bg: 'bg-[#fdecec]',
  },
  {
    no: '04',
    title: 'Education & Food',
    desc: 'Keep children fed and in school.',
    icon: BookOpen,
    bg: 'bg-[#eef6e9]',
  },
];

const CAUSES: Cause[] = [
  {
    id: 'c1',
    category: 'Funeral',
    title: 'Dignified Farewell for Mama Njeri’s Family',
    excerpt: 'Members rallied to cover burial costs and stand with a grieving household in Kiambu.',
    image:
      'https://images.unsplash.com/photo-1469571486292-0ba58a3f068b?q=80&w=800&auto=format&fit=crop',
    raised: 86000,
    goal: 115000,
    date: 'Mar 16, 2026',
  },
  {
    id: 'c2',
    category: 'Medical',
    title: 'Hospital Bill Contributions for Baby Baraka',
    excerpt: 'Emergency admission covered so parents could focus on recovery, not receipts.',
    image:
      'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?q=80&w=800&auto=format&fit=crop',
    raised: 142000,
    goal: 200000,
    date: 'Apr 06, 2026',
  },
  {
    id: 'c3',
    category: 'Education',
    title: 'Feed Nutritious Meals to Rural Learners',
    excerpt: 'A term of school meals for 120 pupils so no child learns on an empty stomach.',
    image:
      'https://images.unsplash.com/photo-1497486751825-1233686d5d80?q=80&w=800&auto=format&fit=crop',
    raised: 64000,
    goal: 150000,
    date: 'Apr 15, 2026',
  },
  {
    id: 'c4',
    category: 'Emergency',
    title: 'Flood Relief for Budalang’i Households',
    excerpt: 'Beddings, food packs and medical outreach after seasonal floods displaced families.',
    image:
      'https://images.unsplash.com/photo-1461532257246-777de18cd58b?q=80&w=800&auto=format&fit=crop',
    raised: 98000,
    goal: 180000,
    date: 'May 02, 2026',
  },
  {
    id: 'c5',
    category: 'Medical',
    title: 'Surgery Contributions for Mzee Otieno',
    excerpt: 'Community contributions made a life-changing operation possible within two weeks.',
    image:
      'https://images.unsplash.com/photo-1579684385127-1ef15d508118?q=80&w=800&auto=format&fit=crop',
    raised: 175000,
    goal: 200000,
    date: 'May 20, 2026',
  },
  {
    id: 'c6',
    category: 'Funeral',
    title: 'Stand With a Widowed Mother of Three',
    excerpt: 'Burial contributions plus three months of household essentials for a young family.',
    image:
      'https://images.unsplash.com/photo-1593113646773-028c64a8f1b8?q=80&w=800&auto=format&fit=crop',
    raised: 52000,
    goal: 115000,
    date: 'Jun 08, 2026',
  },
];

const DONORS = [
  { name: 'Wanjiku M., Nairobi', amount: 'KSh 2,500', img: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?q=80&w=200&auto=format&fit=crop' },
  { name: 'Otieno K., Kisumu', amount: 'KSh 5,000', img: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200&auto=format&fit=crop' },
  { name: 'Achieng A., Nakuru', amount: 'KSh 3,000', img: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=200&auto=format&fit=crop' },
  { name: 'Kamau N., Thika', amount: 'KSh 10,000', img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200&auto=format&fit=crop' },
  { name: 'Faith C., Eldoret', amount: 'KSh 1,500', img: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?q=80&w=200&auto=format&fit=crop' },
  { name: 'Musa D., Mombasa', amount: 'KSh 7,200', img: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=200&auto=format&fit=crop' },
];

const TEAM: TeamMember[] = [
  { name: 'Grace Malanga', role: 'Chairman', image: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=600&auto=format&fit=crop', initials: 'GM' },
  { name: 'Peter Ivon', role: 'Treasurer', image: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?q=80&w=600&auto=format&fit=crop', initials: 'PI' },
  { name: 'Ruth Thelma', role: 'Secretary', image: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?q=80&w=600&auto=format&fit=crop', initials: 'RT' },
  { name: 'Luke Njoroge', role: 'Member', image: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=600&auto=format&fit=crop', initials: 'LN' },
];

const TESTIMONIALS = [
  { quote: 'When my father passed, Malanga stood with us within days. Dignified, fast, human.', name: 'Lillian Grace', place: 'Kiambu', img: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=200&auto=format&fit=crop' },
  { quote: 'Hospital bills no longer keep me up at night. My whole household is covered.', name: 'Luke Nobert', place: 'Kisumu', img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200&auto=format&fit=crop' },
  { quote: 'Contributing monthly is simple, and I can see exactly where help goes.', name: 'Isaac Samuel', place: 'Nakuru', img: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=200&auto=format&fit=crop' },
];

const POSTS = [
  {
    title: 'World Health Day: How We Contribute to Care',
    date: 'Jul 13, 2026',
    img: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?q=80&w=800&auto=format&fit=crop',
    excerpt: 'Practical steps our medical cover takes — from consultation to hospital contributions.',
  },
  {
    title: 'Why Every Family Needs a Welfare Circle',
    date: 'Jul 13, 2026',
    img: 'https://images.unsplash.com/photo-1559027615-cd4628902d4a?q=80&w=800&auto=format&fit=crop',
    excerpt: 'Funeral costs should never break a family. Here is how mutual care works.',
  },
  {
    title: 'Back to School: Meals That Keep Kids Learning',
    date: 'Jul 13, 2026',
    img: 'https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?q=80&w=800&auto=format&fit=crop',
    excerpt: 'Our education contribution drive fed 120 learners this term. Join the next one.',
  },
];

const FILTERS = ['All', 'Funeral', 'Medical', 'Emergency', 'Education'] as const;

function formatKSh(n: number): string {
  return `KSh ${n.toLocaleString('en-KE')}`;
}

function pct(raised: number, goal: number): number {
  return Math.min(100, Math.round((raised / goal) * 100));
}

/* -------------------------------- component ------------------------------- */

const Index = () => {
  const navigate = useNavigate();
  const [slide, setSlide] = useState(0);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [testimonial, setTestimonial] = useState(0);

  const next = useCallback(() => setSlide((s) => (s + 1) % HERO_SLIDES.length), []);
  const prev = useCallback(() => setSlide((s) => (s - 1 + HERO_SLIDES.length) % HERO_SLIDES.length), []);

  useEffect(() => {
    const t = setInterval(next, 6500);
    return () => clearInterval(t);
  }, [next]);

  const filtered = useMemo(
    () => (filter === 'All' ? CAUSES : CAUSES.filter((c) => c.category === filter)),
    [filter],
  );

  const active = HERO_SLIDES[slide];
  const goJoin = () => navigate('/apply');
  const goAdmin = () => navigate('/login');
  const goMemberPortal = () => navigate('/login?role=member');

  return (
    <div className="min-h-screen bg-[#faf8f2] font-sans text-slate-900 antialiased">
      {/* ===== Top utility bar (Pure Hearts style) ===== */}
      <div className="bg-[#0a1f33] text-[13px] text-slate-200">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
          <div className="flex flex-wrap items-center gap-4">
            <a href="tel:+254700000000" className="flex items-center gap-1.5 hover:text-white">
              <Phone className="h-3.5 w-3.5 text-[#f7c948]" /> Helpline: +254 700 000 000
            </a>
            <a href="mailto:info@malanga.co.ke" className="hidden items-center gap-1.5 hover:text-white sm:flex">
              <Mail className="h-3.5 w-3.5 text-[#f7c948]" /> info@malanga.co.ke
            </a>
            <span className="hidden items-center gap-1.5 lg:flex">
              <MapPin className="h-3.5 w-3.5 text-[#f7c948]" /> Nairobi, Kenya
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-[#f7c948] md:flex">
              <Sparkles className="h-3.5 w-3.5" />
              <span className="text-slate-200">Update: Medical cover now up to KSh 200K per year</span>
            </span>
            <div className="flex items-center gap-2">
              <a href="#footer" aria-label="Facebook" className="rounded-full p-1.5 hover:bg-white/10"><Facebook className="h-3.5 w-3.5" /></a>
              <a href="#footer" aria-label="Twitter" className="rounded-full p-1.5 hover:bg-white/10"><Twitter className="h-3.5 w-3.5" /></a>
              <a href="#footer" aria-label="LinkedIn" className="rounded-full p-1.5 hover:bg-white/10"><Linkedin className="h-3.5 w-3.5" /></a>
              <a href="#footer" aria-label="Instagram" className="rounded-full p-1.5 hover:bg-white/10"><Instagram className="h-3.5 w-3.5" /></a>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Main header ===== */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-2.5" aria-label="Malanga home">
            <img src="/malanga-logo.png" alt="Malanga Welfare" className="h-10 w-auto object-contain sm:h-11" />
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-[15px] font-extrabold tracking-tight">Malanga Welfare</span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#3f6212]">Pure Hearts for Families</span>
            </span>
          </button>

          <nav className="hidden items-center gap-6 text-[14px] font-semibold text-slate-700 lg:flex" aria-label="Primary">
            <a href="#home" className="text-[#1a4d2e]">Home</a>
            <a href="#about" className="hover:text-[#1a4d2e]">About Us</a>
            <a href="#causes" className="hover:text-[#1a4d2e]">Causes</a>
            <a href="#events" className="hover:text-[#1a4d2e]">Events</a>
            <a href="#team" className="hover:text-[#1a4d2e]">Team</a>
            <a href="#blog" className="hover:text-[#1a4d2e]">Blog</a>
            <a href="#contact" className="hover:text-[#1a4d2e]">Contact</a>
          </nav>

          <div className="flex items-center gap-2">
            <Button variant="outline" className="hidden border-slate-300 md:inline-flex" onClick={goJoin}>
              <Heart className="mr-2 h-4 w-4 text-[#b45309]" /> Become a Member
            </Button>
            <Button className="bg-[#c2410c] text-white hover:bg-[#9a3412]" onClick={goAdmin}>
              Portal Login <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <button
              className="rounded-lg border border-slate-200 p-2 lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {mobileOpen && (
          <nav className="border-t border-slate-200 bg-white px-4 py-3 lg:hidden" aria-label="Mobile">
            <div className="grid gap-1 text-[15px] font-semibold">
              {[
                ['#home', 'Home'],
                ['#about', 'About Us'],
                ['#causes', 'Causes'],
                ['#events', 'Events'],
                ['#team', 'Team'],
                ['#blog', 'Blog'],
                ['#contact', 'Contact'],
              ].map(([href, label]) => (
                <a key={href} href={href} onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2.5 hover:bg-slate-100">
                  {label}
                </a>
              ))}
              <div className="mt-2 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={goAdmin}>Admin Sign In</Button>
                <Button className="flex-1 bg-[#c2410c] hover:bg-[#9a3412]" onClick={goMemberPortal}>Member Portal</Button>
              </div>
            </div>
          </nav>
        )}
      </header>

      {/* ===== Hero slider ===== */}
      <section id="home" className="relative overflow-hidden bg-[#0a1f33] text-white">
        <div className="absolute inset-0">
          <img key={active.image} src={active.image} alt="" className="h-full w-full object-cover opacity-30" loading="eager" />
          <div className="absolute inset-0 bg-[#0a1f33]/55" />
        </div>
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-20">
          <div>
            <Badge className="bg-[#f7c948] text-[#0a1f33] hover:bg-[#f7c948]">{active.eyebrow}</Badge>
            <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              {active.titleA}
              <span className="block text-[#f7c948]">{active.titleB}</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-200 sm:text-lg">{active.body}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button size="lg" className="bg-[#c2410c] text-white hover:bg-[#9a3412]" onClick={goJoin}>
                Join Malanga <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10" onClick={() => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' })}>
                Read More
              </Button>
            </div>
            <div className="mt-8 flex items-center gap-3">
              <button onClick={prev} aria-label="Previous slide" className="rounded-full border border-white/25 p-2.5 hover:bg-white/10"><ChevronLeft className="h-4 w-4" /></button>
              <button onClick={next} aria-label="Next slide" className="rounded-full border border-white/25 p-2.5 hover:bg-white/10"><ChevronRight className="h-4 w-4" /></button>
              <div className="ml-2 flex gap-2">
                {HERO_SLIDES.map((_, i) => (
                  <button
                    key={i}
                    aria-label={`Go to slide ${i + 1}`}
                    onClick={() => setSlide(i)}
                    className={`h-2 rounded-full transition-all ${i === slide ? 'w-8 bg-[#f7c948]' : 'w-2 bg-white/40 hover:bg-white/70'}`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="relative">
            <Card className="overflow-hidden border-white/10 bg-white text-slate-900 shadow-2xl">
              <div className="relative h-64 sm:h-80">
                <img src={active.image} alt="Community contributions" className="h-full w-full object-cover" />
                <span className="absolute left-4 top-4 rounded-full bg-[#0a1f33] px-3 py-1 text-xs font-bold uppercase tracking-widest text-[#f7c948]">
                  Running case
                </span>
              </div>
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Member wellbeing</p>
                    <p className="mt-1 text-3xl font-black">{active.statValue}</p>
                    <p className="text-sm text-slate-600">{active.statLabel}</p>
                  </div>
                  <div className="rounded-full bg-[#eef6e9] p-3 text-[#1a4d2e]"><BadgeCheck className="h-6 w-6" /></div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-[#fdf6e3] p-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-[#7c4a00]">Cases</p>
                    <p className="mt-1 font-extrabold">Verified open cases</p>
                  </div>
                  <div className="rounded-xl bg-[#e8f6f8] p-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-[#0c4a6e]">Contributions</p>
                    <p className="mt-1 font-extrabold">Fast claim process</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ===== Category strip ===== */}
      <section className="mx-auto -mt-0 grid max-w-7xl gap-4 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {CATEGORIES.map(({ no, title, desc, icon: Icon, bg }) => (
          <Card key={title} className="group overflow-hidden border border-slate-200 bg-white transition-shadow hover:shadow-lg">
            <CardContent className={`p-5 ${bg}`}>
              <div className="flex items-start justify-between">
                <span className="text-4xl font-black text-slate-900/10">{no}</span>
                <span className="rounded-full bg-white p-2.5 text-[#1a4d2e] shadow-sm"><Icon className="h-5 w-5" /></span>
              </div>
              <p className="mt-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Contribute to</p>
              <h3 className="mt-1 text-xl font-extrabold leading-snug">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{desc}</p>
              <button onClick={goJoin} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-[#c2410c] group-hover:gap-2">
                More Details <ArrowRight className="h-4 w-4" />
              </button>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* ===== About ===== */}
      <section id="about" className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
        <div className="grid items-center gap-10 rounded-3xl border border-slate-200 bg-white p-6 sm:p-10 lg:grid-cols-2">
          <div className="relative">
            <div className="grid grid-cols-2 gap-4">
              <img src="https://images.unsplash.com/photo-1559027615-cd4628902d4a?q=80&w=700&auto=format&fit=crop" alt="Volunteers packing donations" className="h-64 w-full rounded-2xl object-cover sm:h-80" loading="lazy" />
              <img src="https://images.unsplash.com/photo-1593113646773-028c64a8f1b8?q=80&w=700&auto=format&fit=crop" alt="Community gathering" className="mt-8 h-64 w-full rounded-2xl object-cover sm:h-80" loading="lazy" />
            </div>
            <div className="absolute -bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-[#0a1f33] px-5 py-3 text-white shadow-xl">
              <HeartHandshake className="h-8 w-8 text-[#f7c948]" />
              <div className="leading-tight">
                <p className="text-lg font-black">50K+ KSh funded</p>
                <p className="text-xs text-slate-300">for member families</p>
              </div>
            </div>
          </div>
          <div className="pt-6 lg:pt-0">
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#c2410c]">About Pure Hearts of Malanga</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Here to bring people together to help</h2>
            <p className="mt-4 leading-7 text-slate-600">
              Malanga Welfare is a member-led circle. Monthly contributions fund funeral cases up to KSh 115,000
              and medical cover up to KSh 200,000 a year — with clear records and compassionate follow-up.
            </p>
            <ul className="mt-5 space-y-3 text-[15px]">
              {['Provincial-style group incentives that reward consistency', 'No capital-gains stress — simple, transparent contributions', 'Carry contributions forward for your household and dependants'].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#1a4d2e]" /> <span>{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                ['1.2K+', 'Volunteers'],
                ['8.4K', 'Beneficiaries'],
                ['98%', 'Claims honoured'],
              ].map(([v, l]) => (
                <div key={l} className="rounded-2xl bg-[#faf8f2] p-4 text-center">
                  <p className="text-2xl font-black text-[#0a1f33]">{v}</p>
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{l}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button className="bg-[#0a1f33] hover:bg-[#162f4a]" onClick={goJoin}>Read More <ArrowRight className="ml-2 h-4 w-4" /></Button>
              <Button variant="outline" onClick={() => document.getElementById('causes')?.scrollIntoView({ behavior: 'smooth' })}>Explore Cases</Button>
            </div>
          </div>
        </div>

        {/* info card */}
        <div className="mt-6">
          <Card className="border border-slate-200 bg-[#0a1f33] text-white">
            <CardContent className="flex gap-4 p-6">
              <span className="h-fit rounded-2xl bg-[#f7c948] p-3 text-[#0a1f33]"><PiggyBank className="h-6 w-6" /></span>
              <div>
                <h3 className="text-xl font-extrabold">Follow every open case</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">Follow open cases, get M-Pesa friendly reminders, and read statements your family can actually understand.</p>
                <button onClick={goJoin} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-[#f7c948]">Read More <ArrowRight className="h-4 w-4" /></button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ===== Running case ===== */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#c2410c]">Running case</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Nakuru: a family needs shelter after fire</h2>
            <p className="mt-3 leading-7 text-slate-600">
              A member household lost their home and shop. Your contribution goes to temporary housing,
              food packs and school continuity for two children — tracked publicly, shilling by shilling.
            </p>
            <div className="mt-5 rounded-2xl bg-[#faf8f2] p-5">
              <div className="flex items-center justify-between text-sm font-bold">
                <span>{formatKSh(86000)} donated</span>
                <span className="text-slate-500">of {formatKSh(150000)} goal</span>
              </div>
              <Progress value={57} className="mt-3 h-2.5" />
              <div className="mt-3 flex items-center gap-4 text-sm text-slate-600">
                <span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" /> Ends Jul 30, 2026</span>
                <span className="flex items-center gap-1.5"><Users className="h-4 w-4" /> 214 donors</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button className="bg-[#c2410c] hover:bg-[#9a3412]" onClick={goJoin}>Contribute Now</Button>
                <Button variant="outline" onClick={() => document.getElementById('causes')?.scrollIntoView({ behavior: 'smooth' })}>View All Cases</Button>
              </div>
            </div>
          </div>
          <div className="relative">
            <img src="https://images.unsplash.com/photo-1461532257246-777de18cd58b?q=80&w=1000&auto=format&fit=crop" alt="Urgent relief" className="h-80 w-full rounded-3xl object-cover sm:h-[420px]" loading="lazy" />
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between rounded-2xl bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
              <div className="flex items-center gap-3">
                <Avatar><AvatarImage src="https://images.unsplash.com/photo-1531123897727-8f129e1688ce?q=80&w=100&auto=format&fit=crop" /><AvatarFallback>WM</AvatarFallback></Avatar>
                <div className="leading-tight">
                  <p className="text-sm font-extrabold">Verified by Malanga Welfare</p>
                  <p className="text-xs text-slate-500">Case #MW-2026-0841 • Nakuru</p>
                </div>
              </div>
              <Badge className="bg-[#1a4d2e] hover:bg-[#1a4d2e]">57%</Badge>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Causes ===== */}
      <section id="causes" className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#c2410c]">Our global causes</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Spread joy with a donation</h2>
          </div>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter causes">
            {FILTERS.map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-4 py-2 text-sm font-bold transition ${filter === f ? 'bg-[#0a1f33] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-400'}`}
              >
                {f === 'All' ? 'All Categories' : f}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className="group overflow-hidden border border-slate-200 bg-white transition-shadow hover:shadow-xl">
              <div className="relative h-52 overflow-hidden">
                <img src={c.image} alt={c.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-[#0a1f33]">{c.category}</span>
                <span className="absolute right-3 top-3 rounded-full bg-[#0a1f33] px-3 py-1 text-xs font-bold text-[#f7c948]">{pct(c.raised, c.goal)}%</span>
              </div>
              <CardContent className="p-5">
                <p className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <Clock className="h-3.5 w-3.5" /> {c.date} <span aria-hidden>•</span> By admin
                </p>
                <h3 className="mt-2 text-lg font-extrabold leading-snug">{c.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{c.excerpt}</p>
                <Progress value={pct(c.raised, c.goal)} className="mt-4 h-2" />
                <p className="mt-2 text-[13px] font-bold">
                  {formatKSh(c.raised)} <span className="font-medium text-slate-500">donated of {formatKSh(c.goal)} goal</span>
                </p>
                <Button className="mt-4 w-full bg-[#0a1f33] hover:bg-[#162f4a]" onClick={goJoin}>
                  Contribute to This Case <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ===== Donors ===== */}
      <section className="bg-[#0a1f33] py-12 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#f7c948]">Recent donors</p>
          <h2 className="mt-2 max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">Thousands of donors choose Malanga for high impact causes</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {DONORS.map((d) => (
              <div key={d.name} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <Avatar className="h-11 w-11"><AvatarImage src={d.img} alt={d.name} /><AvatarFallback>{d.name.slice(0, 2)}</AvatarFallback></Avatar>
                <div>
                  <p className="text-[15px] font-extrabold">{d.name}</p>
                  <p className="text-sm text-[#f7c948]">Donated {d.amount}</p>
                </div>
                <Heart className="ml-auto h-4 w-4 text-[#f7c948]" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Benefits ===== */}
      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-2">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#c2410c]">Benefits of giving</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Bring more meaning to your life & family</h2>
          <p className="mt-3 leading-7 text-slate-600">Giving through a structured welfare circle multiplies dignity — for the receiver and the giver.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {[
              ['Improve Self-Esteem', 'Know your household and neighbours are protected.'],
              ['Reduce Your Stress', 'Hospital and funeral shocks become cases the whole circle helps resolve.'],
              ['Financial Benefits', 'Small monthly amounts unlock large cover when needed.'],
              ['Familial Benefits', 'Dependants, parents and children stay in one safety net.'],
            ].map(([t, d], i) => (
              <div key={t} className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-3xl font-black text-slate-200">0{i + 1}</p>
                <h3 className="mt-1 font-extrabold">{t}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{d}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="relative">
          <img src="https://images.unsplash.com/photo-1559027615-cd4628902d4a?q=80&w=1000&auto=format&fit=crop" alt="Giving benefits" className="h-full min-h-[320px] w-full rounded-3xl object-cover" loading="lazy" />
          <div className="absolute bottom-4 left-4 right-4 rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-[#1a4d2e] p-2.5 text-white"><ShieldCheck className="h-5 w-5" /></span>
              <div>
                <p className="font-extrabold">Transparent welfare ledger</p>
                <p className="text-sm text-slate-600">Every contribution and payout is recorded and auditable.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Video tour ===== */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#c2410c]">Charity video tour</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Social art for behaviour change</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {[
              ['How welfare circles work', 'https://images.unsplash.com/photo-1593113598332-cd288d649433?q=80&w=800&auto=format&fit=crop'],
              ['What aid has done for 8,000 families', 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?q=80&w=800&auto=format&fit=crop'],
              ['Volunteer stories from the field', 'https://images.unsplash.com/photo-1469571486292-0ba58a3f068b?q=80&w=800&auto=format&fit=crop'],
            ].map(([title, img]) => (
              <button key={title} onClick={goJoin} className="group relative overflow-hidden rounded-3xl text-left" aria-label={`Play video: ${title}`}>
                <img src={img} alt={title} className="h-64 w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                <span className="absolute inset-0 bg-black/35" />
                <span className="absolute inset-0 flex flex-col items-start justify-end p-5">
                  <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#f7c948] text-[#0a1f33]"><Play className="h-5 w-5 fill-current" /></span>
                  <span className="text-lg font-extrabold leading-snug text-white">{title}</span>
                  <span className="mt-1 text-xs font-bold uppercase tracking-widest text-white/80">Watch • 2:48</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Events ===== */}
      <section id="events" className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#c2410c]">Our recent events</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Here to bring people together</h2>
          </div>
          <Button variant="outline" onClick={goJoin}>Become a Sponsor</Button>
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            ['Welfare Registration Drive', '16 Mar • 10:00 AM • Nairobi', 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?q=80&w=800&auto=format&fit=crop'],
            ['Community Health Camp', '06 Apr • 10:00 AM • Kisumu', 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?q=80&w=800&auto=format&fit=crop'],
            [' charity Walk & Fundraiser', '15 Apr • 09:00 AM • Nakuru', 'https://images.unsplash.com/photo-1559027615-cd4628902d4a?q=80&w=800&auto=format&fit=crop'],
          ].map(([title, meta, img]) => (
            <Card key={title} className="overflow-hidden border border-slate-200 bg-white">
              <div className="relative h-48">
                <img src={img} alt={title} className="h-full w-full object-cover" loading="lazy" />
                <span className="absolute bottom-3 left-3 rounded-xl bg-[#0a1f33] px-3 py-1.5 text-xs font-bold text-white">{meta}</span>
              </div>
              <CardContent className="p-5">
                <h3 className="text-lg font-extrabold">{title.trim()}</h3>
                <button onClick={goJoin} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-[#c2410c]">
                  More Details <ArrowRight className="h-4 w-4" />
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ===== Team ===== */}
      <section id="team" className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <p className="text-center text-sm font-bold uppercase tracking-[0.22em] text-[#c2410c]">Meet our team</p>
          <h2 className="mt-2 text-center text-3xl font-black tracking-tight sm:text-4xl">Most passionate team members</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {TEAM.map((m) => (
              <Card key={m.name} className="overflow-hidden border border-slate-200 text-center">
                <div className="h-64 overflow-hidden bg-slate-100">
                  <img src={m.image} alt={m.name} className="h-full w-full object-cover" loading="lazy" />
                </div>
                <CardContent className="p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-[#c2410c]">{m.role}</p>
                  <h3 className="mt-1 text-lg font-extrabold">{m.name}</h3>
                  <div className="mt-3 flex justify-center gap-2">
                    {[Facebook, Twitter, Linkedin].map((Icon, i) => (
                      <span key={i} className="rounded-full bg-slate-100 p-2 text-slate-600"><Icon className="h-3.5 w-3.5" /></span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Testimonials ===== */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="rounded-3xl bg-[#0a1f33] p-6 text-white sm:p-10">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#f7c948]">Testimonials</p>
          <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="max-w-xl text-3xl font-black tracking-tight sm:text-4xl">Success stories, to know about our welfare</h2>
            <div className="flex gap-2">
              <button aria-label="Previous testimonial" onClick={() => setTestimonial((t) => (t - 1 + TESTIMONIALS.length) % TESTIMONIALS.length)} className="rounded-full border border-white/25 p-2.5 hover:bg-white/10"><ChevronLeft className="h-4 w-4" /></button>
              <button aria-label="Next testimonial" onClick={() => setTestimonial((t) => (t + 1) % TESTIMONIALS.length)} className="rounded-full border border-white/25 p-2.5 hover:bg-white/10"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {TESTIMONIALS.map((t, i) => (
              <div key={t.name} className={`rounded-2xl p-6 ${i === testimonial ? 'bg-white text-slate-900' : 'bg-white/5 text-white'}`}>
                <Quote className={`h-6 w-6 ${i === testimonial ? 'text-[#c2410c]' : 'text-[#f7c948]'}`} />
                <p className="mt-3 font-bold leading-7">“{t.quote}”</p>
                <div className="mt-4 flex items-center gap-3">
                  <Avatar><AvatarImage src={t.img} alt={t.name} /><AvatarFallback>{t.name.slice(0, 2)}</AvatarFallback></Avatar>
                  <div>
                    <p className="text-sm font-extrabold">{t.name}</p>
                    <p className={`text-xs ${i === testimonial ? 'text-slate-500' : 'text-slate-300'}`}>{t.place}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Blog ===== */}
      <section id="blog" className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
        <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#c2410c]">Blog & article</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Check latest blog post</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {POSTS.map((p) => (
            <Card key={p.title} className="overflow-hidden border border-slate-200 bg-white">
              <div className="h-56 overflow-hidden"><img src={p.img} alt={p.title} className="h-full w-full object-cover" loading="lazy" /></div>
              <CardContent className="p-5">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{p.date} • Latest News</p>
                <h3 className="mt-2 text-lg font-extrabold leading-snug">{p.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{p.excerpt}</p>
                <button onClick={goJoin} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-[#c2410c]">Read More <ArrowRight className="h-4 w-4" /></button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* CTA banner */}
        <div className="mt-10 grid items-center gap-6 rounded-3xl bg-[#c2410c] p-6 text-white sm:p-10 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Partner with us — charity of choice</h2>
            <p className="mt-2 max-w-2xl text-orange-100">Every pleasure avoided is pain prevented. Join 1,200+ members contributing to Kenyan families with dignity.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" className="bg-white text-[#9a3412] hover:bg-orange-50" onClick={goJoin}>Join With Us <ArrowRight className="ml-2 h-4 w-4" /></Button>
            <Button size="lg" variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10" onClick={goAdmin}>Admin Sign In</Button>
          </div>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer id="footer" className="bg-[#0a1f33] text-slate-300">
        <div id="contact" className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-4">
          <div>
            <img src="/malanga-logo.png" alt="Malanga Welfare" className="h-11 w-auto rounded-lg bg-white p-1" />
            <p className="mt-4 text-sm leading-6">Member-first welfare contributions for funeral and medical needs across Kenya. Transparent, fast, compassionate.</p>
            <div className="mt-4">
              <p className="font-extrabold text-white">Subscribe our newsletter</p>
              <form className="mt-2 flex gap-2" onSubmit={(e) => e.preventDefault()}>
                <label htmlFor="newsletter-email" className="sr-only">Email address</label>
                <input id="newsletter-email" type="email" required placeholder="Email address" className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-slate-400" />
                <Button type="submit" className="bg-[#f7c948] text-[#0a1f33] hover:bg-[#f5bc2b]">Join</Button>
              </form>
            </div>
          </div>
          <nav aria-label="Our welfare">
            <p className="font-extrabold text-white">Our Welfare</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {['About us', 'Become a Member', 'Contact', 'FAQs', 'Donations', 'Events'].map((l) => (
                <li key={l}><a href="#about" className="hover:text-white">{l}</a></li>
              ))}
            </ul>
          </nav>
          <nav aria-label="For members">
            <p className="font-extrabold text-white">For Members</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {['Funeral Contributions', 'Medical Cover', 'Emergency Relief', 'Education & Food', 'Sponsorships'].map((l) => (
                <li key={l}><a href="#causes" className="hover:text-white">{l}</a></li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="font-extrabold text-white">Giving / Enquiry</p>
            <a href="tel:+254700000000" className="mt-4 block text-lg font-black text-[#f7c948]">(+254) 700 000 000</a>
            <a href="mailto:info@malanga.co.ke" className="text-sm hover:text-white">info@malanga.co.ke</a>
            <p className="mt-3 flex items-start gap-2 text-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#f7c948]" /> Nairobi, Kenya — serving families countrywide.</p>
            <div className="mt-4 flex gap-2">
              {[Facebook, Twitter, Linkedin, Instagram].map((Icon, i) => (
                <a key={i} href="#footer" aria-label="Social link" className="rounded-full border border-white/15 p-2 hover:bg-white/10"><Icon className="h-4 w-4" /></a>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-5 text-[13px] sm:flex-row sm:px-6">
            <span>© {new Date().getFullYear()} Malanga Community Welfare Group. All Rights Reserved.</span>
            <span>Powered by <a href="https://mobiwave.co.ke" target="_blank" rel="noreferrer" className="font-bold text-white underline-offset-4 hover:underline">MOBIWAVE INNOVATIONS LTD.</a></span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
