from pathlib import Path
import textwrap

import cv2
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "pdf-workflow-agent-demo.mp4"
W, H = 1280, 720
FPS = 24


def font(size: int, bold: bool = False):
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def frame(title: str, lines: list[str]):
    img = Image.new("RGB", (W, H), "#0f172a")
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, W, 92), fill="#111827")
    draw.text((60, 28), title, fill="#f8fafc", font=font(34, True))

    y = 135
    for line in lines:
        wrapped = textwrap.wrap(line, width=78) or [""]
        for item in wrapped:
            draw.text((80, y), item, fill="#e5e7eb", font=font(27))
            y += 42
        y += 14
    draw.text((60, H - 52), "PDF Workflow Diagnosis Agent Market | Solana x CoralOS devnet escrow", fill="#93c5fd", font=font(20))
    return cv2.cvtColor(__import__("numpy").array(img), cv2.COLOR_RGB2BGR)


slides = [
    (
        "Problem",
        [
            "PDF cleanup jobs fail before processing starts.",
            "A buyer says: merge these PDFs, OCR this folder, watermark my report.",
            "The seller still needs file count, privacy level, scan quality, deadline, and final format.",
        ],
    ),
    (
        "Solution",
        [
            "This fork turns the starter kit into a PDF Workflow Diagnosis Agent Market.",
            "A buyer agent pays a seller agent for a quote-ready diagnosis before funding a larger cleanup job.",
            "The paid deliverable is a structured risk and pricing report.",
        ],
    ),
    (
        "What The Agent Sells",
        [
            "deliverService('pdf ...') returns: job status, risk flags, suggested price band, and delivery checklist.",
            "Statuses: simple, quote-ready-with-cautions, or needs-scope.",
            "Risk flags include sensitive files, scanned PDFs, large batches, and short deadlines.",
        ],
    ),
    (
        "Demo Request",
        [
            "pdf monthly invoices, merge compress rename, 24, archive ZIP;",
            "student report scans, OCR split watermark, 6, submission PDF",
            "The output is saved in submission-assets/pdf-workflow-diagnosis-output.json.",
        ],
    ),
    (
        "Settlement",
        [
            "The diagnosis is the paid deliverable.",
            "The existing starter kit handles CoralOS market coordination and Solana devnet escrow.",
            "Buyer selects a seller, funds escrow, receives the diagnosis, then releases payment.",
        ],
    ),
    (
        "Agent Economy",
        [
            "This can become a graph of document-work agents:",
            "OCR checker, privacy reviewer, quote generator, cleanup seller, and delivery verifier.",
            "The rails stay the same; the service being sold changes.",
        ],
    ),
]


def main():
    writer = cv2.VideoWriter(str(OUT), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    for title, lines in slides:
        img = frame(title, lines)
        for _ in range(FPS * 8):
            writer.write(img)
    writer.release()
    print(OUT)


if __name__ == "__main__":
    main()
