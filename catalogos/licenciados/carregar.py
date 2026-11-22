"""Carregador de catálogo LICENCIADO por arquivo do fornecedor, no ESPELHO PADRÃO DA BASE (ADR 0006, item 3).

uso: python3 -I catalogos/licenciados/carregar.py <fonte> <edicao> <arquivo> --vigencia AAAA-MM-DD
                                                  [--espelho BANCO] [--publicacao AAAA-MM-DD] [--completa]
                                                  [--valor-uco N] [--valor-filme N]
     fontes: brasindice, simpro (preço de mat/med por edição), cbhpm (honorários), cep (base de endereçamento)

Grava SÓ no espelho (recusa banco que não seja espelho); o cliente recebe pelo "criar cliente" ou por
"tools/db/espelho.py atualizar". O formato de cada fonte está em catalogos/licenciados/FORMATO.md (CSV ';', UTF-8,
cabeçalho com os nomes das colunas). Linha inválida não entra e é contada nos avisos por motivo e número da linha
(nunca o conteúdo). Idempotente: a mesma edição de novo atualiza, não duplica. --completa: o arquivo é a lista
inteira da fonte; item de mat/med ausente dela fica 'descontinuado' (o histórico de preço continua).
"""
import csv
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
LOTE = 1000

LAYOUTS = {
    "matmed": {"obrigatorias": ["codigo", "descricao", "tipo_produto"],
               "opcionais": ["apresentacao", "codigo_medicamento", "codigo_apresentacao", "codigo_laboratorio",
                             "nome_laboratorio", "quantidade_embalagem", "fator_divisao", "codigo_tuss", "codigo_ean",
                             "registro_anvisa", "preco_fabrica", "preco_maximo_consumidor", "aliquota_icms",
                             "valor_ipi", "tipo_alteracao"]},
    "cbhpm": {"obrigatorias": ["codigo", "descricao"],
              "opcionais": ["porte", "quantidade_porte", "quantidade_uco", "numero_auxiliares", "porte_anestesico",
                            "quantidade_filme_m2", "incidencia", "valor_procedimento"]},
    "cep": {"obrigatorias": ["cep", "codigo_ibge_municipio", "uf"],
            "opcionais": ["tipo_cep", "logradouro", "logradouro_abreviado", "complemento", "numero_inicial",
                          "numero_final", "lado", "nome_unidade", "codigo_bairro", "bairro", "cep_anterior"]},
}
FONTES = {"brasindice": ("matmed", "Brasíndice"), "simpro": ("matmed", "Simpro"), "cbhpm": ("cbhpm", "CBHPM"),
          "cep": ("cep", "Base de CEP")}
TIPOS_PRODUTO = {"medicamento", "material", "solucao", "dieta", "opme", "outro"}
ALTERACOES = {"inclusao", "alteracao_preco", "alteracao_cadastro", "exclusao"}
TIPOS_CEP = {"logradouro", "localidade", "grande_usuario", "caixa_postal", "unidade_operacional"}


class LinhaInvalida(Exception):
    pass


class Script(str):
    """O script SQL inteiro (texto, como antes) com a lista dos comandos em `comandos`, para quem precisa mandar em
    blocos menores que o max_allowed_packet do servidor (ex.: a semente do espelho, que roda tudo numa conexão)."""

    def __new__(cls, comandos):
        obj = super().__new__(cls, "\n".join(comandos))
        obj.comandos = list(comandos)
        return obj


def blocos(comandos, limite=8 * 1024 * 1024):
    """Agrupa comandos inteiros em blocos de até `limite` bytes (um comando maior que o limite vai sozinho)."""
    atual, tam = [], 0
    for c in comandos:
        n = len(c.encode("utf-8")) + 1
        if atual and tam + n > limite:
            yield "\n".join(atual)
            atual, tam = [], 0
        atual.append(c)
        tam += n
    if atual:
        yield "\n".join(atual)


