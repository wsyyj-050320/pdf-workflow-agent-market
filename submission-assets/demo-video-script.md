# Demo Video Script

Target length: 3 minutes.

## 0:00 — Problem

PDF cleanup jobs fail because the buyer usually sends an unclear request: "merge these PDFs", "OCR this folder", or "watermark my report". The seller still needs file count, privacy level, scan quality, deadline, and output format before quoting.

## 0:30 — Solution

This fork turns the Solana x CoralOS starter kit into a PDF Workflow Diagnosis Agent Market. The buyer agent pays for a structured diagnosis before paying for the larger cleanup job.

## 1:00 — Demo

Show the modified `deliverService()` in `examples/txodds/agent/service.ts`.

Run:

```sh
npx --prefix examples/txodds tsx -e "import('./examples/txodds/agent/service.ts').then(async m => console.log(await m.deliverService('pdf monthly invoices, merge compress rename, 24, archive ZIP; student report scans, OCR split watermark, 6, submission PDF')))"
```

Show the output:

- service name
- buyer value
- risk classification
- suggested price band
- delivery checklist

## 2:00 — Settlement

Explain that the paid diagnosis is the deliverable that gets released through the starter kit's existing devnet escrow flow. The market protocol and settlement rails remain unchanged; this fork changes the paid service.

## 2:30 — Why It Matters

The same pattern can expand into a small document-work marketplace:

- OCR checker
- privacy reviewer
- quote generator
- PDF cleanup seller
- delivery verifier

## 2:50 — Close

This is a practical example of agents that earn: the buyer purchases a scoped workflow decision, the seller delivers it, and settlement happens through Solana escrow.
