"""Base licenciada de doses e interações (03-PEP L108, C2-104; ADR 0006): formato, leitura e SQL do espelho.

Usado por catalogos/licenciados/carregar.py (fontes base_dose e base_interacao); o formato está em FORMATO.md. Grava
limite_dose_principio e interacao_medicamentosa no ESPELHO, com a edição em edicao_base. O princípio ativo é ligado
pelo código da Denominação Comum Brasileira; a unidade de prescrição e a via, pelo código do catálogo. Linha sem
cadastro não entra e é contada (sem_principio_ativo, sem_unidade, sem_via). O limite e a interação próprios do
hospital (edição nula) nunca são tocados. --completa: linha da base ausente da edição nova fica inativa (nunca apagada).
"""

PERIODOS = {"dose", "dia", "tratamento"}
GRAVIDADES = [("leve", "Leve", 1), ("moderada", "Moderada", 2), ("grave", "Grave", 3),
              ("contraindicada", "Contraindicada", 4)]
SIM = {"sim", "s", "true", "1", "verdadeiro"}
NAO = {"", "nao", "não", "n", "false", "0", "falso"}

DOSES = ["dose_minima_impeditiva", "dose_minima_alerta", "dose_maxima_alerta", "dose_maxima_impeditiva"]
LAYOUTS = {
    "dose": {"obrigatorias": ["codigo", "codigo_dcb", "unidade"],
             "opcionais": ["via", "periodo", "por_peso", "idade_minima_dias", "idade_maxima_dias", "peso_minimo_kg",
                           "peso_maximo_kg", "dias_tratamento", *DOSES, "mensagem_minima", "mensagem_maxima",
                           "referencia"]},
    "interacao": {"obrigatorias": ["codigo_dcb", "interagente_codigo_dcb", "gravidade", "efeito"],
                  "opcionais": ["mecanismo", "conduta", "referencia"]},
}
FONTES = {"base_dose": ("dose", "Base de doses"), "base_interacao": ("interacao", "Base de interações")}


def _antes(a, b):
    return a is None or b is None or a <= b


def normalizadores(m):
    """Devolve as funções de normalização com os auxiliares do carregador (dec, inteiro, texto, LinhaInvalida)."""

    def norm_dose(r):
        for c in ("codigo", "codigo_dcb", "unidade"):
            if not r.get(c):
                raise m.LinhaInvalida("obrigatoria_vazia")
        periodo = (r.get("periodo") or "dose").lower()
        if periodo not in PERIODOS:
            raise m.LinhaInvalida("periodo_fora_do_dominio")
        pp = (r.get("por_peso") or "").lower()
        if pp not in SIM | NAO:
            raise m.LinhaInvalida("por_peso_invalido")
        out = {"_chave": r["codigo"], "codigo": m.texto(r["codigo"], 30, "codigo"),
               "codigo_dcb": m.texto(r["codigo_dcb"], 10, "codigo_dcb"), "unidade": m.texto(r["unidade"], 30, "unidade"),
               "via": m.texto(r.get("via"), 30, "via"), "periodo": periodo, "por_peso": 1 if pp in SIM else 0,
               "idade_minima_dias": m.inteiro(r.get("idade_minima_dias"), "idade_minima_dias"),
               "idade_maxima_dias": m.inteiro(r.get("idade_maxima_dias"), "idade_maxima_dias"),
               "peso_minimo_kg": m.dec(r.get("peso_minimo_kg"), "peso_minimo_kg", 0),
               "peso_maximo_kg": m.dec(r.get("peso_maximo_kg"), "peso_maximo_kg", 0),
               "dias_tratamento": m.inteiro(r.get("dias_tratamento"), "dias_tratamento"),
               "mensagem_minima": m.texto(r.get("mensagem_minima"), 200, "mensagem_minima"),
               "mensagem_maxima": m.texto(r.get("mensagem_maxima"), 200, "mensagem_maxima"),
               "referencia": m.texto(r.get("referencia"), 300, "referencia")}
        for c in DOSES:
            out[c] = m.dec(r.get(c), c, 0)
        if all(out[c] is None for c in DOSES):
            raise m.LinhaInvalida("sem_dose")
        if not (_antes(out["dose_maxima_alerta"], out["dose_maxima_impeditiva"])
                and _antes(out["dose_minima_impeditiva"], out["dose_minima_alerta"])
                and _antes(out["dose_minima_alerta"], out["dose_maxima_alerta"])):
            raise m.LinhaInvalida("faixa_de_dose_invertida")
        if not _antes(out["idade_minima_dias"], out["idade_maxima_dias"]):
            raise m.LinhaInvalida("faixa_de_idade_invertida")
        if not _antes(out["peso_minimo_kg"], out["peso_maximo_kg"]):
            raise m.LinhaInvalida("faixa_de_peso_invertida")
        if any(v is not None and v >= 10000 for v in (out["peso_minimo_kg"], out["peso_maximo_kg"])):
            raise m.LinhaInvalida("peso_fora_da_faixa")
        if periodo == "tratamento" and not out["dias_tratamento"]:
            raise m.LinhaInvalida("tratamento_sem_dias")
        return out

    def norm_interacao(r):
        for c in ("codigo_dcb", "interagente_codigo_dcb", "gravidade", "efeito"):
            if not r.get(c):
                raise m.LinhaInvalida("obrigatoria_vazia")
        a = m.texto(r["codigo_dcb"], 10, "codigo_dcb")
        b = m.texto(r["interagente_codigo_dcb"], 10, "interagente_codigo_dcb")
        if a == b:
            raise m.LinhaInvalida("par_com_o_mesmo_principio")
        grav = r["gravidade"].lower()
        if grav not in {g for g, _, _ in GRAVIDADES}:
            raise m.LinhaInvalida("gravidade_fora_do_dominio")
        return {"_chave": tuple(sorted((a, b))), "codigo_dcb": a, "interagente": b, "gravidade": grav,
                "efeito": m.texto(r["efeito"], 4000, "efeito"), "mecanismo": m.texto(r.get("mecanismo"), 4000, "mecanismo"),
                "conduta": m.texto(r.get("conduta"), 4000, "conduta"), "referencia": m.texto(r.get("referencia"), 500, "referencia")}

    return {"dose": norm_dose, "interacao": norm_interacao}


