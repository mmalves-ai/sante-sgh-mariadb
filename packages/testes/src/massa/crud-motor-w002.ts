// W0-02: a massa e as leituras da integração do motor do CRUD genérico na cópia (crud-motor-w002.int.spec.ts), SEMPRE
// na transação desfeita: as contagens que provam o ROLLBACK, a escolha dos itens reais (alergia com alergias de paciente,
// princípio só no histórico, par dieta × característica livre, um método do SADT), a leitura do retrato e do evento, e o
// "outro sistema" simulado da vigia de reconciliação (a exclusão feita por fora, DELETE direto, e o parâmetro ligado na
// transação). Saída só com códigos e contagens.
import type { DeclaracaoDominio } from '@sgh/contratos';
import type { Escritor, Leitor, Linha } from '@sgh/legado';

/** As contagens (e as conferências por chave) que a integração compara antes e depois do ROLLBACK. */
export const CONTAGENS_W002 = {
  alergias: 'SELECT COUNT(*) N FROM TBALERGIA',
  principios: 'SELECT COUNT(*) N FROM TBPRINC',
  situacoes: 'SELECT COUNT(*) N FROM CHSITUACAO',
  caracteristicasDieta: 'SELECT COUNT(*) N FROM PRCARACT_TBDIETAS',
  retratos: 'SELECT COUNT(*) N FROM SGH_HIST_EXCLUSAO',
  eventos: 'SELECT COUNT(*) N FROM SGH_CRUD_EVENTO',
  retratosVigia: 'SELECT COUNT(*) N FROM SGH_CRUD_VIGIA_RETRATO',
  achadosVigia: 'SELECT COUNT(*) N FROM SGH_CRUD_VIGIA_ACHADO',
  metodosTextoLongo: 'SELECT COUNT(*) N FROM SIMETODO WHERE DESCR IS NOT NULL AND CHAR_LENGTH(DESCR) > 65535',
  alergiaPorId: 'SELECT COUNT(*) N FROM TBALERGIA WHERE ID = ?',
  trilhaExclusaoAlergia:
    "SELECT COUNT(*) N FROM SGH_TRILHA WHERE OPERACAO = 'cadastro.excluirAlergia' AND ID_ALVO = ? AND USUARIO = 'SGH.TESTE.W002' AND HOSPITAL = ?",
  retratosSituacao: "SELECT COUNT(*) N FROM SGH_HIST_EXCLUSAO WHERE TABELA = 'CHSITUACAO'",
  situacao4: 'SELECT COUNT(*) N FROM CHSITUACAO WHERE ID = 4',
  eventosSituacao: "SELECT COUNT(*) N FROM SGH_CRUD_EVENTO WHERE TABELA = 'CHSITUACAO'",
  eventoReativacaoLimpeza:
    "SELECT COUNT(*) N FROM SGH_CRUD_EVENTO WHERE TABELA = 'CHTPLIMPEZA' AND CHAVE = ? AND EVENTO = 'reativado' AND MOTIVO = ?",
  caracteristicaDietaPar:
    'SELECT COUNT(*) N FROM PRCARACT_TBDIETAS WHERE ID_TBDIETAS = ? AND ID_PRCARACTDIE = ?',
  retratoCaracteristicaDieta:
    "SELECT COUNT(*) N FROM SGH_HIST_EXCLUSAO WHERE TABELA = 'PRCARACT_TBDIETAS' AND CHAVE = ?",
  caracteristicaPorId: 'SELECT COUNT(*) N FROM PRCARACTDIE WHERE ID_CARACTDIE = ?',
  retratoCaracteristica:
    "SELECT COUNT(*) N FROM SGH_HIST_EXCLUSAO WHERE TABELA = 'PRCARACTDIE' AND CHAVE = ?",
} as const;

const num = (v: unknown) => Number(v ?? NaN);

/** Uma alergia com alergias de paciente (FK PRALERGIAPAC.ID_TBALERGIA). */
export async function alergiaDePaciente(l: Leitor): Promise<string> {
  const [x] = await l.consultar(
    'SELECT FIRST 1 a.ID FROM TBALERGIA a WHERE EXISTS (SELECT 1 FROM PRALERGIAPAC p WHERE p.ID_TBALERGIA = a.ID) ORDER BY a.ID',
    [],
    { teto: 1 },
  );
  return String(num(x?.['ID']));
}

