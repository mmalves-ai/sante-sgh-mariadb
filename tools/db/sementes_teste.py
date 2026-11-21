"""Teste das sementes dos domínios básicos (F2.4). Duas partes, saída "ok" ou a lista de erros (código 1):

1. Cobertura (sem banco): cada código que o produto consulta fixo está nas sementes. Os códigos saem do próprio
   código-fonte (contratos e mapas da API), não de uma lista copiada aqui, para o teste acompanhar o produto.
2. Banco (pule com --sem-banco): cria o cliente de teste f24_sementes pelo "criar novo cliente", num banco de
   plataforma de teste próprio; confere as contagens; recarrega (idempotente: nada incluído); confere que a carga não
   sobrescreve o que o cliente editou nem recria o que ele inativou; e apaga o cliente e a plataforma de teste.

uso: python3 -I tools/db/sementes_teste.py [--sem-banco]
"""
import importlib.util
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
CLIENTE = "f24_sementes"
PLATAFORMA = "plataforma_teste_f24_sementes"


def modulo(nome):
    spec = importlib.util.spec_from_file_location(nome, RAIZ / f"tools/db/{nome}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def fonte(caminho):
    return (RAIZ / caminho).read_text(encoding="utf-8")


def bloco(texto, inicio):
    """O trecho do `export const <inicio>` até o fim do literal (primeira linha que fecha com `}` ou `]`)."""
    i = texto.index(inicio)
    fim = re.search(r"\n(\] as const|\};)", texto[i:])
    return texto[i:i + fim.end()]


def snake(c):
    return re.sub(r"[A-Z]", lambda m: "_" + m.group(0).lower(), c)


def check(ddl_arq, nome):
    m = re.search(rf"CONSTRAINT {nome} CHECK \(\w+ IN \(([^)]*)\)", fonte(ddl_arq))
    return set(re.findall(r"'([^']+)'", m.group(1)))


def exigidos():
    """{tabela: {coluna: {valores}}} que o produto consulta por valor fixo."""
    api = "apps/api/src/modulos/"
    cores = set(re.findall(r"codigo: '([a-z]+)'", bloco(fonte("packages/contratos/src/recepcao/classificacao.ts"), "export const CORES_RISCO")))
    transf = fonte("packages/contratos/src/sadt/transfusao.ts")
    urg = {snake(c) for c in re.findall(r"codigo: '(\w+)'", bloco(transf, "export const URGENCIAS_TRANSFUSAO"))}
    reac = {snake(c) for c in re.findall(r"codigo: '(\w+)'", bloco(transf, "export const TIPOS_REACAO_TRANSFUSIONAL"))}
    grupos = set(re.findall(r"\d+: '(\w+)'", bloco(fonte(api + "recepcao/tela-senha.ts"), "export const CODIGO_DO_GRUPO")))
    oper = fonte(api + "recepcao/operacoes.ts")
    mapa = dict(re.findall(r"(\w+): '(\w+)'", bloco(oper, "const ACAO_DO_EVENTO")))
    eventos = re.findall(r"codigo: '(\w+)'", bloco(fonte("packages/contratos/src/recepcao/vocabulario.ts"), "export const EVENTOS_SENHA"))
    acoes = set(mapa.values()) | {e for e in eventos if e not in mapa} | set(re.findall(r"acaoFluxo\(tx, '(\w+)'\)", oper))
    sinais = set(re.findall(r"\w+: '(\w+)'", bloco(fonte(api + "recepcao/classificacao-operacoes.ts"), "export const PARAMETRO_DO_SINAL")))
    enf = fonte(api + "enfermagem/operacoes.ts") + fonte(api + "enfermagem/balanco-porta-propria.ts")
    sinais |= set(re.findall(r"parametro_vital WHERE codigo = '(\w+)'", enf))
    for lista in re.findall(r"pv\.codigo (?:=|IN) \(?('[^)\n]*'|'\w+')", enf):
        sinais |= set(re.findall(r"'(\w+)'", lista))
    sig = re.findall(r"significado = '(\w+)'", oper)
    return {
        "nivel_prioridade": {"codigo": cores},
        "tipo_transfusao": {"codigo": urg},
        "tipo_reacao_transfusional": {"codigo": reac},
        "grupo_prioridade_legal": {"codigo": grupos},
        "acao_fluxo_senha": {"codigo": acoes},
        "parametro_vital": {"codigo": sinais},
        "situacao_marcacao": {"significado": check("db/migracoes/05_AGE/02_tabelas.sql", "ck_situacao_marcacao_significado") | set(sig)},
        "situacao_checagem": {"categoria": check("db/migracoes/06_PEP/10_tabelas.sql", "ck_situacao_checagem_categoria")},
        "situacao_pedido_leito": {"estado": check("db/migracoes/07_INT/03_tabelas.sql", "ck_situacao_pedido_leito_estado")},
        "motivo_reclassificacao": {"tipo": check("db/migracoes/06_PEP/07_tabelas.sql", "ck_motivo_reclassificacao_tipo")},
        "motivo_saida_hospitalar": {"tipo_saida": {"alta", "transferencia", "obito"}},
        "motivo_cancelamento_requisicao_transfusao": {"codigo": {"outro"}},
        "motivo_ajuste_fatura": {"codigo": {"cancelamento"}},
        "motivo_cancelamento_guia_plano": {"codigo": {"outros"}},
        "tipo_documento_financeiro": {"codigo": {"fatura"}, "sentido": {"pagar", "receber"}},
        "tipo_escopo_acesso": {"codigo": {"setor"}, "entidade": {"bloco_internacao"}},
    }


def cobertura(sementes, erros):
    por_tabela = {t: l for _, t, l in sementes}
    for t, cols in exigidos().items():
        if t not in por_tabela:
            erros.append(f"cobertura: {t} sem sementes")
            continue
        for c, vals in cols.items():
            if not vals:
                erros.append(f"cobertura: {t}.{c}: nenhum valor extraído do código-fonte (o extrator ficou velho?)")
            presentes = {l.get(c) for l in por_tabela[t]}
            if vals - presentes:
                erros.append(f"cobertura: {t}.{c} sem {sorted(vals - presentes)}")


def banco(sementes, erros):
    cc = modulo("criar_cliente")
    cs = modulo("carregar_sementes")
    cc.PLAT = PLATAFORMA
    b = f"cliente_{CLIENTE}"
    limpar = f"DROP DATABASE IF EXISTS {b}; DROP DATABASE IF EXISTS {PLATAFORMA};"
    cc.sql(None, limpar)
    try:
        r = cc.criar(CLIENTE, "Teste das sementes F2.4")
        total = sum(len(l) for _, _, l in sementes)
        if r.get("sementes") != total:
            erros.append(f"criar: sementes {r.get('sementes')} (esperado {total})")
        cont = cs.contar(b, sementes)
        for _, t, l in sementes:
            if cont.get(t) != len(l):
                erros.append(f"contagem: {t} {cont.get(t)} (esperado {len(l)})")
        n = cc.sql(b, None, "-N", "-e", "select count(*) from sexo").stdout.strip()
        if n != str(len(next(l for _, t, l in sementes if t == "sexo"))):
            erros.append(f"contagem: sexo tem {n} linhas no banco")
        # Edição e inativação do cliente: a recarga não desfaz.
        cc.sql(b, "UPDATE sexo SET descricao = 'Editado pelo cliente' WHERE codigo = 'ignorado';"
                  "UPDATE estado_civil SET ativo = FALSE WHERE codigo = 'ignorado';"
                  "DELETE FROM tipo_telefone WHERE codigo = 'recado';")
        r2 = cs.carregar(b)
        if r2["incluidas"] != 1 or r2["ja_existiam"] != total - 1:
            erros.append(f"recarga: {r2} (esperado 1 incluída, a que foi apagada)")
        r3 = cs.carregar(b)
        if r3["incluidas"] != 0:
            erros.append(f"idempotência: a terceira carga incluiu {r3['incluidas']}")
        v = cc.sql(b, None, "-N", "-e", "select (select descricao from sexo where codigo='ignorado'),"
                                        " (select ativo from estado_civil where codigo='ignorado')").stdout.strip()
        if v != "Editado pelo cliente\t0":
            erros.append(f"recarga sobrescreveu o cliente: {v!r}")
        if cs.carregar(b, so_conferir=True)["faltam"]:
            erros.append("conferir: ainda faltam sementes")
    except SystemExit as e:
        erros.append(f"banco: {str(e)[:500]}")
    finally:
        cc.sql(None, limpar)
        sobra = cc.sql(None, None, "-N", "-e", "select count(*) from information_schema.schemata "
                                               f"where schema_name in ('{b}', '{PLATAFORMA}')").stdout.strip()
        if sobra != "0":
            erros.append("limpeza: o cliente ou a plataforma de teste ficou no servidor")


def main():
    erros = []
    sementes = modulo("carregar_sementes").ler_sementes()
    cobertura(sementes, erros)
    if "--sem-banco" not in sys.argv and not erros:
        banco(sementes, erros)
    if erros:
        print("\n".join(erros))
        raise SystemExit(1)
    print(f"ok ({len(sementes)} tabelas, {sum(len(l) for _, _, l in sementes)} sementes)")


if __name__ == "__main__":
    main()
