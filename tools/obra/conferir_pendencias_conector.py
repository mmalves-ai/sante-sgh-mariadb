#!/usr/bin/env python3
"""Conferência por contagem das pendências de conector das fichas (revisão do dono, 27/11). Só agregados.

Itens:
- franquia  (C2-116, decisão 56): há dado de franquia na origem? (tabelas e colunas de franquia, contagem)
- modelos   (C3-002): os modelos da origem contra modelo_documento_clinico/versao do cliente, e, por modelo,
              registros e respostas da origem contra os gravados (taxa por modelo; abaixo de 99,5% é destacado)
- sinais    (C2-003): sinais vitais na origem (tabelas próprias, ligação pergunta-parâmetro e respostas cujo rótulo
              da pergunta é de sinal vital) contra afericao/afericao_valor do cliente
- exames    (C1-060): exames sem liberação na origem por módulo e faixa de idade, e no cliente os exames em análise
              (a fila da bancada desde INICIO_DA_FILA_DA_BANCADA) e os solicitados, por setor e faixa

Regras (AGENTS 4 e 5): a origem é lida em transação READ ONLY pelo cliente isql descartável de medir_origem_fb.py;
o cliente MariaDB é lido com a senha de dentro do container (nunca impressa). Nenhum valor de linha sai: só contagens,
rótulos de catálogo (módulo, parâmetro) e códigos de modelo.

Uso (da raiz do repositório; a consulta de respostas por modelo varre a origem inteira, ~2 min):
  flock -o ../sante-sgh-dados/obra/pesado.lock python3 -I tools/obra/conferir_pendencias_conector.py \
      [--porta 3351] [--banco cliente_prontocardio] [--saida ARQ.md] [franquia modelos sinais exames]
"""
import argparse
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import medir_origem_fb as fb  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# a pasta banco-dev fica ao lado do repositório principal (também quando rodado de um worktree)
for _c in (os.path.join(os.path.dirname(RAIZ), "banco-dev", ".env"),
           "/home/mmalves/workspace/redesante/banco-dev/.env"):
    if os.path.exists(_c):
        fb.ENV = _c
        break
MARIADB_CT = os.environ.get("CONECTOR_MARIADB_CONTAINER", "sante-sgh-mariadb")
TAXA_MINIMA = 99.5


def origem(porta, sql):
    return [[c.strip() for c in l.split("|")] for l in fb.isql(porta, sql)]


def cliente(banco, sql):
    r = subprocess.run(["docker", "exec", "-i", MARIADB_CT, "sh", "-c",
                        'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -B "$0"', banco],
                       input=sql, capture_output=True, text=True, timeout=1800)
    if r.returncode != 0:
        sys.exit("falha no MariaDB: " + r.stderr[-300:])
    return [l.split("\t") for l in r.stdout.splitlines() if l]


def n(x):
    return int(x) if x not in (None, "", "NULL") else 0


def fmt(v):
    return f"{v:,}".replace(",", ".")


