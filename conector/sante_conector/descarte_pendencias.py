"""Descarte das pendências copiadas pelas continuações antigas (rodada pendencia-cadeia, 2026-11-24).

Até esta rodada a continuação copiava as pendências abertas da interrompida (`continuar.repetir_pendencias` com
`INSERT ... SELECT`): na ProntoCardio a execução 13 copiou 35.980.210 linhas da 11, e a 14 começou a copiar as da 13.
Agora a pendência fica na execução em que nasceu e todo leitor segue a cadeia (controle.cadeia) sem dupla contagem;
as cópias são só peso. Este descarte, para um cliente:

- lê a cadeia do controle (`conector_execucao_cadeia`; `migrar-controle <codigo>` a preenche antes);
- para cada execução continuada E, apaga APENAS a linha de E que é duplicata exata de uma linha de uma execução
  ANTERIOR da cadeia de E (mesmos tabela_origem, chave_original, regra, gravidade e detalhe); a linha que só existe
  em E nunca é tocada, e a execução mais antiga da cadeia (a que carregou) nunca perde nada;
- anda em janelas da chave primária (`lote` ids) com commit a cada janela;
- sem `executar`, só conta. Imprime (devolve) as contagens por execução antes e depois. Nunca lê valores: só ids e
  contagens.
"""
import sys

from . import controle

MESMA_EXATA = ("q.tabela_origem=p.tabela_origem AND q.regra=p.regra AND q.chave_original <=> p.chave_original"
               " AND q.gravidade=p.gravidade AND q.detalhe <=> p.detalhe")


def _contagens(conn, b, ids):
    if not ids:
        return {}
    with conn.cursor() as c:
        c.execute("SELECT execucao_id, COUNT(*) FROM %s.pendencia WHERE execucao_id IN (%s) GROUP BY execucao_id"
                  % (b, ",".join(str(x) for x in sorted(ids))))
        saida = {int(e): int(n) for e, n in c.fetchall()}
    return {e: saida.get(e, 0) for e in sorted(ids)}


def descartar(conn, ctl, executar=False, lote=50000, progresso=None):
    """Conta (e, com `executar`, apaga) as duplicatas exatas das continuações. `conn`: conexão com autocommit
    desligado e direito de DELETE no controle. Devolve {"modo", "cadeias", "antes", "duplicatas", "depois"}."""
    b = controle._b(ctl)
    with conn.cursor() as c:
        c.execute("SELECT execucao_id FROM %s.conector_execucao_cadeia ORDER BY execucao_id" % b)
        continuadas = [int(x[0]) for x in c.fetchall()]
    cadeias = {e: controle.cadeia(conn, ctl, e) for e in continuadas}
    todas = set()
    for cd in cadeias.values():
        todas.update(cd)
    antes = _contagens(conn, b, todas)
    dup = {}
    for e in continuadas:
        anteriores = ",".join(str(x) for x in cadeias[e][1:])
        with conn.cursor() as c:
            c.execute("SELECT MIN(id), MAX(id) FROM %s.pendencia WHERE execucao_id=%%s" % b, (e,))
            ini, fim = c.fetchone()
        n = 0
        if ini is not None:
            a = int(ini)
            while a <= int(fim):
                z = a + int(lote) - 1
                with conn.cursor() as c:
                    c.execute("SELECT p.id FROM %s.pendencia p WHERE p.id BETWEEN %%s AND %%s AND p.execucao_id=%%s"
                              " AND EXISTS (SELECT 1 FROM %s.pendencia q WHERE q.execucao_id IN (%s) AND %s)"
                              % (b, b, anteriores, MESMA_EXATA), (a, z, e))
                    ids = [int(x[0]) for x in c.fetchall()]
                    if ids and executar:
                        c.execute("DELETE FROM %s.pendencia WHERE execucao_id=%%s AND id IN (%s)"
                                  % (b, ",".join(str(x) for x in ids)), (e,))
                conn.commit()
                n += len(ids)
                if progresso:
                    progresso(e, z, n)
                a = z + 1
        dup[e] = n
    depois = _contagens(conn, b, todas) if executar else dict(antes)
    return {"modo": "executar" if executar else "contagem", "cadeias": {str(e): cd for e, cd in cadeias.items()},
            "antes": {str(e): n for e, n in antes.items()}, "duplicatas": {str(e): n for e, n in dup.items()},
            "depois": {str(e): n for e, n in depois.items()}}


def progresso_stderr(passo=2_000_000):
    marca = {"z": 0}

    def f(e, z, n):
        if z - marca["z"] >= passo:
            marca["z"] = z
            print("execução %d: até o id %d, %d duplicatas" % (e, z, n), file=sys.stderr, flush=True)
    return f