def q(v) -> str:
    return "NULL" if v is None or v == "" else "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def dec(v, nome, minimo=None):
    if v is None or str(v).strip() == "":
        return None
    t = str(v).strip().replace(" ", "")
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        d = Decimal(t)
    except InvalidOperation:
        raise LinhaInvalida(f"{nome}_invalido")
    if minimo is not None and d < minimo:
        raise LinhaInvalida(f"{nome}_fora_da_faixa")
    return d


def inteiro(v, nome):
    d = dec(v, nome, 0)
    if d is not None and d != int(d):
        raise LinhaInvalida(f"{nome}_invalido")
    return None if d is None else int(d)


def texto(v, n, nome):
    t = (v or "").strip()
    if len(t) > n:
        raise LinhaInvalida(f"{nome}_longo")
    return t or None


def ler(arquivo: Path, layout: str):
    """Lê o CSV do formato e devolve (linhas válidas, avisos Counter, total). Linhas são dicts normalizados."""
    lay = LAYOUTS[layout]
    with arquivo.open(encoding="utf-8-sig", newline="") as fh:
        leitor = csv.DictReader(fh, delimiter=";")
        cab = [c.strip().lower() for c in (leitor.fieldnames or [])]
        faltam = [c for c in lay["obrigatorias"] if c not in cab]
        desconhecidas = [c for c in cab if c not in lay["obrigatorias"] + lay["opcionais"]]
        if faltam or desconhecidas:
            raise SystemExit(f"cabeçalho fora do formato {layout}: faltam {faltam}, desconhecidas {desconhecidas}")
        leitor.fieldnames = cab
        validas, avisos, total, vistos = [], Counter(), 0, set()
        for n, bruta in enumerate(leitor, start=2):
            total += 1
            try:
                linha = NORMALIZAR[layout]({k: (v or "").strip() for k, v in bruta.items() if k})
                chave = linha["_chave"]
                if chave in vistos:
                    raise LinhaInvalida("codigo_repetido")
                vistos.add(chave)
                validas.append(linha)
            except LinhaInvalida as e:
                avisos[f"linha {n}: {e}"] += 1
    return validas, avisos, total


def norm_matmed(r):
    if not r["codigo"] or not r["descricao"]:
        raise LinhaInvalida("obrigatoria_vazia")
    tipo = r["tipo_produto"].lower()
    if tipo not in TIPOS_PRODUTO:
        raise LinhaInvalida("tipo_produto_fora_do_dominio")
    alt = (r.get("tipo_alteracao") or "").lower() or None
    if alt and alt not in ALTERACOES:
        raise LinhaInvalida("tipo_alteracao_fora_do_dominio")
    out = {"_chave": r["codigo"], "codigo": texto(r["codigo"], 20, "codigo"), "descricao": texto(r["descricao"], 250, "descricao"),
           "tipo_produto": tipo, "apresentacao": texto(r.get("apresentacao"), 150, "apresentacao"),
           "codigo_medicamento": texto(r.get("codigo_medicamento"), 10, "codigo_medicamento"),
           "codigo_apresentacao": texto(r.get("codigo_apresentacao"), 10, "codigo_apresentacao"),
           "codigo_laboratorio": texto(r.get("codigo_laboratorio"), 10, "codigo_laboratorio"),
           "nome_laboratorio": texto(r.get("nome_laboratorio"), 150, "nome_laboratorio"),
           "quantidade_embalagem": dec(r.get("quantidade_embalagem"), "quantidade_embalagem"),
           "fator_divisao": dec(r.get("fator_divisao"), "fator_divisao"),
           "codigo_tuss": texto(r.get("codigo_tuss"), 10, "codigo_tuss"), "codigo_ean": texto(r.get("codigo_ean"), 14, "codigo_ean"),
           "registro_anvisa": texto(r.get("registro_anvisa"), 20, "registro_anvisa"),
           "preco_fabrica": dec(r.get("preco_fabrica"), "preco_fabrica", 0),
           "preco_maximo_consumidor": dec(r.get("preco_maximo_consumidor"), "preco_maximo_consumidor", 0),
           "aliquota_icms": dec(r.get("aliquota_icms"), "aliquota_icms", 0), "valor_ipi": dec(r.get("valor_ipi"), "valor_ipi", 0),
           "tipo_alteracao": alt}
    for c in ("quantidade_embalagem", "fator_divisao"):
        if out[c] is not None and out[c] <= 0:
            raise LinhaInvalida(f"{c}_fora_da_faixa")
    if out["preco_fabrica"] is None and out["preco_maximo_consumidor"] is None and alt != "exclusao":
        raise LinhaInvalida("sem_preco")
    return out


