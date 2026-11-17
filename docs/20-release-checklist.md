# Release checklist

What is needed to publish Gertie and list it in skill directories. Items that need a public repository or an account cannot be done from a local checkout; they are listed here with the exact command.

## Before the first push

1. Confirm the GitHub owner. The repository field in `package.json`, the README install commands and the website install command use `ajithonmain/gertie`. Change all three together if the repository lives elsewhere (`grep -rn ajithonmain .`).
2. `npm ci && npm run typecheck && npm test && npm run build && npm run build:site`.
3. `npx skills-ref validate skills/gertie` must print `Valid skill`.
4. `git diff --exit-code skills/gertie/scripts` after the build: the committed bundles must match a fresh build.

## Publish

```bash
gh repo create ajithonmain/gertie --public --source . --push
git tag v0.1.0 && git push origin v0.1.0
gh release create v0.1.0 --title "Gertie 0.1.0" --notes-file docs/release-notes-0.1.0.md
gh repo edit --add-topic agent-skills,lottie,svg-animation,animation,claude-code,codex,motion-graphics
```

Website: in Cloudflare Pages create a project from the repository. Build command `npm run build:site`, output directory `site/dist`, production branch `main`, project name `askgertie`.

## Directories

Verified on 17 November 2026 from third-party guides only; the vendors' own pages did not state a process. Check each before submitting.

| Directory | Process |
|---|---|
| skills.sh (Vercel) | Needs a public GitHub repo with `SKILL.md`. Reports disagree on whether listing is automatic after `npx skills add` installs or needs an issue on `vercel-labs/skills`. Run the install once, then check whether the skill appears. |
| mcp.directory/submit-skill | Takes a link to the `SKILL.md` on GitHub. |
| agentskill.sh/submit | Takes the repository URL. |
| Anthropic directory | Curated, not open for submission. |

## After release

- Run `node tests/eval/run.mjs` again and publish the numbers in the release notes.
- Check the install steps on a clean machine (see `19-agent-evaluation.md`, "Clean-machine run").
