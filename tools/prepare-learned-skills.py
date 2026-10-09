"""Finish explicitly selected skill installs: local references, licenses and provenance.

Only named, previously installed directories are changed. No application or
third-party helper from the reviewed repositories is executed.
"""
import argparse, hashlib, json, shutil
from pathlib import Path

PSTACK = ['principle-model-the-domain', 'principle-make-operations-idempotent',
          'principle-fix-root-causes', 'principle-explain-the-number',
          'principle-prove-it-works', 'benchmark-checklist']
ADDY = ['debugging-and-error-recovery', 'observability-and-instrumentation', 'performance-optimization']
REPOS = {
    'pstack': ('backnotprop/pstack', '3a604672c46cd8187d2b19980eae0a34f9f91138'),
    'agent-skills': ('addyosmani/agent-skills', '1401c8b8030e023baeebb31781a6653fe8e93026'),
    'SwiftUI-Agent-Skill': ('twostraws/SwiftUI-Agent-Skill', 'f9800713b24580bc444931949aad4519128605e8'),
    'daily_stock_analysis': ('ZhuLinsen/daily_stock_analysis', 'ce364e457aab288863a5707e7b3df79786ad07f2'),
}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources-root', type=Path, required=True)
    parser.add_argument('--skills-root', type=Path, required=True)
    args = parser.parse_args()
    sources, skills = args.sources_root.resolve(), args.skills_root.resolve()
    project = Path(__file__).resolve().parents[1]
    records = []
    for repo, names in [('pstack', PSTACK), ('agent-skills', ADDY), ('SwiftUI-Agent-Skill', ['swiftui-pro'])]:
        source = sources / repo
        for name in names:
            dest = skills / name
            if not (dest / 'SKILL.md').is_file():
                raise RuntimeError(f'Install the reviewed skill first: {name}')
            shutil.copy2(source / 'LICENSE', dest / 'LICENSE')
            changes = []
            if repo == 'pstack':
                entry = dest / 'SKILL.md'
                text = entry.read_text(encoding='utf-8')
                # Codex's skill schema does not accept this Cursor/Claude
                # frontmatter key. Keep it as provenance, without adding a
                # new explicit-only policy the user did not request.
                text = text.replace('disable-model-invocation: true\n',
                    'metadata:\n  upstream-disable-model-invocation: "true"\n')
                entry.write_text(text, encoding='utf-8')
                changes.append('Moved unsupported invocation flag to upstream metadata; normal Codex selection remains enabled')
            if name in ['observability-and-instrumentation', 'performance-optimization']:
                reference = 'observability-checklist.md' if name.startswith('observability') else 'performance-checklist.md'
                (dest / 'references').mkdir(exist_ok=True)
                shutil.copy2(source / 'references' / reference, dest / 'references' / reference)
                entry = dest / 'SKILL.md'
                text = entry.read_text(encoding='utf-8')
                entry.write_text(text.replace('../../references/', 'references/'), encoding='utf-8')
                changes.append('Bundled the shared checklist and made its reference local')
            if name == 'swiftui-pro':
                nested = dest / 'skills/swiftui-pro/SKILL.md'
                target = dest / 'references/upstream-plugin-entry.md'
                if nested.is_file():
                    # Preserve the plugin entry as documentation, without a second
                    # discoverable SKILL.md for the same skill inside its folder.
                    if target.exists():
                        raise RuntimeError('Refusing to overwrite a prior plugin entry copy')
                    nested.rename(target)
                if target.is_file():
                    changes.append('Moved duplicate plugin skill entry to a reference file')
            repository, sha = REPOS[repo]
            origin = {'repository': repository, 'commit': sha, 'skill': name, 'license': 'MIT',
                      'local_adaptations': changes}
            (dest / 'origin.json').write_text(json.dumps(origin, indent=2)+'\n', encoding='utf-8')
            records.append({**origin, 'installed_path': str(dest), 'entry_sha256': digest(dest / 'SKILL.md')})

    own = skills / 'market-research-evidence'
    if own.exists():
        if digest(own / 'SKILL.md') != digest(project / 'skills/market-research-evidence/SKILL.md'):
            raise RuntimeError('Refusing to overwrite a changed market-research-evidence skill')
    else:
        shutil.copytree(project / 'skills/market-research-evidence', own)
    own_origin = {'skill': own.name, 'source': 'skills/market-research-evidence',
                  'type': 'project-authored synthesis', 'source_repositories': REPOS}
    (own / 'origin.json').write_text(json.dumps(own_origin, indent=2)+'\n', encoding='utf-8')
    records.append({**own_origin, 'installed_path': str(own), 'entry_sha256': digest(own / 'SKILL.md')})
    manifest = {'reviewed_at': '2026-10-09', 'source_snapshots': REPOS, 'installed_skills': records,
                'scope': 'Static skills only; no stock-analysis service or trading changes deployed'}
    (project / 'research/skills-lock.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    print(f'Prepared {len(records)} skills with licenses, local references and provenance')

if __name__ == '__main__':
    main()
