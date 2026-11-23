import type { Metadata } from 'next';
import { BookOpen, Bug, Code2, ExternalLink, Github, Scale, ShieldCheck } from 'lucide-react';
import { PageContainer } from '@/components/PageContainer';
import IllamLogo, { IllamWordmark } from '@/components/IllamLogo';
import { ABOUT, repoLink } from '@/lib/about';

export const metadata: Metadata = { title: 'About · Illam' };

const linkRow = 'flex items-center justify-between gap-3 py-3 text-sm text-gray-700 hover:text-gray-900';

function Row({ href, icon: Icon, label, hint }: { href: string; icon: typeof Code2; label: string; hint?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkRow}>
      <span className="flex items-center gap-3">
        <Icon size={18} className="text-gray-400" aria-hidden />
        <span>
          <span className="block font-medium text-gray-900">{label}</span>
          {hint && <span className="block text-xs text-gray-500">{hint}</span>}
        </span>
      </span>
      <ExternalLink size={14} className="text-gray-300" aria-hidden />
    </a>
  );
}

export default function AboutPage() {
  return (
    <PageContainer maxWidth="2xl">
      <div className="mb-8 flex flex-col items-center text-center">
        <IllamLogo size={64} />
        <h1 className="mt-4 text-gray-900">
          <IllamWordmark height={30} />
        </h1>
        <p className="mt-2 text-sm text-gray-500">Household finance for Indian families, on your own server.</p>
        <p className="mt-1 text-xs text-gray-400">Version {ABOUT.version}</p>
      </div>

      <section className="card mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Open source</h2>
        <p className="mt-1 text-sm text-gray-600">
          Illam is free software under the {ABOUT.licence.name}. You can read, change and run it yourself, and
          anyone who uses a copy can get its source.
        </p>
        <div className="mt-2 divide-y divide-gray-100">
          <Row href={repoLink()} icon={Code2} label="Source code" hint={ABOUT.repo.replace('https://', '')} />
          <Row href={ABOUT.licence.url} icon={Scale} label="Licence" hint={ABOUT.licence.name} />
          <Row href={repoLink('/blob/main/CHANGELOG.md')} icon={BookOpen} label="What's new" hint="Changelog" />
          <Row href={repoLink('/issues')} icon={Bug} label="Report a problem" hint="GitHub issues" />
          <Row href={repoLink('/security/advisories/new')} icon={ShieldCheck} label="Report a security issue" hint="Privately" />
        </div>
      </section>

      <section className="card mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Made by</h2>
        <p className="mt-1 text-sm text-gray-600">
          Illam is an open-source project from{' '}
          <a href={ABOUT.maker.url} target="_blank" rel="noreferrer" className="font-medium text-primary-700 hover:underline">
            {ABOUT.maker.name}
          </a>{' '}
          ({ABOUT.maker.url.replace('https://', '')}). Contributions are welcome.{' '}
          <a href={repoLink('/blob/main/CONTRIBUTING.md')} target="_blank" rel="noreferrer" className="font-medium text-primary-700 hover:underline">
            See how to help
          </a>
          .
        </p>
        <div className="mt-2 divide-y divide-gray-100">
          {ABOUT.maintainers.map((m) => (
            <Row key={m.github} href={`https://github.com/${m.github}`} icon={Github} label={m.name} hint={`${m.role} · @${m.github}`} />
          ))}
        </div>
      </section>

      <section className="card mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Your data</h2>
        <p className="mt-1 text-sm text-gray-600">
          This copy of Illam runs on your household&apos;s own server. The people who make Illam never see your
          expenses, accounts or mail; nothing is sent to them.
        </p>
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold text-gray-900">Built with</h2>
        <p className="mt-2 text-sm text-gray-600">
          {ABOUT.builtWith.map((b, i) => (
            <span key={b.name}>
              {i > 0 && ' · '}
              <a href={b.url} target="_blank" rel="noreferrer" className="hover:text-gray-900 hover:underline">
                {b.name}
              </a>
            </span>
          ))}
        </p>
      </section>
    </PageContainer>
  );
}
