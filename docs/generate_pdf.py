#!/usr/bin/env python3
"""Generate professional PDF manual for FinControl — HMR Nexus branding. Clean white cover."""

import markdown, base64
from weasyprint import HTML, CSS
from pathlib import Path

md_path = Path(__file__).parent / "MANUAL-USUARIO.md"
md_content = md_path.read_text(encoding="utf-8")
html_body = markdown.markdown(md_content, extensions=['tables', 'toc', 'fenced_code', 'codehilite', 'attr_list'])

nexus_b64 = base64.b64encode(Path("/Users/jarl/.openclaw/workspace/projects/templates/nexus-logo.png").read_bytes()).decode()
umtelkomd_b64 = base64.b64encode(Path("/Users/jarl/.openclaw/workspace/projects/templates/umtelkomd-logo.png").read_bytes()).decode()

html_template = f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body>

<div class="cover">
    <div class="cover-header">
        <img src="data:image/png;base64,{nexus_b64}" style="height:55px;" />
    </div>
    <div class="cover-body">
        <div class="cover-accent-bar"></div>
        <div class="cover-title">FinControl</div>
        <div class="cover-subtitle">Manual de Usuario</div>
        <div class="cover-accent-bar"></div>
    </div>
    <div class="cover-footer">
        <div class="cover-meta">Versión 1.0 · Marzo 2026</div>
        <div class="cover-meta">UMTELKOMD GmbH</div>
        <div class="cover-url">umtelkomd-finance.web.app</div>
        <div class="cover-brand">HMR NEXUS ENGINEERING</div>
    </div>
</div>

<div class="content">
{html_body}
</div>

<div class="back">
    <div class="back-content">
        <img src="data:image/png;base64,{nexus_b64}" style="height:45px; margin-bottom:16px;" />
        <div style="font-size:14pt; font-weight:bold; color:#0c2340; margin-bottom:4px;">HMR Nexus Engineering</div>
        <div style="font-size:9pt; color:#6b7280; margin-bottom:24px;">Glasfaser &amp; Software-Lösungen</div>
        <div style="width:40px; height:2px; background:#0066ff; margin:0 auto 24px auto;"></div>
        <div style="font-size:9pt; color:#0066ff;">info@hmr-nexus.com · hmr-nexus.com</div>
        <div style="font-size:7pt; color:#9ca3af; margin-top:30px;">© 2026 HMR Nexus GmbH — Documento confidencial</div>
    </div>
</div>

</body>
</html>"""

css = CSS(string="""
@page {
    size: A4;
    margin: 22mm 18mm;
    @top-right {
        content: "FinControl v1.0";
        font-family: Helvetica, Arial, sans-serif;
        font-size: 7.5pt;
        color: #9ca3af;
    }
    @bottom-left {
        content: "HMR Nexus Engineering";
        font-family: Helvetica, Arial, sans-serif;
        font-size: 7pt;
        color: #d1d5db;
    }
    @bottom-right {
        content: counter(page);
        font-family: Helvetica, Arial, sans-serif;
        font-size: 7.5pt;
        color: #9ca3af;
    }
}

@page :first {
    margin: 0;
    @top-right { content: none; }
    @bottom-left { content: none; }
    @bottom-right { content: none; }
}

body {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 9.5pt;
    line-height: 1.65;
    color: #1f2937;
    margin: 0;
}

/* ═══ COVER — white, clean, professional ═══ */
.cover {
    page: cover;
    width: 210mm;
    height: 297mm;
    background: white;
    page-break-after: always;
    position: relative;
    text-align: center;
    padding: 35mm 30mm;
}

.cover-header {
    margin-top: 25mm;
    margin-bottom: 40mm;
}

.cover-body {
    margin-bottom: 40mm;
}

.cover-accent-bar {
    width: 60px;
    height: 3px;
    background: #0066ff;
    margin: 0 auto 18px auto;
}

.cover-title {
    font-size: 54pt;
    font-weight: bold;
    color: #0c2340;
    letter-spacing: -1px;
    margin-bottom: 8px;
}

.cover-subtitle {
    font-size: 18pt;
    font-weight: normal;
    color: #6b7280;
    margin-bottom: 18px;
}

.cover-footer {}

.cover-meta {
    font-size: 10pt;
    color: #6b7280;
    margin-bottom: 4px;
}

.cover-url {
    font-size: 10pt;
    font-weight: bold;
    color: #0066ff;
    margin-top: 12px;
    margin-bottom: 20px;
}

.cover-brand {
    font-size: 8pt;
    letter-spacing: 4px;
    color: #9ca3af;
}

/* ═══ BACK COVER ═══ */
.back {
    width: 210mm;
    height: 297mm;
    background: #fafafa;
    page-break-before: always;
    text-align: center;
    padding: 100mm 40mm;
}

.back-content {}

/* ═══ CONTENT ═══ */
.content { padding: 0; }
.content > h1:first-child { display: none; }

h1 {
    font-size: 20pt;
    font-weight: bold;
    color: #0c2340;
    border-bottom: 2.5px solid #0066ff;
    padding-bottom: 6px;
    margin-top: 28px;
    margin-bottom: 14px;
    page-break-after: avoid;
}

h2 {
    font-size: 14pt;
    font-weight: bold;
    color: #0c2340;
    margin-top: 24px;
    margin-bottom: 10px;
    page-break-after: avoid;
    border-left: 4px solid #0066ff;
    padding-left: 12px;
}

h3 {
    font-size: 11pt;
    font-weight: bold;
    color: #1e3a5f;
    margin-top: 18px;
    margin-bottom: 8px;
    page-break-after: avoid;
}

h4 {
    font-size: 9.5pt;
    font-weight: bold;
    color: #4b5563;
    margin-top: 14px;
    margin-bottom: 6px;
}

p { margin: 6px 0; text-align: justify; }
ul, ol { margin: 6px 0; padding-left: 22px; }
li { margin: 3px 0; }

table {
    width: 100%;
    border-collapse: collapse;
    margin: 14px 0;
    font-size: 8.5pt;
    page-break-inside: avoid;
}

thead { background: #0c2340; color: white; }

th {
    padding: 7px 9px;
    text-align: left;
    font-weight: bold;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

td { padding: 6px 9px; border-bottom: 1px solid #e5e7eb; }
tbody tr:nth-child(even) { background: #f0f7ff; }

code {
    font-family: 'Courier New', monospace;
    font-size: 8pt;
    background: #eff6ff;
    padding: 1px 4px;
    border-radius: 3px;
    color: #0066ff;
}

pre {
    background: #1e293b;
    color: #e2e8f0;
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 7.5pt;
    line-height: 1.5;
    margin: 10px 0;
    page-break-inside: avoid;
    border-left: 3px solid #0066ff;
}

pre code { background: transparent; color: #e2e8f0; padding: 0; }

blockquote {
    border-left: 4px solid #0066ff;
    background: #f0f7ff;
    padding: 10px 14px;
    margin: 10px 0;
    font-style: italic;
    color: #374151;
}

hr { border: none; border-top: 1.5px solid #e5e7eb; margin: 20px 0; }
a { color: #0066ff; text-decoration: none; font-weight: bold; }
strong { font-weight: bold; color: #111827; }
img { max-width: 100%; margin: 10px 0; }
""")

output = Path(__file__).parent / "FinControl_Manual_Usuario_v1.0.pdf"
HTML(string=html_template).write_pdf(str(output), stylesheets=[css])
print(f"✅ {output} ({output.stat().st_size // 1024} KB)")