def franquia(a, out):
    out.append("## Franquia (C2-116, decisão 56)\n")
    linhas = origem(a.porta, """
SELECT 'CDTPFRANQUIA|'||COUNT(*) FROM CDTPFRANQUIA;
SELECT 'CDEMPFRQMMDTH|'||COUNT(*) FROM CDEMPFRQMMDTH;
SELECT 'GPSEGURO com VALOR_FRANQUIA>0|'||COUNT(*) FROM GPSEGURO WHERE VALOR_FRANQUIA>0;
SELECT 'CDGUIA com VLR_FRANQUIA>0|'||COUNT(*) FROM CDGUIA WHERE VLR_FRANQUIA>0;
SELECT 'PFGUIAS (FRANQUIA)|'||COUNT(*) FROM PFGUIAS;
SELECT 'CDEMPRESACAD (INCLUIR_COPART_FRANQUIA)|'||COUNT(*) FROM CDEMPRESACAD;
""")
    dest = dict((k, n(v)) for k, v in cliente(a.banco, """
SELECT 'tipo_franquia', COUNT(*) FROM tipo_franquia;
SELECT 'regra_franquia_plano', COUNT(*) FROM regra_franquia_plano;
SELECT 'franquia_contrato', COUNT(*) FROM franquia_contrato;
SELECT 'conta_hospitalar_franquia', COUNT(*) FROM conta_hospitalar_franquia;
"""))
    out.append("| Origem | Linhas |\n|---|---:|")
    out += [f"| {k} | {fmt(n(v))} |" for k, v in linhas]
    out.append("\n| Cliente | Linhas |\n|---|---:|")
    out += [f"| {k} | {fmt(v)} |" for k, v in dest.items()]
    regras = sum(n(v) for k, v in linhas if k != "CDTPFRANQUIA")
    tipos = next((n(v) for k, v in linhas if k == "CDTPFRANQUIA"), 0)
    out.append("")
    if regras == 0:
        out.append(f"Resultado: **sem dado de franquia na origem** além dos {tipos} tipos (catálogo), que entram em "
                   f"tipo_franquia ({dest.get('tipo_franquia', 0)} no cliente). Nada a ligar; nada trava.\n")
    else:
        out.append(f"Resultado: **{fmt(regras)} linhas de franquia na origem**: mapear para as tabelas de franquia.\n")


