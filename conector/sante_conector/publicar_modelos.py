"""Modelos de documento clínico migrados entram em uso (decisão 61, revisão de 27/11; ADR 0006: importação é continuidade).

Roda depois da carga do mapa, em toda execução (importar e Sincronizar), no banco do cliente. Só contagens saem daqui.

O registro clínico novo só abre modelo publicado (o selo da versão publicada). O modelo que o hospital usava na origem
chega pela carga como rascunho (o modelo e a versão atual migrada, número 1000, com a definição em retrato) e ficaria
inútil até a comissão de prontuário publicá-lo pelo ciclo de quatro olhos. Este passo põe em uso a versão atual migrada:

1. **Conta de migração** do cliente (login `migracao`, a mesma que o mapa presume onde a origem não diz o usuário,
   ex. L7-08): conta de SERVIÇO, inativa, sem credencial, origem 'migracao' (não entra no sistema; fica visível ao
   hospital como autora). O motor a garante ANTES da carga do mapa (`conta_migracao`); aqui ela é reaproveitada. Um
   login `migracao` que não seja essa conta de serviço (ex. uma pessoa) nunca é adotado: o passo falha visível.
2. **Publicação** de cada modelo migrado que ainda está em rascunho e nunca teve versão publicada (o banco de perguntas
   da migração fica de fora: é rascunho por desenho): a versão 1000 passa a 'publicada' (na data da carga, pela conta
   de migração, `hash_definicao` = SHA-256 do retrato), o modelo passa a 'publicado' com ela, e o evento 'publicado'
   com o texto "migração" entra no histórico do modelo. A revisão da comissão sobre o modelo migrado depende do
   construtor aceitar a versão migrada (sem `formato`) como base de nova versão: item do produto (decisão 61). Nada
   que o hospital já mexeu é tocado: modelo em revisão, aposentado, excluído ou com versão
   publicada pelo hospital fica como está.
3. **Selo da origem no Sincronizar**: a origem vence na versão migrada (o retrato pode mudar). Se a versão 1000
   publicada pela conta de migração ainda é a que está em uso e o retrato mudou, o hash é refeito e um novo evento
   'publicado' ("migração: versão atualizada pela origem") fica no histórico; o registro novo leva o selo novo.

As colunas mexidas aqui (situação, publicação, hash, versão da linha) não são do mapa: a conferência da carga e o
conflito do Sincronizar comparam só as colunas mapeadas, então a publicação não vira edição no destino.
"""
import hashlib

CONTA_LOGIN = "migracao"
CONTA_NOME = "Migração de dados (conector)"
CONTA_OBS = ("Conta de serviço da importação: publica os modelos de documento migrados (decisão 61). Inativa e sem "
             "credencial: não entra no sistema.")
BANCO_PERGUNTAS = "BANCO_PERGUNTAS_MIGRACAO"
NUMERO_ATUAL = 1000
TEXTO = "migração"
TEXTO_ATUALIZADA = "migração: versão atualizada pela origem"
AGORA = "UTC_TIMESTAMP(3)"
class ContaMigracaoOcupada(RuntimeError):
    """O login `migracao` existe e não é a conta de serviço da migração (nunca adotada)."""


TABELAS = ("usuario", "modelo_documento_clinico", "modelo_documento_versao", "modelo_documento_evento")


def hash_retrato(dados):
    """SHA-256 (hex, 64) do retrato gravado na versão; None vira o retrato vazio."""
    if isinstance(dados, (bytes, bytearray)):
        dados = bytes(dados).decode("utf-8")
    return hashlib.sha256(("" if dados is None else str(dados)).encode("utf-8")).hexdigest()


def _q(c, sql, args=()):
    c.execute(sql, args)
    return c.fetchall()


def _tem(c):
    n = _q(c, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (%s)"
           % ",".join(["%s"] * len(TABELAS)), TABELAS)[0][0]
    return n == len(TABELAS)


def conta_migracao(c):
    """(id, criada): a conta de serviço da migração, adotada pelo login ou criada agora."""
    r = _q(c, "SELECT id, tipo_conta, origem FROM usuario WHERE login = %s", (CONTA_LOGIN,))
    if r:
        if (r[0][1], r[0][2]) != ("servico", "migracao"):
            raise ContaMigracaoOcupada("o login da conta de migração pertence a outra conta")  # sem valor
        return int(r[0][0]), False
    c.execute("INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, situacao, observacao, origem, criado_em)"
              " VALUES (%%s, %%s, 1, 'servico', 'inativo', %%s, 'migracao', %s)" % AGORA,
              (CONTA_LOGIN, CONTA_NOME, CONTA_OBS))
    return int(c.lastrowid), True