def norm_cbhpm(r):
    if not r["codigo"] or not r["descricao"]:
        raise LinhaInvalida("obrigatoria_vazia")
    an = inteiro(r.get("porte_anestesico"), "porte_anestesico")
    if an is not None and an > 8:
        raise LinhaInvalida("porte_anestesico_fora_da_faixa")
    return {"_chave": r["codigo"], "codigo": texto(r["codigo"], 15, "codigo"), "descricao": texto(r["descricao"], 500, "descricao"),
            "porte": texto(r.get("porte"), 5, "porte"), "quantidade_porte": dec(r.get("quantidade_porte"), "quantidade_porte", 0),
            "quantidade_uco": dec(r.get("quantidade_uco"), "quantidade_uco", 0),
            "numero_auxiliares": inteiro(r.get("numero_auxiliares"), "numero_auxiliares") or 0, "porte_anestesico": an,
            "quantidade_filme_m2": dec(r.get("quantidade_filme_m2"), "quantidade_filme_m2", 0),
            "incidencia": texto(r.get("incidencia"), 10, "incidencia"),
            "valor_procedimento": dec(r.get("valor_procedimento"), "valor_procedimento", 0)}


def norm_cep(r):
    cep = re.sub(r"\D", "", r["cep"])
    if not re.fullmatch(r"[0-9]{8}", cep):
        raise LinhaInvalida("cep_invalido")
    ibge = re.sub(r"\D", "", r["codigo_ibge_municipio"])
    if not re.fullmatch(r"[0-9]{7}", ibge):
        raise LinhaInvalida("codigo_ibge_invalido")
    tipo = (r.get("tipo_cep") or "logradouro").lower()
    if tipo not in TIPOS_CEP:
        raise LinhaInvalida("tipo_cep_fora_do_dominio")
    lado = (r.get("lado") or "").lower() or None
    if lado and lado not in ("par", "impar", "ambos"):
        raise LinhaInvalida("lado_fora_do_dominio")
    ant = re.sub(r"\D", "", r.get("cep_anterior") or "") or None
    if ant and len(ant) != 8:
        raise LinhaInvalida("cep_anterior_invalido")
    ini, fim = inteiro(r.get("numero_inicial"), "numero_inicial"), inteiro(r.get("numero_final"), "numero_final")
    if ini is not None and fim is not None and fim < ini:
        raise LinhaInvalida("numeracao_invertida")
    if bool(r.get("codigo_bairro")) != bool(r.get("bairro")):
        raise LinhaInvalida("bairro_incompleto")
    return {"_chave": cep, "cep": cep, "codigo_ibge": ibge, "uf": r["uf"].upper()[:2], "tipo_cep": tipo,
            "logradouro": texto(r.get("logradouro"), 200, "logradouro"),
            "logradouro_abreviado": texto(r.get("logradouro_abreviado"), 100, "logradouro_abreviado"),
            "complemento": texto(r.get("complemento"), 200, "complemento"), "numero_inicial": ini, "numero_final": fim,
            "lado": lado, "nome_unidade": texto(r.get("nome_unidade"), 150, "nome_unidade"),
            "codigo_bairro": texto(r.get("codigo_bairro"), 12, "codigo_bairro"), "bairro": texto(r.get("bairro"), 100, "bairro"),
            "cep_anterior": ant}


