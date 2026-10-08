import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Facebook,
  HandHeart,
  HeartHandshake,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  Menu,
  Quote,
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

type TeamMember = { name: string; role: string; image: string; initials: string; phone: string };

/* ---------------------------------- data ---------------------------------- */

const HERO_SLIDES: HeroSlide[] = [
  {
    eyebrow: 'Apply to join Malanga Community Welfare Group',
    titleA: 'One family.',
    titleB: 'One community. One support system.',
    body: 'Malanga Community Welfare is a united network of families helping one another through grief and difficult seasons with dignity and care.',
    image:
      'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?q=80&w=1200&auto=format&fit=crop',
    statValue: 'KSh 120',
    statLabel: 'Member contribution during bereavement support',
  },
  {
    eyebrow: 'Built for neighbourly care',
    titleA: 'Support that moves',
    titleB: 'with your community',
    body: 'We stand together as one family across Malanga and neighbouring sub-locations, making sure no member household faces hardship alone.',
    image:
      'https://images.unsplash.com/photo-1593113598332-cd288d649433?q=80&w=1200&auto=format&fit=crop',
    statValue: 'KSh 200',
    statLabel: 'Registration fee to join the welfare',
  },
  {
    eyebrow: 'Transparent and compassionate',
    titleA: 'A modern welfare group',
    titleB: 'rooted in care and unity',
    body: 'From bereavement support to member administration, Malanga is designed to be easier, faster and more transparent for every household we serve.',
    image:
      'https://images.unsplash.com/photo-1469571486292-0ba58a3f068b?q=80&w=1200&auto=format&fit=crop',
    statValue: '90–180',
    statLabel: 'Day probation period before benefit eligibility',
  },
];

const CATEGORIES = [
  {
    no: '01',
    title: 'Education',
    desc: 'Support for education-related needs.',
    icon: BookOpen,
    bg: 'bg-[#eef6e9]',
  },
  {
    no: '02',
    title: 'Funeral Contributions',
    desc: 'Dignified burial assistance and family care.',
    icon: HeartHandshake,
    bg: 'bg-[#fdf6e3]',
  },
  {
    no: '03',
    title: 'Medical Emergencies',
    desc: 'Fast help when crisis strikes a home.',
    icon: HandHeart,
    bg: 'bg-[#fdecec]',
  },
];

const TEAM: TeamMember[] = [
  { name: 'Nguma Nyiro', role: 'Chairman', image: '', initials: 'NN', phone: '0723347646' },
  { name: 'Justine Kiti', role: 'Treasurer', image: '', initials: 'JK', phone: '0714217898' },
  { name: 'Obadiah Nyiro', role: 'Secretary', image: '', initials: 'ON', phone: '0727273618' },
  { name: 'Herbert Kahindi', role: 'ICT Liaison', image: '', initials: 'HK', phone: '0798623944' },
];