def garantir_conta(conn):
    """Antes da carga do mapa: a conta de migração existe (o mapa a presume onde a origem não diz o usuário). Devolve
    só contagens; banco sem a tabela de usuários: nada."""
    try:
        with conn.cursor() as c:
            if not _q(c, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
                         " AND TABLE_NAME = 'usuario'")[0][0]:
                return {"pulado": "banco sem a tabela de usuários"}
            _, criada = conta_migracao(c)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"conta_criada": criada}


def _evento(c, versao_id, usuario, h, texto):
    c.execute("INSERT INTO modelo_documento_evento (modelo_documento_versao_id, tipo_evento, usuario_id, ocorrido_em,"
              " hash_definicao, texto, criado_em, criado_por) VALUES (%%s, 'publicado', %%s, %s, %%s, %%s, %s, %%s)"
              % (AGORA, AGORA), (versao_id, usuario, h, texto, usuario))


def _publicar(c, u, cont):
    linhas = _q(c, "SELECT m.id, m.versao, v.id, v.versao, v.dados FROM modelo_documento_clinico m"
                   " JOIN modelo_documento_versao v ON v.modelo_documento_clinico_id = m.id AND v.numero_versao = %s"
                   " WHERE m.origem = 'migracao' AND m.codigo <> %s AND m.excluido_em IS NULL"
                   " AND m.situacao = 'rascunho' AND m.publicada_modelo_documento_versao_id IS NULL"
                   " AND v.situacao = 'rascunho' ORDER BY m.id FOR UPDATE", (NUMERO_ATUAL, BANCO_PERGUNTAS))
    for mid, mver, vid, vver, dados in linhas:
        h = hash_retrato(dados)
        c.execute("UPDATE modelo_documento_versao SET situacao = 'publicada', publicada_em = %s,"
                  " publicacao_usuario_id = %%s, hash_definicao = %%s, alterado_em = %s, alterado_por = %%s,"
                  " versao = versao + 1 WHERE id = %%s AND versao = %%s" % (AGORA, AGORA), (u, h, u, vid, vver))
        if c.rowcount != 1:  # mudou entre a leitura e a gravação (outra sessão): fica para a próxima execução
            cont["concorrentes"] += 1
            continue
        c.execute("UPDATE modelo_documento_clinico SET situacao = 'publicado', publicada_modelo_documento_versao_id"
                  " = %%s, alterado_em = %s, alterado_por = %%s, versao = versao + 1 WHERE id = %%s AND versao = %%s"
                  % AGORA, (vid, u, mid, mver))
        if c.rowcount != 1:
            raise RuntimeError("modelo migrado mudou durante a publicação")  # desfaz a versão (rollback do chamador)
        _evento(c, vid, u, h, TEXTO)
        cont["publicados"] += 1


def _reselar(c, u, cont):
    linhas = _q(c, "SELECT v.id, v.versao, v.dados, v.hash_definicao FROM modelo_documento_clinico m"
                   " JOIN modelo_documento_versao v ON v.id = m.publicada_modelo_documento_versao_id"
                   " WHERE m.origem = 'migracao' AND m.situacao = 'publicado' AND v.numero_versao = %s"
                   " AND v.situacao = 'publicada' AND v.publicacao_usuario_id = %s ORDER BY v.id FOR UPDATE",
                (NUMERO_ATUAL, u))
    for vid, vver, dados, atual in linhas:
        h = hash_retrato(dados)
        if h == atual:
            cont["em_uso"] += 1
            continue
        c.execute("UPDATE modelo_documento_versao SET hash_definicao = %%s, alterado_em = %s, alterado_por = %%s,"
                  " versao = versao + 1 WHERE id = %%s AND versao = %%s" % AGORA, (h, u, vid, vver))
        if c.rowcount != 1:
            cont["concorrentes"] += 1
            continue
        _evento(c, vid, u, h, TEXTO_ATUALIZADA)
        cont["selo_atualizado"] += 1


def executar(conn, commit=True):
    """Toda a etapa numa transação; devolve só contagens."""
    cont = {"publicados": 0, "selo_atualizado": 0, "em_uso": 0, "concorrentes": 0, "conta_criada": False}
    try:
        with conn.cursor() as c:
            if not _tem(c):
                return {"pulado": "banco sem as tabelas do modelo de documento"}
            if not _q(c, "SELECT 1 FROM modelo_documento_clinico WHERE origem = 'migracao' AND codigo <> %s LIMIT 1",
                      (BANCO_PERGUNTAS,)):
                return {"pulado": "nenhum modelo migrado"}
            u, cont["conta_criada"] = conta_migracao(c)
            _reselar(c, u, cont)  # antes: os publicados agora já nascem com o hash do retrato atual
            _publicar(c, u, cont)
            cont["nao_publicados"] = int(_q(
                c, "SELECT COUNT(*) FROM modelo_documento_clinico WHERE origem = 'migracao' AND codigo <> %s"
                   " AND excluido_em IS NULL AND publicada_modelo_documento_versao_id IS NULL",
                (BANCO_PERGUNTAS,))[0][0])
        if commit:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    return cont
