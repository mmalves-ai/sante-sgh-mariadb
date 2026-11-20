"""Monta o PDF do plano geral do sante-sgh com a estética do new-sgh e imprime com o Chrome headless.

uso: python3 -I tools/pdf/montar.py <raiz_sante_sgh> <raiz_new_sgh> <saida.pdf>

Lê os .md de docs/ (plano, fases, ADR, resumo da análise), converte com um conversor mínimo de Markdown
(títulos, parágrafos, listas aninhadas, tabelas, código, negrito, itálico, código em linha, links) e usa
planejamento/fonte-pdf/estilo.css e planejamento/marca/ do new-sgh. Não lê dado pessoal.
"""
import html
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(sys.argv[1]).resolve()
NEW = Path(sys.argv[2]).resolve()
PDF = Path(sys.argv[3]).resolve()
MARCA = NEW / "planejamento" / "marca"
ESTILO = NEW / "planejamento" / "fonte-pdf" / "estilo.css"

DATA = "novembro de 2026"


def inline(t: str) -> str:
    t = html.escape(t, quote=False)
    t = re.sub(r"`([^`]+)`", lambda m: f"<code>{m.group(1)}</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])", r"<em>\1</em>", t)
    # links: mantém o texto; links relativos viram texto simples (o PDF é um só documento)
    t = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r'<a href="\2">\1</a>', t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", t)
    return t