def geradores(m):
    """Devolve as funções que geram o SQL do espelho (Script, contagem), com os auxiliares do carregador."""
    q, agora = m.q, "UTC_TIMESTAMP(3)"

    def sql_dose(fonte, nome, edicao, vig, pub, linhas, completa):
        cols = ["codigo", "codigo_dcb", "unidade", "via", "periodo", "por_peso", "idade_minima_dias", "idade_maxima_dias",
                "peso_minimo_kg", "peso_maximo_kg", "dias_tratamento", *DOSES, "mensagem_minima", "mensagem_maxima",
                "referencia"]
        p = ["""DROP TEMPORARY TABLE IF EXISTS tmp_limite_dose_base;
CREATE TEMPORARY TABLE tmp_limite_dose_base (codigo VARCHAR(30) NOT NULL PRIMARY KEY, codigo_dcb VARCHAR(10),
  unidade VARCHAR(30), via VARCHAR(30), periodo VARCHAR(30), por_peso TINYINT, idade_minima_dias INT UNSIGNED,
  idade_maxima_dias INT UNSIGNED, peso_minimo_kg DECIMAL(7,3), peso_maximo_kg DECIMAL(7,3), dias_tratamento SMALLINT UNSIGNED,
  dose_minima_impeditiva DECIMAL(15,4), dose_minima_alerta DECIMAL(15,4), dose_maxima_alerta DECIMAL(15,4),
  dose_maxima_impeditiva DECIMAL(15,4), mensagem_minima VARCHAR(200), mensagem_maxima VARCHAR(200), referencia VARCHAR(300));"""]
        p += [f"INSERT INTO tmp_limite_dose_base ({', '.join(cols)}) VALUES\n{v};" for v in m._valores(linhas, cols)]
        dest = ["idade_minima_dias", "idade_maxima_dias", "peso_minimo_kg", "peso_maximo_kg", "por_peso", "periodo",
                "dias_tratamento", *DOSES, "mensagem_minima", "mensagem_maxima"]
        atualiza = ", ".join(f"limite_dose_principio.{c} = VALUES({c})" for c in ["principio_ativo_id", "via_de_uso_id", "unidade_prescricao_id",
                                                             *dest, "referencia_bibliografica", "edicao_base"])
        p.append(f"""INSERT INTO limite_dose_principio (principio_ativo_id, via_de_uso_id, unidade_prescricao_id, {', '.join(dest)},
  referencia_bibliografica, codigo_base, edicao_base, ativo, criado_em)
SELECT pa.id, v.id, u.id, {', '.join('t.' + c for c in dest)}, t.referencia, t.codigo, {q(edicao)}, TRUE, {agora}
FROM tmp_limite_dose_base t JOIN principio_ativo pa ON pa.codigo_dcb = t.codigo_dcb
  JOIN unidade_prescricao u ON u.codigo = t.unidade LEFT JOIN via_de_uso v ON v.codigo = t.via
WHERE t.via IS NULL OR v.id IS NOT NULL
ON DUPLICATE KEY UPDATE {atualiza}, limite_dose_principio.ativo = TRUE, limite_dose_principio.alterado_em = {agora},
  limite_dose_principio.versao = limite_dose_principio.versao + 1;""")
        if completa:
            p.append(f"UPDATE limite_dose_principio SET ativo = FALSE, alterado_em = {agora}, versao = versao + 1 "
                     f"WHERE codigo_base IS NOT NULL AND ativo AND edicao_base <> {q(edicao)};")
        contagem = (f"SELECT 'limite_dose_principio', COUNT(*) FROM limite_dose_principio WHERE edicao_base = {q(edicao)} AND ativo "
                    "UNION ALL SELECT 'sem_principio_ativo', (SELECT COUNT(*) FROM tmp_limite_dose_base t LEFT JOIN principio_ativo pa "
                    "ON pa.codigo_dcb = t.codigo_dcb LEFT JOIN unidade_prescricao u ON u.codigo = t.unidade "
                    "LEFT JOIN via_de_uso v ON v.codigo = t.via WHERE pa.id IS NULL OR u.id IS NULL OR (t.via IS NOT NULL AND v.id IS NULL));")
        return m.Script(p), contagem

    def sql_interacao(fonte, nome, edicao, vig, pub, linhas, completa):
        cols = ["codigo_dcb", "interagente", "gravidade", "efeito", "mecanismo", "conduta", "referencia"]
        sementes = ", ".join(f"({q(c)}, {q(d)}, {n}, TRUE, {agora})" for c, d, n in GRAVIDADES)
        p = [f"""INSERT INTO gravidade_interacao (codigo, descricao, nivel, ativo, criado_em) VALUES {sementes}
ON DUPLICATE KEY UPDATE id = id;
DROP TEMPORARY TABLE IF EXISTS tmp_interacao_base;
CREATE TEMPORARY TABLE tmp_interacao_base (codigo_dcb VARCHAR(10) NOT NULL, interagente VARCHAR(10) NOT NULL,
  gravidade VARCHAR(30), efeito TEXT, mecanismo TEXT, conduta TEXT, referencia VARCHAR(500),
  PRIMARY KEY (codigo_dcb, interagente));"""]
        p += [f"INSERT INTO tmp_interacao_base ({', '.join(cols)}) VALUES\n{v};" for v in m._valores(linhas, cols)]
        base = "interacao_medicamentosa.edicao_base IS NULL"
        campos = ["gravidade_interacao_id", "efeito", "mecanismo", "conduta", "referencia_bibliografica"]
        atualiza = ", ".join(f"{c} = IF({base}, interacao_medicamentosa.{c}, VALUES({c}))" for c in campos)
        p.append(f"""INSERT INTO interacao_medicamentosa (principio_ativo_id, interagente_principio_ativo_id, gravidade_interacao_id,
  efeito, mecanismo, conduta, referencia_bibliografica, edicao_base, ativo, criado_em)
SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id), g.id, t.efeito, t.mecanismo, t.conduta, t.referencia, {q(edicao)}, TRUE, {agora}
FROM tmp_interacao_base t JOIN principio_ativo a ON a.codigo_dcb = t.codigo_dcb
  JOIN principio_ativo b ON b.codigo_dcb = t.interagente JOIN gravidade_interacao g ON g.codigo = t.gravidade
ON DUPLICATE KEY UPDATE {atualiza},
  ativo = IF({base}, interacao_medicamentosa.ativo, TRUE),
  alterado_em = IF({base}, interacao_medicamentosa.alterado_em, {agora}),
  versao = IF({base}, interacao_medicamentosa.versao, interacao_medicamentosa.versao + 1),
  edicao_base = IF({base}, NULL, VALUES(edicao_base));""")
        if completa:
            p.append(f"UPDATE interacao_medicamentosa SET ativo = FALSE, alterado_em = {agora}, versao = versao + 1 "
                     f"WHERE edicao_base IS NOT NULL AND ativo AND edicao_base <> {q(edicao)};")
        contagem = (f"SELECT 'interacao_medicamentosa', COUNT(*) FROM interacao_medicamentosa WHERE edicao_base = {q(edicao)} AND ativo "
                    "UNION ALL SELECT 'sem_principio_ativo', (SELECT COUNT(*) FROM tmp_interacao_base t LEFT JOIN principio_ativo a "
                    "ON a.codigo_dcb = t.codigo_dcb LEFT JOIN principio_ativo b ON b.codigo_dcb = t.interagente "
                    "WHERE a.id IS NULL OR b.id IS NULL);")
        return m.Script(p), contagem

    return {"dose": sql_dose, "interacao": sql_interacao}
