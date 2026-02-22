# Lessons learned

Patterns and corrections accumulated across sessions. Updated after any user correction.

<!-- Format:
## YYYY-MM-DD — short title
**Mistake**: what went wrong
**Fix**: what to do instead
**Rule**: the generalised pattern to prevent recurrence
-->

## 2026-02-22 — rebase on pushed branch requires force push
**Mistake**: used `git rebase main` to update a feature branch that was already pushed, then needed `--force-with-lease` to push.
**Fix**: use `git merge main` to update pushed feature branches — it adds a merge commit, keeps existing SHAs, and pushes cleanly.
**Rule**: rebase only on branches that have never been pushed (or when a clean linear history is explicitly needed before merging). Default to merge for updating pushed branches.
