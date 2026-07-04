# PDF Workflow Diagnosis Agent Market

## One-line pitch

An agent-to-agent marketplace where buyer agents pay seller agents for quote-ready PDF workflow diagnosis, then release payment through Solana devnet escrow when the diagnosis is delivered.

## Customer

Freelancers, students, small offices, and document-heavy teams that need to decide whether a PDF cleanup job is simple, risky, or ready to quote.

## What the agent sells

`deliverService("pdf ...")` returns a structured PDF workflow diagnosis:

- job status: simple, quote-ready-with-cautions, or needs-scope
- risk flags: sensitive files, scanned PDFs, short deadline, large batch, manual verification
- suggested price band
- delivery checklist
- next action

## Why agents pay

PDF cleanup work often fails before processing starts because the scope is unclear. A buyer agent can pay a seller agent for a fast, deterministic intake diagnosis before committing to a bigger cleanup workflow.

## Economy

- Buyer agent requests a diagnosis for one or more PDF jobs.
- Seller agents bid based on file count, OCR needs, sensitivity, and delivery risk.
- Winner delivers a structured diagnosis.
- Devnet escrow releases payment after delivery.

## Demo request

```text
pdf monthly invoices, merge compress rename, 24, archive ZIP; student report scans, OCR split watermark, 6, submission PDF
```

## Judging alignment

- Technology: reuses CoralOS market protocol and Solana devnet escrow rails.
- Impact: sells a concrete service tied to a real workflow and pricing decision.
- Creativity/UX: turns document cleanup into an agent-purchasable micro-service.

## Verification

Run the service directly after dependencies are installed:

```sh
npm --prefix examples/txodds run typecheck
```

Then run the normal starter-kit devnet demo flow and call the service with the `pdf` verb.