def modelos(a, out):
    out.append("## Modelos de documento clínico (C3-002)\n")
    # código do modelo no cliente: o da origem em maiúsculas (decisão 61) ou, na carga anterior a ela, a chave
    o_cod = {r[0]: r[1] for r in origem(a.porta,
                                        "SELECT ID_EVOLUCAO||'|'||COALESCE(UPPER(TRIM(COD)),'') FROM PREVOLUCAO;")}
    o_ver = n(origem(a.porta, "SELECT 'v|'||COUNT(*) FROM HTCABECFORMULCOMP;")[0][1])
    o_reg = {r[0]: n(r[1]) for r in origem(a.porta,
                                            "SELECT ID_EVOLUCAO||'|'||COUNT(*) FROM PRCABEVOL GROUP BY ID_EVOLUCAO;")}
    o_resp = {r[0]: n(r[1]) for r in origem(a.porta, """
SELECT c.ID_EVOLUCAO||'|'||COUNT(*) FROM PREVOLPAC e JOIN PRCABEVOL c ON c.ID_CABEVOL=e.ID_CABEVOL GROUP BY c.ID_EVOLUCAO;
""")}
    d = cliente(a.banco, """
SELECT m.codigo, m.situacao, (SELECT COUNT(*) FROM modelo_documento_versao v WHERE v.modelo_documento_clinico_id=m.id),
       (SELECT COUNT(*) FROM modelo_documento_versao v WHERE v.modelo_documento_clinico_id=m.id AND v.situacao='publicada')
  FROM modelo_documento_clinico m WHERE m.origem='migracao' AND m.excluido_em IS NULL;
""")
    d_mod = {r[0]: r for r in d}
    # chave da origem -> código do modelo no cliente
    o_mod = {i: (c if c and c in d_mod else i) for i, c in o_cod.items()}
    d_reg = {r[0]: n(r[1]) for r in cliente(a.banco, """
SELECT m.codigo, COUNT(*) FROM registro_assistencial r JOIN modelo_documento_clinico m ON m.id=r.modelo_documento_clinico_id
 GROUP BY m.codigo;""")}
    d_resp = {r[0]: n(r[1]) for r in cliente(a.banco, """
SELECT m.codigo, COUNT(*) FROM registro_assistencial_resposta x JOIN registro_assistencial r ON r.id=x.registro_assistencial_id
  JOIN modelo_documento_clinico m ON m.id=r.modelo_documento_clinico_id GROUP BY m.codigo;""")}
    faltam = sorted((i for i, k in o_mod.items() if k not in d_mod), key=int)
    extras = sorted(set(d_mod) - set(o_mod.values()))
    publicados = sum(1 for k in o_mod.values() if k in d_mod and d_mod[k][1] == "publicado")
    pelo_codigo = sum(1 for i, k in o_mod.items() if k != i)
    versoes = sum(n(r[2]) for r in d)
    out.append(f"- Modelos na origem (PREVOLUCAO): {len(o_mod)}; no cliente, migrados: {len(d_mod)} "
               f"(da origem: {len(o_mod) - len(faltam)}; a mais: {len(extras)} {extras}); faltando: {len(faltam)} {faltam}")
    out.append(f"- Código do modelo no cliente igual ao código da origem (decisão 61): {pelo_codigo} de {len(o_mod)} "
               "(os demais ainda com a chave da origem: mudam no próximo Sincronizar)")
    out.append(f"- Versões: origem {o_ver} históricas (HTCABECFORMULCOMP) + 1 atual por modelo = {o_ver + len(o_mod)}; "
               f"cliente {versoes} (inclui a do banco de perguntas da migração)")
    out.append(f"- Publicados (o registro clínico novo só abre modelo publicado): {publicados} de {len(o_mod)}")
    tot_or, tot_dr, tot_oa, tot_da = (sum(o_reg.values()), sum(d_reg.values()), sum(o_resp.values()),
                                      sum(d_resp.values()))
    out.append(f"- Registros: origem {fmt(tot_or)}, cliente {fmt(tot_dr)}; respostas: origem {fmt(tot_oa)}, "
               f"cliente {fmt(tot_da)}\n")
    out.append("| Modelo (chave na origem / código no cliente) | Registros origem | Registros cliente | Taxa | Respostas origem | Respostas cliente | Taxa |")
    out.append("|---|---:|---:|---:|---:|---:|---:|")
    abaixo = 0
    for i in sorted(o_mod, key=int):
        k = o_mod[i]
        orr, dr, oa, da = o_reg.get(i, 0), d_reg.get(k, 0), o_resp.get(i, 0), d_resp.get(k, 0)
        tr = 100.0 * dr / orr if orr else 100.0
        ta = 100.0 * da / oa if oa else 100.0
        marca = " **<**" if min(tr, ta) < TAXA_MINIMA else ""
        abaixo += 1 if marca else 0
        out.append(f"| {i} / {k} | {fmt(orr)} | {fmt(dr)} | {tr:.1f}%{marca} | {fmt(oa)} | {fmt(da)} | {ta:.1f}% |")
    out.append(f"\nModelos com taxa abaixo de {TAXA_MINIMA}% em registros ou respostas: {abaixo} de {len(o_mod)}.\n")


ROTULOS_SINAIS = """
  CASE WHEN UPPER(p.DESCRICAO) CONTAINING 'PRESS' OR UPPER(p.DESCRICAO) STARTING WITH 'PA ' OR UPPER(p.DESCRICAO)='PA' THEN 'pressao'
       WHEN UPPER(p.DESCRICAO) CONTAINING 'TEMPERAT' OR UPPER(p.DESCRICAO) STARTING WITH 'TAX' THEN 'temperatura'
       WHEN UPPER(p.DESCRICAO) CONTAINING 'FREQ' AND UPPER(p.DESCRICAO) CONTAINING 'CARD' OR UPPER(p.DESCRICAO)='FC' THEN 'freq_cardiaca'
       WHEN UPPER(p.DESCRICAO) CONTAINING 'FREQ' AND UPPER(p.DESCRICAO) CONTAINING 'RESP' OR UPPER(p.DESCRICAO)='FR' THEN 'freq_respiratoria'
       WHEN UPPER(p.DESCRICAO) CONTAINING 'SATURA' OR UPPER(p.DESCRICAO) CONTAINING 'SPO2' OR UPPER(p.DESCRICAO) CONTAINING 'SAT O2' THEN 'saturacao'
       WHEN UPPER(p.DESCRICAO) CONTAINING 'PESO' THEN 'peso'
       WHEN UPPER(p.DESCRICAO) CONTAINING 'ALTURA' OR UPPER(p.DESCRICAO) CONTAINING 'ESTATURA' THEN 'altura'
       WHEN UPPER(p.DESCRICAO) CONTAINING 'GLICEM' OR UPPER(p.DESCRICAO) CONTAINING 'HGT' OR UPPER(p.DESCRICAO) CONTAINING 'DEXTRO' THEN 'glicemia'
       ELSE NULL END"""