NORMALIZAR = {"matmed": norm_matmed, "cbhpm": norm_cbhpm, "cep": norm_cep}


def _valores(linhas, cols):
    for i in range(0, len(linhas), LOTE):
        yield ",\n".join("(" + ", ".join(q(r[c]) for c in cols) + ")" for r in linhas[i:i + LOTE])


def sql_matmed(fonte, nome, edicao, vig, pub, linhas, completa):
    agora = "UTC_TIMESTAMP(3)"
    p = [f"""INSERT INTO fonte_referencia_matmed (codigo, descricao, tipo_fonte, exige_licenca, ativo, criado_em)
VALUES ({q(fonte)}, {q(nome)}, 'publicacao_comercial', TRUE, TRUE, {agora})
ON DUPLICATE KEY UPDATE exige_licenca = TRUE, ativo = TRUE;
SET @f = (SELECT id FROM fonte_referencia_matmed WHERE codigo = {q(fonte)});
UPDATE edicao_referencia_matmed SET situacao = 'substituida', vigencia_fim = DATE_SUB({q(vig)}, INTERVAL 1 DAY),
  alterado_em = {agora}, versao = versao + 1
  WHERE fonte_referencia_matmed_id = @f AND situacao = 'ativa' AND numero_edicao <> {q(edicao)} AND vigencia_inicio < {q(vig)};
INSERT INTO edicao_referencia_matmed (fonte_referencia_matmed_id, numero_edicao, data_publicacao, vigencia_inicio,
  quantidade_itens, situacao, operacao, ocorrido_em, criado_em)
VALUES (@f, {q(edicao)}, {q(pub)}, {q(vig)}, {len(linhas)}, 'ativa', 'inclusao', {agora}, {agora})
ON DUPLICATE KEY UPDATE quantidade_itens = VALUES(quantidade_itens), situacao = 'ativa', alterado_em = {agora},
  versao = versao + 1;
SET @e = (SELECT id FROM edicao_referencia_matmed WHERE fonte_referencia_matmed_id = @f AND numero_edicao = {q(edicao)});
CREATE TEMPORARY TABLE tmp_item_licenciado (codigo VARCHAR(20) NOT NULL PRIMARY KEY, descricao VARCHAR(250),
  tipo_produto VARCHAR(30), apresentacao VARCHAR(150), codigo_medicamento VARCHAR(10), codigo_apresentacao VARCHAR(10),
  codigo_laboratorio VARCHAR(10), nome_laboratorio VARCHAR(150), quantidade_embalagem DECIMAL(15,4),
  fator_divisao DECIMAL(15,4), codigo_tuss VARCHAR(10), codigo_ean VARCHAR(14), registro_anvisa VARCHAR(20),
  preco_fabrica DECIMAL(15,4), preco_maximo_consumidor DECIMAL(15,4), aliquota_icms DECIMAL(7,4),
  valor_ipi DECIMAL(15,4), tipo_alteracao VARCHAR(30));"""]
    cols = ["codigo", "descricao", "tipo_produto", "apresentacao", "codigo_medicamento", "codigo_apresentacao",
            "codigo_laboratorio", "nome_laboratorio", "quantidade_embalagem", "fator_divisao", "codigo_tuss",
            "codigo_ean", "registro_anvisa", "preco_fabrica", "preco_maximo_consumidor", "aliquota_icms", "valor_ipi",
            "tipo_alteracao"]
    p += [f"INSERT INTO tmp_item_licenciado ({', '.join(cols)}) VALUES\n{v};" for v in _valores(linhas, cols)]
    p.append(f"""INSERT INTO item_referencia_matmed (fonte_referencia, codigo_referencia, codigo_medicamento, codigo_apresentacao,
  codigo_laboratorio, descricao, apresentacao, nome_laboratorio, tipo_produto, quantidade_embalagem, fator_divisao,
  codigo_tuss, codigo_ean, registro_anvisa, tipo_ultima_alteracao, edicao_referencia, situacao, criado_em)
SELECT {q(fonte)}, codigo, codigo_medicamento, codigo_apresentacao, codigo_laboratorio, descricao, apresentacao,
  nome_laboratorio, tipo_produto, quantidade_embalagem, fator_divisao, codigo_tuss, codigo_ean, registro_anvisa,
  tipo_alteracao, {q(edicao)}, IF(tipo_alteracao = 'exclusao', 'descontinuado', 'ativo'), {agora} FROM tmp_item_licenciado
ON DUPLICATE KEY UPDATE codigo_medicamento = VALUES(codigo_medicamento), codigo_apresentacao = VALUES(codigo_apresentacao),
  codigo_laboratorio = VALUES(codigo_laboratorio), descricao = VALUES(descricao), apresentacao = VALUES(apresentacao),
  nome_laboratorio = VALUES(nome_laboratorio), tipo_produto = VALUES(tipo_produto),
  quantidade_embalagem = VALUES(quantidade_embalagem), fator_divisao = VALUES(fator_divisao),
  codigo_tuss = VALUES(codigo_tuss), codigo_ean = VALUES(codigo_ean), registro_anvisa = VALUES(registro_anvisa),
  tipo_ultima_alteracao = VALUES(tipo_ultima_alteracao), edicao_referencia = VALUES(edicao_referencia),
  situacao = VALUES(situacao), alterado_em = {agora}, versao = versao + 1;
INSERT INTO preco_referencia_matmed (item_referencia_matmed_id, operacao, ocorrido_em, edicao_referencia_matmed_id,
  vigencia_inicio, preco_fabrica, preco_maximo_consumidor, aliquota_icms, valor_ipi, criado_em)
SELECT i.id, IF(t.tipo_alteracao = 'exclusao', 'exclusao', 'inclusao'), {agora}, @e, {q(vig)}, t.preco_fabrica,
  t.preco_maximo_consumidor, t.aliquota_icms, t.valor_ipi, {agora}
FROM tmp_item_licenciado t JOIN item_referencia_matmed i ON i.fonte_referencia = {q(fonte)} AND i.codigo_referencia = t.codigo
ON DUPLICATE KEY UPDATE preco_referencia_matmed.operacao = VALUES(operacao), preco_referencia_matmed.preco_fabrica = VALUES(preco_fabrica),
  preco_referencia_matmed.preco_maximo_consumidor = VALUES(preco_maximo_consumidor), preco_referencia_matmed.aliquota_icms = VALUES(aliquota_icms),
  preco_referencia_matmed.valor_ipi = VALUES(valor_ipi), preco_referencia_matmed.alterado_em = {agora}, preco_referencia_matmed.versao = preco_referencia_matmed.versao + 1;""")
    if completa:
        p.append(f"UPDATE item_referencia_matmed i SET situacao = 'descontinuado', alterado_em = {agora}, versao = versao + 1 "
                 f"WHERE i.fonte_referencia = {q(fonte)} AND i.situacao = 'ativo' AND NOT EXISTS "
                 f"(SELECT 1 FROM tmp_item_licenciado t WHERE t.codigo = i.codigo_referencia);")
    contagem = (f"SELECT 'item_referencia_matmed', COUNT(*) FROM item_referencia_matmed WHERE fonte_referencia = {q(fonte)} "
                f"UNION ALL SELECT 'preco_referencia_matmed', COUNT(*) FROM preco_referencia_matmed WHERE edicao_referencia_matmed_id = @e "
                f"UNION ALL SELECT 'edicao_referencia_matmed', COUNT(*) FROM edicao_referencia_matmed WHERE fonte_referencia_matmed_id = @f;")
    return Script(p), contagem