def md(texto: str, nivel_base: int = 0, ancora: str = "") -> str:
    """Markdown mínimo -> HTML. nivel_base desloca os títulos (# vira h{1+nivel_base})."""
    linhas = texto.splitlines()
    out, i = [], 0
    par: list[str] = []

    def fecha_par():
        if par:
            out.append("<p>" + inline(" ".join(s.strip() for s in par)) + "</p>")
            par.clear()

    while i < len(linhas):
        ln = linhas[i]
        s = ln.strip()
        if not s:
            fecha_par(); i += 1; continue
        if s.startswith("```"):
            fecha_par(); i += 1; bloco = []
            while i < len(linhas) and not linhas[i].strip().startswith("```"):
                bloco.append(linhas[i]); i += 1
            i += 1
            out.append("<pre>" + html.escape("\n".join(bloco)) + "</pre>")
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", s)
        if m:
            fecha_par()
            n = min(6, len(m.group(1)) + nivel_base)
            idattr = f' id="{ancora}"' if ancora and not out else ""
            out.append(f"<h{n}{idattr}>{inline(m.group(2))}</h{n}>")
            i += 1; continue
        if re.match(r"^-{3,}$", s):
            fecha_par(); out.append('<hr>'); i += 1; continue
        if s.startswith("|") and i + 1 < len(linhas) and re.match(r"^\s*\|?\s*:?-{3,}", linhas[i + 1]):
            fecha_par()
            cab = [c.strip() for c in s.strip("|").split("|")]
            i += 2; corpo = []
            while i < len(linhas) and linhas[i].strip().startswith("|"):
                corpo.append([c.strip() for c in linhas[i].strip().strip("|").split("|")]); i += 1
            cls = ' class="compacta"' if len(cab) >= 6 else ""
            t = [f"<table{cls}><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in cab) + "</tr></thead><tbody>"]
            for r in corpo:
                t.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>")
            t.append("</tbody></table>")
            out.append("".join(t)); continue
        if re.match(r"^\s*([-*]|\d+\.)\s+", ln):
            fecha_par()
            bloco = []
            while i < len(linhas) and (re.match(r"^\s*([-*]|\d+\.)\s+", linhas[i]) or
                                       (linhas[i].startswith("  ") and linhas[i].strip())):
                bloco.append(linhas[i]); i += 1
            out.append(lista(bloco)); continue
        par.append(s); i += 1
    fecha_par()
    return "\n".join(out)


def lista(bloco: list[str]) -> str:
    """Lista aninhada por indentação (2 ou mais espaços por nível)."""
    itens = []  # (indent, ordenada, texto)
    for ln in bloco:
        m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", ln)
        if m:
            itens.append([len(m.group(1)), m.group(2)[0].isdigit(), m.group(3)])
        elif itens:
            itens[-1][2] += " " + ln.strip()
    html_out, pilha = [], []
    for ind, ordenada, texto in itens:
        while pilha and ind < pilha[-1][0]:
            html_out.append("</li></ol>" if pilha.pop()[1] else "</li></ul>")
        if not pilha or ind > pilha[-1][0]:
            html_out.append("<ol>" if ordenada else "<ul>")
            pilha.append((ind, ordenada))
        else:
            html_out.append("</li>")
        html_out.append("<li>" + inline(texto))
    while pilha:
        html_out.append("</li></ol>" if pilha.pop()[1] else "</li></ul>")
    return "".join(html_out)


def capitulo(arq: Path, ident: str, titulo: str | None = None) -> tuple[str, str]:
    texto = arq.read_text(encoding="utf-8")
    # o primeiro título do arquivo vira o h1 do capítulo
    m = re.search(r"^#\s+(.*)$", texto, re.M)
    t = titulo or (m.group(1) if m else arq.stem)
    if m:
        texto = texto[:m.start()] + texto[m.end():]
    corpo = md(texto, nivel_base=0)
    corpo = re.sub(r"<h1>", "<h2>", corpo).replace("</h1>", "</h2>")
    return t, f'<section class="capitulo" id="{ident}"><h1>{inline(t)}</h1>\n{corpo}</section>'


def main() -> None:
    docs = RAIZ / "docs"
    partes, sumario = [], []
    ordem = [
        (docs / "fases" / "README.md", "plano", "Visão geral e fases"),
        (docs / "fases" / "F0-fundacao.md", "f0", None),
        (docs / "fases" / "F1-analise-e-modelo.md", "f1", None),
        (docs / "fases" / "F2-nucleo-e-persistencia.md", "f2", None),
        (docs / "fases" / "F3-paridade.md", "f3", None),
        (docs / "fases" / "F4-conector.md", "f4", None),
        (docs / "fases" / "F5-homologacao.md", "f5", None),
        (docs / "fases" / "F6-virada.md", "f6", None),
        (docs / "fases" / "F7-serrano-e-hospital-do-zero.md", "f7", None),
        (docs / "fases" / "F8-recursos-novos.md", "f8", None),
        (docs / "analise" / "RESUMO.md", "analise", None),
        (docs / "adr" / "0001-banco-proprio-e-virada-por-conector-diferencial.md", "adr", "Anexo A. ADR 0001"),
    ]
    for arq, ident, titulo in ordem:
        if not arq.exists():
            print(f"aviso: falta {arq}", file=sys.stderr); continue
        t, sec = capitulo(arq, ident, titulo)
        partes.append(sec)
        sumario.append(f'<li class="n1"><a href="#{ident}">{inline(t)}</a></li>')

    logo = (MARCA / "logo-sante-sgh.svg").as_uri()
    simbolo = (MARCA / "simbolo-rede-sante-branco.svg").as_uri()
    estilo = ESTILO.read_text(encoding="utf-8")
    estilo = estilo.replace("Sante SGH · Planejamento", "Sante SGH · Banco próprio e virada")
    estilo = re.sub(r"Rede Santé · [a-zç]+ de 2026", f"Rede Santé · {DATA}", estilo)

    doc = f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Sante SGH · Plano de construção do banco próprio</title>
<style>{estilo}
hr {{ border: 0; border-top: 1px solid var(--linha); margin: 4mm 0; }}
.sumario li.n1 {{ padding-top: 2mm; }}
</style></head><body>
<section class="capa">
  <img class="logo" src="{logo}" alt="Sante SGH">
  <div class="titulo">
    <h1>Plano de construção do <strong>banco próprio</strong></h1>
    <p>Modelo de dados próprio em MariaDB, aplicação a partir do new-sgh e virada do SPDATA por conector
    diferencial. Fases F0 a F8, decisões e análise cruzada.</p>
  </div>
  <div class="faixa"></div>
  <div class="rodape">
    <p><strong>Rede Santé</strong> · Hospital Geral ProntoCardio e Hospital Serrano</p>
    <p>Documento interno · {DATA} · sem dados pessoais</p>
    <img class="simbolo" src="{simbolo}" alt="">
  </div>
</section>
<section class="sumario"><h1>Sumário</h1><ol>{''.join(sumario)}</ol></section>
{''.join(partes)}
</body></html>"""
    saida_html = PDF.with_suffix(".html")
    saida_html.write_text(doc, encoding="utf-8")
    subprocess.run([
        "google-chrome", "--headless=new", "--disable-gpu", "--no-sandbox",
        "--allow-file-access-from-files", "--no-pdf-header-footer",
        f"--print-to-pdf={PDF}", saida_html.as_uri()], check=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
    print(f"ok: {PDF} ({PDF.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