/** Os princípios ativos com histórico (HTPRINC.ID_TBPRINC, vínculo só por código). */
export async function principiosNoHistorico(l: Leitor): Promise<number[]> {
  return (await l.consultar('SELECT DISTINCT ID_TBPRINC C FROM HTPRINC ORDER BY 1', [], { teto: 500 })).map(
    (x) => num(x['C']),
  );
}

export async function linhaDoPrincipio(l: Leitor, cod: number): Promise<Linha | undefined> {
  const [x] = await l.consultar('SELECT * FROM TBPRINC WHERE COD = ?', [cod], { teto: 1 });
  return x;
}

/** O retrato (SGH_HIST_EXCLUSAO) e o evento (SGH_CRUD_EVENTO) da exclusão de uma linha, lidos na transação. */
export async function retratoEEventoDaExclusao(e: Escritor, hospital: string, tabela: string, chave: string) {
  const [hist] = await e.consultar(
    'SELECT OPERACAO, MOTIVO, EXCLUIDO_POR, LINHA FROM SGH_HIST_EXCLUSAO WHERE TABELA = ? AND CHAVE = ? AND HOSPITAL = ?',
    [tabela, chave, hospital],
    { teto: 1 },
  );
  const linha = hist ? JSON.parse((await e.lerBlob(hist['LINHA'])).toString('ascii')) : null;
  const [ev] = await e.consultar(
    'SELECT EVENTO, MOTIVO, CRIADO_POR, VALOR_ANTERIOR FROM SGH_CRUD_EVENTO WHERE TABELA = ? AND CHAVE = ? AND HOSPITAL = ?',
    [tabela, chave, hospital],
    { teto: 1 },
  );
  const valorAnterior = ev ? JSON.parse((await e.lerBlob(ev['VALOR_ANTERIOR'])).toString('ascii')) : null;
  return { hist, linha, ev, valorAnterior };
}

export async function situacaoDoTipoLimpeza(l: Leitor, cod: string): Promise<string> {
  const [x] = await l.consultar('SELECT ATIVO FROM CHTPLIMPEZA WHERE ID = ?', [Number(cod)], { teto: 1 });
  return String(x?.['ATIVO'] ?? '').trim();
}

/** Um par (dieta, característica ativa) ainda sem ligação na tabela composta. */
export async function parDietaCaracteristicaLivre(
  l: Leitor,
  dieta: DeclaracaoDominio,
  carac: DeclaracaoDominio,
): Promise<{ dieta: number; caracteristica: number }> {
  const [par] = await l.consultar(
    `SELECT FIRST 1 d.${dieta.chave} D, c.${carac.chave} C FROM ${dieta.tabela} d CROSS JOIN ${carac.tabela} c
      WHERE NOT EXISTS (SELECT 1 FROM PRCARACT_TBDIETAS x WHERE x.ID_TBDIETAS = d.${dieta.chave} AND x.ID_PRCARACTDIE = c.${carac.chave})
        AND COALESCE(c.ATIVO, 'T') = 'T' ORDER BY 1, 2`,
    [],
    { teto: 1 },
  );
  return { dieta: num(par?.['D']), caracteristica: num(par?.['C']) };
}

export async function primeiroMetodo(l: Leitor): Promise<string> {
  const [m] = await l.consultar('SELECT FIRST 1 COD FROM SIMETODO ORDER BY COD', [], { teto: 1 });
  return String(num(m?.['COD']));
}

/** Os bytes do texto longo do método (BLOB de texto), relidos na transação. */
export async function textoDoMetodo(l: Leitor, cod: string): Promise<Buffer> {
  const [x] = await l.consultar('SELECT DESCR FROM SIMETODO WHERE COD = ?', [Number(cod)], { teto: 1 });
  return l.lerBlob(x?.['DESCR']);
}

/** Liga a vigia de reconciliação no estabelecimento, SÓ na transação desfeita (o parâmetro some no ROLLBACK). */
export async function ligarVigiaNaTransacao(e: Escritor, rede: string, hospital: string): Promise<void> {
  await e.executar(
    `INSERT INTO SGH_CFG_PARAMETRO (ID, CHAVE, NIVEL, ALVO, REDE, HOSPITAL, VALOR, VIGENTE_DESDE, JUSTIFICATIVA, AUTOR)
     VALUES (NEXT VALUE FOR SGH_GEN_CFG_PARAMETRO, 'crud.vigiaReconciliacao', 'estabelecimento', ?, ?, ?, 'sim',
             CURRENT_TIMESTAMP - 1, ?, 'SGH.TESTE.W002')`,
    [hospital, rede, hospital, 'teste W0-02 (transação desfeita)'],
  );
}