const TESTIMONIALS = [
  { quote: 'When my father passed, Malanga stood with us within days. Dignified, fast, human.', name: 'Lillian Grace', place: 'Kiambu', img: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=200&auto=format&fit=crop' },
  { quote: 'Knowing my community will stand with my family when life gets hard gives me real peace of mind.', name: 'Luke Nobert', place: 'Kisumu', img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200&auto=format&fit=crop' },
  { quote: 'When a case arises, we come together and support each other with dignity and speed.', name: 'Isaac Samuel', place: 'Nakuru', img: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=200&auto=format&fit=crop' },
];

/* -------------------------------- component ------------------------------- */

const Index = () => {
  const navigate = useNavigate();
  const [slide, setSlide] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [testimonial, setTestimonial] = useState(0);

  const next = useCallback(() => setSlide((s) => (s + 1) % HERO_SLIDES.length), []);
  const prev = useCallback(() => setSlide((s) => (s - 1 + HERO_SLIDES.length) % HERO_SLIDES.length), []);

  useEffect(() => {
    const t = setInterval(next, 6500);
    return () => clearInterval(t);
  }, [next]);

  const active = HERO_SLIDES[slide];
  const goJoin = () => navigate('/apply');
  const goAdmin = () => navigate('/login');
  const goMemberPortal = () => navigate('/login?role=member');

  return (
    <div className="min-h-screen bg-[#faf8f2] font-sans text-slate-900 antialiased">
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
            <a href="#team" className="hover:text-[#1a4d2e]">Team</a>
            <a href="#contact" className="hover:text-[#1a4d2e]">Contact</a>
          </nav>

          <div className="flex items-center gap-2">
            <Button variant="outline" className="hidden border-slate-300 md:inline-flex" onClick={goJoin}>
              <Heart className="mr-2 h-4 w-4 text-[#b45309]" /> Become a Member
            </Button>
            <Button className="hidden bg-[#c2410c] text-white hover:bg-[#9a3412] md:inline-flex" onClick={goMemberPortal}>
              Member Login
            </Button>
            <Button variant="outline" className="hidden border-slate-300 md:inline-flex" onClick={goAdmin}>
              Admin Login
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
                ['#team', 'Team'],
                ['#contact', 'Contact'],
              ].map(([href, label]) => (
                <a key={href} href={href} onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2.5 hover:bg-slate-100">
                  {label}
                </a>
              ))}
              <div className="mt-2 grid gap-2">
                <Button variant="outline" className="w-full" onClick={goJoin}>Become a Member</Button>
                <Button className="w-full bg-[#c2410c] hover:bg-[#9a3412]" onClick={goMemberPortal}>Member Login</Button>
                <Button variant="outline" className="w-full" onClick={goAdmin}>Admin Login</Button>
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

        </div>
      </section>

      {/* ===== Category strip ===== */}
      <section className="mx-auto -mt-0 grid max-w-7xl gap-4 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
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
            </CardContent>
          </Card>
        ))}
      </section>

      {/* ===== About ===== */}
      <section id="about" className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-10">
          <div className="pt-6 lg:pt-0">
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#c2410c]">Apply to join Malanga Community Welfare Group</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">One family. One community. One support system.</h2>
            <p className="mt-4 leading-7 text-slate-600">
              Malanga Community Welfare is one of the largest and most organized community welfare groups, founded by residents of Malanga and now open to residents of neighbouring sub-locations, including Matanomane, Dzikunze, Kaembeni, Langobaya, Vitengeni, Ndugumnani, Viriko, Sosobora, Kakoneni and Girimacha.
            </p>
            <p className="mt-4 leading-7 text-slate-600">
              We stand together as one family, supporting and caring for one another during times of bereavement and unexpected hardship. Currently, the welfare is operating under the Death/Bereavement Pillar.
            </p>
            <ul className="mt-5 space-y-3 text-[15px]">
              {['Members contribute KSh 120 whenever a committed member experiences bereavement or a qualifying distress situation.', 'Probation is 90 or 180 days depending on the applicable rules before benefits are accessible.', 'All members under 75 years are eligible to join, with family support extending to spouses and children under 25.'].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#1a4d2e]" /> <span>{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button className="bg-[#0a1f33] hover:bg-[#162f4a]" onClick={goJoin}>Join Malanga <ArrowRight className="ml-2 h-4 w-4" /></Button>
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

      {/* ===== Benefits ===== */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#c2410c]">Benefits of giving</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Bring more meaning to your life & family</h2>
          <p className="mt-3 leading-7 text-slate-600">Giving through a structured welfare circle multiplies dignity — for the receiver and the giver.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {[
              ['Improve Self-Esteem', 'Know your household and neighbours have support.'],
              ['Reduce Your Stress', 'Funeral and emergency shocks become cases the whole circle helps resolve.'],
              ['Financial Benefits', 'Small monthly contributions create meaningful support when needed.'],
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
      </section>

      {/* ===== Team ===== */}
      <section id="team" className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <p className="text-center text-sm font-bold uppercase tracking-[0.22em] text-[#c2410c]">Meet our team</p>
          <h2 className="mt-2 text-center text-3xl font-black tracking-tight sm:text-4xl">Most passionate team members</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {TEAM.map((m) => (
              <Card key={m.name} className="overflow-hidden border border-slate-200 text-center">
                <CardContent className="p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-[#c2410c]">{m.role}</p>
                  <h3 className="mt-2 text-lg font-extrabold">{m.name}</h3>
                  <a href={`tel:${m.phone}`} className="mt-3 inline-block text-sm font-semibold text-slate-700 hover:text-[#0a1f33]">
                    {m.phone}
                  </a>
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
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA banner ===== */}
      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
        <div className="mt-10 grid items-center gap-6 rounded-3xl bg-[#c2410c] p-6 text-white sm:p-10 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Join us — Welfare of choice</h2>
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
            <p className="mt-4 text-sm leading-6">Member-first welfare contributions for funeral support and family emergencies across Kenya. Transparent, fast, compassionate.</p>
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
              {['Funeral Contributions', 'Medical Emergencies', 'Sponsorships'].map((l) => (
                <li key={l}><a href="#causes" className="hover:text-white">{l}</a></li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="font-extrabold text-white">Enquiry</p>
            <a href="tel:+254799705950" className="mt-4 block text-lg font-black text-[#f7c948]">+254799705950</a>
            <a href="mailto:info@malanga.co.ke" className="text-sm hover:text-white">info@malanga.co.ke</a>
            <p className="mt-3 flex items-start gap-2 text-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#f7c948]" /> Malindi, Kenya — serving families countrywide.</p>
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