# o isql recebe só ASCII nos literais (acento quebra a leitura do comando); o nome acentuado é posto aqui
NOMES_SINAIS = {"pressao": "pressão", "freq_cardiaca": "frequência cardíaca",
                "freq_respiratoria": "frequência respiratória", "saturacao": "saturação"}
FAIXAS = {"ate 30 dias": "até 30 dias"}


def sinais(a, out):
    out.append("## Sinais vitais (C2-003)\n")
    t = origem(a.porta, """
SELECT 'PRSINALVITAL|'||COUNT(*) FROM PRSINALVITAL;
SELECT 'PRSINALVITAL_HISTORICO|'||COUNT(*) FROM PRSINALVITAL_HISTORICO;
SELECT 'PRSINAL_LANCATEND|'||COUNT(*) FROM PRSINAL_LANCATEND;
SELECT 'PRITENSSINAIS|'||COUNT(*) FROM PRITENSSINAIS;
SELECT 'RISINALVITAL|'||COUNT(*) FROM RISINALVITAL;
SELECT 'PRTIPOPERGPAR (parametros da pergunta)|'||COUNT(*) FROM PRTIPOPERGPAR;
SELECT 'PRPARPERGUNTA (pergunta ligada a parametro)|'||COUNT(*) FROM PRPARPERGUNTA;
""")
    g = origem(a.porta, f"""
SELECT g||'|'||COUNT(DISTINCT pid)||'|'||COUNT(*) FROM (
 SELECT p.ID pid, {ROTULOS_SINAIS} g
   FROM PREVOLPAC e JOIN PRRESPOSTA r ON r.ID_RESPOSTA=e.ID_RESPOSTA JOIN PRPERGUNTA p ON p.ID=r.ID_PRPERGUNTA
) x WHERE g IS NOT NULL GROUP BY g;
""")
    d = cliente(a.banco, """
SELECT 'afericao', COUNT(*) FROM afericao;
SELECT 'afericao_valor', COUNT(*) FROM afericao_valor;
SELECT 'parametro_vital', COUNT(*) FROM parametro_vital;
SELECT 'destino_campo_estruturado (ativos)', CONCAT(COUNT(*), ' (', SUM(ativo), ')') FROM destino_campo_estruturado;
SELECT 'destino_campo_estruturado ligado a parametro_vital', COUNT(*) FROM destino_campo_estruturado WHERE parametro_vital_id IS NOT NULL;
""")
    out.append("| Origem | Linhas |\n|---|---:|")
    out += [f"| {k} | {fmt(n(v))} |" for k, v in t]
    out.append("\nRespostas de formulário cujo rótulo da pergunta é de sinal vital (por rótulo, não por ligação):\n")
    out.append("| Sinal | Perguntas | Respostas |\n|---|---:|---:|")
    out += [f"| {NOMES_SINAIS.get(k, k)} | {fmt(n(p))} | {fmt(n(r))} |" for k, p, r in g]
    out.append(f"| **Total** | {fmt(sum(n(p) for _, p, _ in g))} | {fmt(sum(n(r) for _, _, r in g))} |")
    out.append("\n| Cliente | Linhas |\n|---|---:|")
    out += [f"| {k} | {v} |" for k, v in d]
    out.append("")


