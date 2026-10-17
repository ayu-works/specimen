# Linear setup report (2026-10-17)

## The idea
- **Teams = kinds of work** (who does it, how it flows). You have 2 on the free plan: **Build** and **Growth**.
- **Projects = products and their streams of work.** You can have as many as you like.
- **A "Product" label** on every issue and project, so one filter shows a whole product across both teams.

| Team | Who | Example projects |
|---|---|---|
| Build (today: "Specimen", key SPC) | engineering, design, agents | Specimen: Extension · Specimen: Release & Site · Specimen: Quality & Tests |
| Growth (to create) | marketing, sales, content | Specimen: Launch · Product B: Outreach |

## What I did
- Created the label group **Product** with the label **Specimen**, for issues and for projects.
- Renamed the 3 projects with a product prefix and gave each the Specimen label:
  - Specimen: Extension
  - Specimen: Release & Site
  - Specimen: Quality & Tests
- Tagged every Specimen work issue (SPC-5 to SPC-45) with Product: Specimen. Linear's onboarding issues SPC-1 to SPC-4 are left alone.
- Updated `docs/sprint/linear.md` to match.

## What I couldn't do (the Linear connector has no tool for teams), so it's yours, ~2 minutes
1. **Rename the team:** Settings → Teams → Specimen → General → Name: `Build`. **Keep the key `SPC`**, since all tickets, docs and PR titles use SPC-n.
2. **Create the second team:** Settings → Teams → Create team → Name `Growth`, key e.g. `GRO`.
3. Optional: in Growth, turn off cycles and triage if sales/marketing don't work in sprints.

## How to use it
- New product: create its projects ("Product B: …") in the right team and add a new label under **Product**.
- See one product: filter issues by `Product is Specimen` (or open its projects).
- Design work for a build goes in **Build**. Brand and marketing design goes in **Growth**.

## Watch out
- **Issue limit:** the free plan caps active issues (about 250 when I last knew; check Linear's pricing page). Today you have 45 issues, 18 of them open. Archive Done issues regularly, and keep big audits as docs, not dozens of tickets.
- The 2-team limit is fine with this layout. You only need a 3rd team if a group needs a truly different workflow.