def sql_cbhpm(fonte, nome, edicao, vig, pub, linhas, completa, uco=None, filme=None):
    agora = "UTC_TIMESTAMP(3)"
    p = [f"""UPDATE tabela_referencia_procedimento SET vigencia_fim = DATE_SUB({q(vig)}, INTERVAL 1 DAY), alterado_em = {agora},
  versao = versao + 1 WHERE codigo_tabela = {q(fonte)} AND vigencia_fim IS NULL AND edicao <> {q(edicao)} AND vigencia_inicio < {q(vig)};
INSERT INTO tabela_referencia_procedimento (codigo_tabela, edicao, descricao, valor_unidade_custo_operacional,
  valor_filme_m2, licenciada, vigencia_inicio, versao_fonte, criado_em)
VALUES ({q(fonte)}, {q(edicao)}, {q(nome + ' ' + edicao)}, {q(uco)}, {q(filme)}, TRUE, {q(vig)}, {q(edicao)}, {agora})
ON DUPLICATE KEY UPDATE valor_unidade_custo_operacional = VALUES(valor_unidade_custo_operacional),
  valor_filme_m2 = VALUES(valor_filme_m2), vigencia_inicio = VALUES(vigencia_inicio), alterado_em = {agora}, versao = versao + 1;
SET @t = (SELECT id FROM tabela_referencia_procedimento WHERE codigo_tabela = {q(fonte)} AND edicao = {q(edicao)});"""]
    cols = ["codigo", "descricao", "porte", "quantidade_porte", "quantidade_uco", "numero_auxiliares",
            "porte_anestesico", "quantidade_filme_m2", "incidencia", "valor_procedimento"]
    for i in range(0, len(linhas), LOTE):
        tuplas = ",\n".join("(@t, " + ", ".join(q(r[c]) for c in cols) + f", {q(vig)}, {agora})"
                             for r in linhas[i:i + LOTE])
        p.append(f"""INSERT INTO tabela_referencia_procedimento_item (tabela_referencia_procedimento_id, codigo_procedimento,
  descricao, porte_codigo, quantidade_porte, quantidade_uco, numero_auxiliares, porte_anestesico, quantidade_filme_m2,
  incidencia, valor_procedimento, vigencia_inicio, criado_em) VALUES
{tuplas}
ON DUPLICATE KEY UPDATE descricao = VALUES(descricao), porte_codigo = VALUES(porte_codigo),
  quantidade_porte = VALUES(quantidade_porte), quantidade_uco = VALUES(quantidade_uco),
  numero_auxiliares = VALUES(numero_auxiliares), porte_anestesico = VALUES(porte_anestesico),
  quantidade_filme_m2 = VALUES(quantidade_filme_m2), incidencia = VALUES(incidencia),
  valor_procedimento = VALUES(valor_procedimento), alterado_em = {agora}, versao = versao + 1;""")
    contagem = (f"SELECT 'tabela_referencia_procedimento_item', COUNT(*) FROM tabela_referencia_procedimento_item "
                f"WHERE tabela_referencia_procedimento_id = @t UNION ALL SELECT 'tabela_referencia_procedimento', "
                f"COUNT(*) FROM tabela_referencia_procedimento WHERE codigo_tabela = {q(fonte)};")
    return Script(p), contagem