def exames(a, out):
    out.append("## Exames parados (C1-060)\n")
    t = origem(a.porta, """
SELECT 'total|'||COUNT(*)||'|'||SUM(CASE WHEN DATA_HORA_LIBERA_EXAME IS NULL AND DATA_HORA_SUSPENSAO_PEP IS NULL THEN 1 ELSE 0 END)
  FROM SILANEXA;
SELECT COALESCE(TRIM(m.NOME),'?')||'|'||faixa||'|'||COUNT(*) FROM (
 SELECT x.ATO,
  CASE WHEN x.DATA IS NULL THEN 'sem data' WHEN x.DATA >= CURRENT_DATE-30 THEN 'ate 30 dias' WHEN x.DATA >= CURRENT_DATE-365 THEN '31 dias a 1 ano'
       WHEN x.DATA >= CURRENT_DATE-1826 THEN '1 a 5 anos' WHEN x.DATA >= DATE '2000-01-01' THEN 'mais de 5 anos' ELSE 'antes de 2000' END faixa
 FROM SILANEXA x WHERE x.DATA_HORA_LIBERA_EXAME IS NULL AND x.DATA_HORA_SUSPENSAO_PEP IS NULL
) y LEFT JOIN SIMODULO m ON m.ID=y.ATO GROUP BY m.NOME, faixa;
""")
    d = cliente(a.banco, """
SELECT ei.situacao, sd.tipo,
  CASE WHEN r.solicitado_em >= NOW()-INTERVAL 30 DAY THEN 'até 30 dias' WHEN r.solicitado_em >= NOW()-INTERVAL 1 YEAR THEN '31 dias a 1 ano'
       WHEN r.solicitado_em >= NOW()-INTERVAL 5 YEAR THEN '1 a 5 anos' WHEN r.solicitado_em >= '2000-01-01' THEN 'mais de 5 anos'
       ELSE 'antes de 2000' END, COUNT(*)
  FROM exame_item ei JOIN requisicao_exame r ON r.id=ei.requisicao_exame_id
  LEFT JOIN setor_diagnostico sd ON sd.id=COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id)
 WHERE ei.excluido_em IS NULL AND r.excluido_em IS NULL AND ei.situacao IN ('em_analise','solicitado','autorizado','agendado','coletado')
 GROUP BY 1, 2, 3;
SELECT 'total', '', '', COUNT(*) FROM exame_item;
""")
    tot = t[0]
    out.append(f"Origem: {fmt(n(tot[1]))} exames; sem liberação e sem suspensão: {fmt(n(tot[2]))} "
               "(o mapa os grava como 'solicitado'; nenhum entra como 'em análise', a fila da bancada).\n")
    out.append("| Módulo (origem) | Faixa de idade | Exames sem liberação |\n|---|---|---:|")
    out += [f"| {m} | {FAIXAS.get(f, f)} | {fmt(n(c))} |" for m, f, c in sorted(t[1:])]
    out.append("\n| Situação (cliente) | Setor | Faixa | Exames |\n|---|---|---|---:|")
    out += [f"| {s} | {st} | {f} | {fmt(n(c))} |" for s, st, f, c in sorted(d)]
    out.append("")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--porta", type=int, default=3351)
    ap.add_argument("--banco", default="cliente_prontocardio")
    ap.add_argument("--saida")
    ap.add_argument("itens", nargs="*", default=["franquia", "modelos", "sinais", "exames"])
    a = ap.parse_args()
    out = [f"# Conferência das pendências de conector: origem na porta {a.porta}, cliente {a.banco}\n",
           "Só contagens e rótulos de catálogo (regra 5).\n"]
    for item in a.itens:
        {"franquia": franquia, "modelos": modelos, "sinais": sinais, "exames": exames}[item](a, out)
    texto = "\n".join(out) + "\n"
    if a.saida:
        with open(a.saida, "w", encoding="utf-8") as f:
            f.write(texto)
    print(texto)


if __name__ == "__main__":
    main()
