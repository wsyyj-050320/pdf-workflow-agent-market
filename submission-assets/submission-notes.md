# Submission Notes

## Listing

Superteam Earn: Imperial AI Agent Hackathon — Build the Agent Economy

## Project title

PDF Workflow Diagnosis Agent Market

## GitHub repository

To be published after the branch is pushed.

## Pitch deck

`submission-assets/pitch-deck.md`

## Demo video

`submission-assets/demo-video-script.md` is prepared. A screen recording still needs to be captured before final submission.

## Verification run

```sh
npm --prefix packages/agent-runtime run build
npm --prefix examples/txodds run typecheck
npx --prefix examples/txodds tsx -e "import('./examples/txodds/agent/service.ts').then(async m => console.log(await m.deliverService('pdf monthly invoices, merge compress rename, 24, archive ZIP; student report scans, OCR split watermark, 6, submission PDF')))"
```

## Current output

See:

```text
submission-assets/pdf-workflow-diagnosis-output.json
```