def sql_cep(fonte, nome, edicao, vig, pub, linhas, completa):
    agora = "UTC_TIMESTAMP(3)"
    cols = ["cep", "codigo_ibge", "uf", "tipo_cep", "logradouro", "logradouro_abreviado", "complemento",
            "numero_inicial", "numero_final", "lado", "nome_unidade", "codigo_bairro", "bairro", "cep_anterior"]
    p = ["""CREATE TEMPORARY TABLE tmp_cep_licenciado (cep CHAR(8) NOT NULL PRIMARY KEY, codigo_ibge CHAR(7), uf CHAR(2),
  tipo_cep VARCHAR(20), logradouro VARCHAR(200), logradouro_abreviado VARCHAR(100), complemento VARCHAR(200),
  numero_inicial INT UNSIGNED, numero_final INT UNSIGNED, lado VARCHAR(10), nome_unidade VARCHAR(150),
  codigo_bairro VARCHAR(12), bairro VARCHAR(100), cep_anterior CHAR(8));"""]
    p += [f"INSERT INTO tmp_cep_licenciado ({', '.join(cols)}) VALUES\n{v};" for v in _valores(linhas, cols)]
    p.append(f"""INSERT INTO bairro (codigo_dne, descricao, municipio_ibge_id, ativo, vigencia_inicio, versao_fonte, criado_em)
SELECT t.codigo_bairro, MIN(t.bairro), MIN(m.id), TRUE, {q(vig)}, {q(edicao)}, {agora}
FROM tmp_cep_licenciado t JOIN municipio_ibge m ON m.codigo_ibge = t.codigo_ibge
WHERE t.codigo_bairro IS NOT NULL GROUP BY t.codigo_bairro
ON DUPLICATE KEY UPDATE bairro.descricao = VALUES(descricao), bairro.municipio_ibge_id = VALUES(municipio_ibge_id),
  bairro.versao_fonte = VALUES(versao_fonte), bairro.alterado_em = {agora}, bairro.versao = bairro.versao + 1;
INSERT INTO logradouro_cep (codigo_cep, tipo_cep, logradouro, logradouro_abreviado, complemento, numero_inicial,
  numero_final, lado, nome_unidade, bairro_id, municipio_ibge_id, unidade_federativa_id, cep_anterior, ativo,
  vigencia_inicio, versao_fonte, criado_em)
SELECT t.cep, t.tipo_cep, t.logradouro, t.logradouro_abreviado, t.complemento, t.numero_inicial, t.numero_final, t.lado,
  t.nome_unidade, b.id, m.id, u.id, t.cep_anterior, TRUE, {q(vig)}, {q(edicao)}, {agora}
FROM tmp_cep_licenciado t JOIN municipio_ibge m ON m.codigo_ibge = t.codigo_ibge
JOIN unidade_federativa u ON u.sigla = t.uf LEFT JOIN bairro b ON b.codigo_dne = t.codigo_bairro
ON DUPLICATE KEY UPDATE logradouro_cep.tipo_cep = VALUES(tipo_cep), logradouro_cep.logradouro = VALUES(logradouro),
  logradouro_cep.logradouro_abreviado = VALUES(logradouro_abreviado), logradouro_cep.complemento = VALUES(complemento),
  logradouro_cep.numero_inicial = VALUES(numero_inicial), logradouro_cep.numero_final = VALUES(numero_final), logradouro_cep.lado = VALUES(lado),
  logradouro_cep.nome_unidade = VALUES(nome_unidade), logradouro_cep.bairro_id = VALUES(bairro_id), logradouro_cep.municipio_ibge_id = VALUES(municipio_ibge_id),
  logradouro_cep.unidade_federativa_id = VALUES(unidade_federativa_id), logradouro_cep.cep_anterior = VALUES(cep_anterior), logradouro_cep.ativo = TRUE,
  logradouro_cep.versao_fonte = VALUES(versao_fonte), logradouro_cep.alterado_em = {agora}, logradouro_cep.versao = logradouro_cep.versao + 1;""")
    if completa:
        p.append(f"UPDATE logradouro_cep l SET ativo = FALSE, vigencia_fim = DATE_SUB({q(vig)}, INTERVAL 1 DAY), "
                 f"alterado_em = {agora}, versao = versao + 1 WHERE l.ativo AND NOT EXISTS "
                 f"(SELECT 1 FROM tmp_cep_licenciado t WHERE t.cep = l.codigo_cep);")
    contagem = ("SELECT 'sem_municipio_ou_uf', COUNT(*) FROM tmp_cep_licenciado t LEFT JOIN municipio_ibge m ON "
                "m.codigo_ibge = t.codigo_ibge LEFT JOIN unidade_federativa u ON u.sigla = t.uf WHERE m.id IS NULL "
                f"OR u.id IS NULL UNION ALL SELECT 'logradouro_cep', COUNT(*) FROM logradouro_cep WHERE versao_fonte = {q(edicao)} "
                f"UNION ALL SELECT 'bairro', COUNT(*) FROM bairro WHERE versao_fonte = {q(edicao)};")
    return Script(p), contagem