/** O "outro sistema" simulado: apaga o tipo de limpeza por fora do Sante (DELETE direto), na transação desfeita. */
export async function excluirTipoLimpezaPorFora(e: Escritor, cod: string): Promise<void> {
  await e.executar('DELETE FROM CHTPLIMPEZA WHERE ID = ?', [Number(cod)]);
}

/** O registro do evento de uma exclusão feita pelo Sante (a vigia a reconhece), na transação desfeita. */
export async function registrarExclusaoPeloSante(
  e: Escritor,
  hospital: string,
  tabela: string,
  chave: string,
): Promise<void> {
  await e.executar(
    `INSERT INTO SGH_CRUD_EVENTO (ID, HOSPITAL, OPERACAO, RECURSO, EVENTO, TABELA, CHAVE, MOTIVO, IDEMPOTENCIA, CRIADO_POR)
     VALUES (NEXT VALUE FOR SGH_GEN_CRUD_EVENTO, ?, 'internacao.excluirTipoLimpeza', 'internacao.tipoLimpeza', 'excluido',
             ?, ?, 'teste W0-02', 'w002-vigia', 'SGH.TESTE.W002')`,
    [hospital, tabela, chave],
  );
}

/** Rodada 2: uma característica de dieta lançada em prescrição (FK PRCARACTLAN.ID_PRCARACTDIE). */
export async function caracteristicaLancada(l: Leitor): Promise<string> {
  const [x] = await l.consultar(
    'SELECT FIRST 1 c.ID_CARACTDIE ID FROM PRCARACTDIE c WHERE EXISTS (SELECT 1 FROM PRCARACTLAN k WHERE k.ID_PRCARACTDIE = c.ID_CARACTDIE) ORDER BY c.ID_CARACTDIE',
    [],
    { teto: 1 },
  );
  if (!x) throw new Error('Nenhuma característica de dieta lançada na cópia.');
  return String(num(x['ID']));
}

/** Rodada 2: os bytes das respostas possíveis da característica (BLOB de texto), para conferir a releitura. */
export async function respostasDaCaracteristica(l: Leitor, cod: string): Promise<Buffer> {
  const [x] = await l.consultar(
    'SELECT POSSIVEIS_RESPOSTAS T FROM PRCARACTDIE WHERE ID_CARACTDIE = ?',
    [Number(cod)],
    { teto: 1 },
  );
  return l.lerBlob(x?.['T']);
}

/** Revisão do W0-02: as marcas de inativação só no novo de uma chave (SGH_CFG_DOMINIO_SITUACAO), na transação. */
export async function marcasNoNovo(l: Leitor, tabela: string, chave: string): Promise<number> {
  const [x] = await l.consultar(
    'SELECT COUNT(*) N FROM SGH_CFG_DOMINIO_SITUACAO WHERE TABELA = ? AND CHAVE = ?',
    [tabela, chave],
    { teto: 1 },
  );
  return Number(x?.['N'] ?? 0);
}

/** Revisão do W0-02: o último evento de um tipo (motivo e valor anterior) de uma linha, lido na transação. */
export async function ultimoEvento(
  e: Escritor,
  hospital: string,
  tabela: string,
  chave: string,
  evento: string,
): Promise<{ motivo: string; valorAnterior: Record<string, unknown> | null } | null> {
  const [ev] = await e.consultar(
    'SELECT FIRST 1 MOTIVO, VALOR_ANTERIOR FROM SGH_CRUD_EVENTO WHERE TABELA = ? AND CHAVE = ? AND HOSPITAL = ? AND EVENTO = ? ORDER BY ID DESC',
    [tabela, chave, hospital, evento],
    { teto: 1 },
  );
  if (!ev) return null;
  const bruto = ev['VALOR_ANTERIOR'];
  return {
    motivo: String(ev['MOTIVO'] ?? '').trim(),
    valorAnterior:
      bruto === null || bruto === undefined
        ? null
        : (JSON.parse((await e.lerBlob(bruto)).toString('ascii')) as Record<string, unknown>),
  };
}
