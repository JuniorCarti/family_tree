# Contributing

This repository belongs to another maintainer. Changes should be proposed through a branch and pull request rather than committed directly to `main`.

## Recommended workflow

1. Update your local `main` branch:

   ```bash
   git switch main
   git pull --ff-only origin main
   ```

2. Create a focused branch:

   ```bash
   git switch -c type/short-description
   ```

   Common prefixes include `feat/`, `fix/`, `docs/`, and `chore/`.

3. Make and verify the change.
4. Review the working tree:

   ```bash
   git status
   git diff
   git diff --check
   ```

5. Commit with a concise message:

   ```bash
   git add -A
   git commit -m "fix: describe the change"
   ```

6. Push the branch:

   ```bash
   git push -u origin HEAD
   ```

7. Open a pull request against `main` and explain the behavior, implementation, verification, and any operational impact.

## Checks before opening a pull request

Run the checks relevant to the change:

```bash
node --check server.js
npm ls --omit=dev --depth=0
docker build -t lineage-api:verify .
```

For deployment changes, also verify:

- The Cloud Run revision is `Ready`.
- Firebase Hosting returns HTTP `200`.
- Login sets an `__session` cookie.
- An authenticated `/api/tree` request returns HTTP `200`.

## Secrets and generated files

Never commit:

- `.env`
- Database connection strings
- Session secrets
- Firebase deployment cache under `.firebase/`
- Local code-index artifacts under `.codebase-memory/`
- Generated uploads under `public/uploads/`

Use placeholders in examples and documentation.

## Pull-request summary template

```markdown
## Summary

- What changed
- Why it changed

## Verification

- Commands or manual checks performed

## Deployment impact

- Environment variables, migrations, services, or rollout steps

## Known limitations

- Remaining risks or follow-up work
```