GERAR = {"matmed": sql_matmed, "cbhpm": sql_cbhpm, "cep": sql_cep}


def _espelho():
    spec = importlib.util.spec_from_file_location("espelho_mod", RAIZ / "tools/db/espelho.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def carregar(fonte, edicao, arquivo: Path, vigencia, espelho=None, publicacao=None, completa=False, uco=None,
             filme=None) -> dict:
    if fonte not in FONTES:
        raise SystemExit(f"fonte desconhecida: {fonte} (fontes: {', '.join(FONTES)})")
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", vigencia or ""):
        raise SystemExit("--vigencia AAAA-MM-DD obrigatória (início de validade da edição)")
    if not re.fullmatch(r"[A-Za-z0-9._/-]{1,30}", edicao or ""):
        raise SystemExit("edição: até 30 caracteres (letras, dígitos, . _ / -)")
    esp = _espelho()
    banco = esp.nome_banco(espelho) if espelho else esp.ESPELHO
    if not esp.existe(banco):
        raise SystemExit(f"{banco} não é um espelho: o licenciado só entra no espelho padrão da base (ADR 0006)")
    layout, nome = FONTES[fonte]
    linhas, avisos, total = ler(arquivo, layout)
    sha = hashlib.sha256(arquivo.read_bytes()).hexdigest()
    extra = {"uco": dec(uco, "valor_uco", 0), "filme": dec(filme, "valor_filme", 0)} if layout == "cbhpm" else {}
    corpo, contagem = GERAR[layout](fonte, nome, edicao, vigencia, publicacao, linhas, completa, **extra)
    r = esp.sql(banco, corpo + "\n" + contagem, "-N", "-B")
    if r.returncode:
        esp.registrar_carga(banco, fonte, "licenciado", edicao, {}, [r.stderr[-300:]], arquivo.name, sha, vigencia, "falha")
        raise SystemExit(f"carga falhou: {r.stderr[-600:]}")
    gravadas = {t: int(n) for t, n in (ln.split("\t") for ln in r.stdout.splitlines() if ln)}
    lista_avisos = [f"{k} ({n})" if n > 1 else k for k, n in sorted(avisos.items())]
    if gravadas.get("sem_municipio_ou_uf"):
        lista_avisos.append(f"{gravadas['sem_municipio_ou_uf']} CEP sem município ou UF no espelho (carregue ibge antes)")
    reg = esp.registrar_carga(banco, fonte, "licenciado", edicao, gravadas, lista_avisos, arquivo.name, sha, vigencia)
    return {"fonte": fonte, "edicao": edicao, "espelho": banco, "linhas_arquivo": total, "validas": len(linhas),
            "recusadas": total - len(linhas), "gravadas": gravadas, "avisos": lista_avisos[:20], **reg}


def _arg(nome):
    return sys.argv[sys.argv.index(nome) + 1] if nome in sys.argv else None


def main():
    pos = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and not sys.argv[i - 1] in
           ("--espelho", "--vigencia", "--publicacao", "--valor-uco", "--valor-filme")]
    if len(pos) < 3:
        raise SystemExit(__doc__)
    r = carregar(pos[0], pos[1], Path(pos[2]), _arg("--vigencia"), _arg("--espelho"), _arg("--publicacao"),
                 "--completa" in sys.argv, _arg("--valor-uco"), _arg("--valor-filme"))
    print(json.dumps(r, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
