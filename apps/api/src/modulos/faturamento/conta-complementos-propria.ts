// Complementos da conta e da guia sobre o banco do cliente (F3.7, 06-FAT linhas 10 e 12). Leituras pelo Leitor e
// gravações pelo Executor (trilha, autoria e idempotência na mesma transação). As regras são do
// @sgh/dominio-faturamento (conta/complementos): aqui só se lê, confere pelo domínio e grava.
// - Linha 12: período da conta parcial (conta_hospitalar_periodo) e dados do segurado na conta
//   (conta_hospitalar_segurado, sugeridos da cobertura do paciente). Nada se apaga: o período retirado e o segurado
//   substituído ficam marcados como excluídos, com autor e data.
// - Linha 10: campo adicional da operadora na guia (atributo_guia_fonte_pagadora e atributo_guia_opcao) e o valor
//   informado numa guia (valor_atributo_guia), conferido pelo tipo e com os obrigatórios que faltam.
import {
  atributosDaGuia,
  contaEditavel,
  type DefinicaoAtributoGuia,
  dependentesAtivos,
  guiaAceitaAtributos,
  observacaoDosAtributos,
  type PeriodoConta,
  sugerirProximoPeriodo,
  type TipoDadoAtributo,
  validarDefinicaoAtributo,
  validarOpcoesAtributo,
  validarPeriodoConta,
  validarRetiradaPeriodo,
  validarSeguradoConta,
  validarValoresAtributos,
} from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'>;

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txn = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const p2 = (x: number, t = 2) => String(x).padStart(t, '0');
/** DATETIME do banco para texto ISO sem fuso (o relógio do hospital). */
export function dataHora(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}T${p2(v.getHours())}:${p2(v.getMinutes())}:${p2(v.getSeconds())}.${p2(v.getMilliseconds(), 3)}`;
  const s = String(v).replace(' ', 'T');
  return s.length === 19 ? `${s}.000` : s;
}
const dataIso = (v: unknown) => dataHora(v)?.slice(0, 10) ?? null;
/** Texto ISO para o DATETIME do banco. */
const paraBanco = (iso: string) => iso.replace('T', ' ').replace(/Z$/, '').slice(0, 23);

function exigirValido(erros: Record<string, string>) {
  const campos = Object.keys(erros);
  if (campos.length) throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos });
}
function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}
async function existe(tx: TxOperacao, tabela: string, valor: number | null, campo: string) {
  if (valor === null) return;
  if (!(await tx.uma(`SELECT id FROM ${tabela} WHERE id = ?`, [valor])))
    throw recusa('referencia-inexistente', `O registro informado em ${campo} não existe.`, {
      campos: [campo],
    });
}

// ── Conta ─────────────────────────────────────────────────────────────────────────────────────────

interface ContaLida {
  id: number;
  situacao: string;
  inicio: string;
  fim: string | null;
  pacienteId: number;
  fontePagadoraId: number;
  coberturaId: number | null;
}

async function contaDo(l: Consulta, est: number, conta: number): Promise<ContaLida> {
  const r = await l.uma<Linha>(
    `SELECT id, situacao, inicio_em, fim_em, paciente_id, fonte_pagadora_id, cobertura_paciente_id
       FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [conta, est],
  );
  if (!r)
    throw recusa('nao-encontrado', 'A conta não existe neste estabelecimento.', { campos: ['contaId'] });
  return {
    id: n(r['id']),
    situacao: String(r['situacao']),
    inicio: dataHora(r['inicio_em']) ?? '',
    fim: dataHora(r['fim_em']),
    pacienteId: n(r['paciente_id']),
    fontePagadoraId: n(r['fonte_pagadora_id']),
    coberturaId: nn(r['cobertura_paciente_id']),
  };
}

export interface PeriodoLido extends PeriodoConta {
  id: number;
  sequencia: number;
  competencia: string;
  tipoLancamento: string | null;
  versao: number;
}

async function periodosDa(l: Consulta, conta: number): Promise<PeriodoLido[]> {
  const ls = await l.consultar<Linha>(
    `SELECT p.id, p.sequencia, p.inicio_em, p.fim_em, p.competencia, p.tipo_lancamento_id, p.versao,
            t.descricao AS tipo_lancamento
       FROM conta_hospitalar_periodo p LEFT JOIN tipo_lancamento t ON t.id = p.tipo_lancamento_id
      WHERE p.conta_hospitalar_id = ? AND p.excluido_em IS NULL ORDER BY p.inicio_em, p.sequencia`,
    [conta],
  );
  return ls.map((r) => ({
    id: n(r['id']),
    sequencia: n(r['sequencia']),
    inicio: dataHora(r['inicio_em']) ?? '',
    fim: dataHora(r['fim_em']) ?? '',
    competencia: dataIso(r['competencia']) ?? '',
    tipoLancamentoId: nn(r['tipo_lancamento_id']),
    tipoLancamento: txn(r['tipo_lancamento']),
    versao: n(r['versao']),
  }));
}

/** Os períodos da conta e a sugestão do próximo (um clique para aceitar). */
export async function periodosContaPropria(l: Leitor, est: number, conta: number) {
  const c = await contaDo(l, est, conta);
  const periodos = await periodosDa(l, conta);
  return {
    contaId: c.id,
    situacao: c.situacao,
    editavel: contaEditavel(c.situacao),
    inicioConta: c.inicio,
    fimConta: c.fim,
    periodos,
    sugestao: contaEditavel(c.situacao) ? sugerirProximoPeriodo(c, periodos) : null,
  };
}

export interface SeguradoLido {
  id: number | null;
  sequencia: number | null;
  coberturaPacienteId: number | null;
  titularCoberturaId: number | null;
  numeroCarteira: string;
  validadeCarteira: string | null;
  matriculaFuncional: string | null;
  cargo: string | null;
  padraoFuncional: string | null;
  classeFuncional: string | null;
  unidadeAdministrativa: string | null;
  parentescoTitular: string | null;
  numeroOrdem: string | null;
  versao: number | null;
}

const vazioSegurado = (): Omit<
  SeguradoLido,
  'numeroCarteira' | 'validadeCarteira' | 'coberturaPacienteId'
> => ({
  id: null,
  sequencia: null,
  titularCoberturaId: null,
  matriculaFuncional: null,
  cargo: null,
  padraoFuncional: null,
  classeFuncional: null,
  unidadeAdministrativa: null,
  parentescoTitular: null,
  numeroOrdem: null,
  versao: null,
});

/** O segurado gravado na conta; sem ele, a sugestão tirada da cobertura do paciente usada na conta. */
export async function seguradoContaPropria(l: Leitor, est: number, conta: number) {
  const c = await contaDo(l, est, conta);
  const r = await l.uma<Linha>(
    `SELECT * FROM conta_hospitalar_segurado WHERE conta_hospitalar_id = ? AND excluido_em IS NULL
      ORDER BY sequencia DESC LIMIT 1`,
    [conta],
  );
  const substituidos = n(
    (
      await l.uma<Linha>(
        'SELECT COUNT(*) AS n FROM conta_hospitalar_segurado WHERE conta_hospitalar_id = ? AND excluido_em IS NOT NULL',
        [conta],
      )
    )?.['n'],
  );
  if (r)
    return {
      contaId: c.id,
      editavel: contaEditavel(c.situacao),
      gravado: true,
      substituidos,
      segurado: {
        id: n(r['id']),
        sequencia: n(r['sequencia']),
        coberturaPacienteId: nn(r['cobertura_paciente_id']),
        titularCoberturaId: nn(r['titular_cobertura_id']),
        numeroCarteira: String(r['numero_carteira']),
        validadeCarteira: dataIso(r['validade_carteira']),
        matriculaFuncional: txn(r['matricula_funcional']),
        cargo: txn(r['cargo']),
        padraoFuncional: txn(r['padrao_funcional']),
        classeFuncional: txn(r['classe_funcional']),
        unidadeAdministrativa: txn(r['unidade_administrativa']),
        parentescoTitular: txn(r['parentesco_titular']),
        numeroOrdem: txn(r['numero_ordem']),
        versao: n(r['versao']),
      } satisfies SeguradoLido,
    };
  // Sugestão: a cobertura da conta ou, sem ela, a principal vigente do paciente na mesma fonte pagadora.
  const cob = await l.uma<Linha>(
    `SELECT id, numero_carteira, validade, matricula_titular, titular FROM cobertura_paciente
      WHERE excluido_em IS NULL AND (id = ? OR (? IS NULL AND paciente_id = ? AND fonte_pagadora_id = ?))
      ORDER BY (id = ?) DESC, principal DESC, vigencia_inicio DESC LIMIT 1`,
    [c.coberturaId, c.coberturaId, c.pacienteId, c.fontePagadoraId, c.coberturaId ?? 0],
  );
  const titular = cob
    ? await l.uma<Linha>('SELECT id FROM titular_cobertura WHERE cobertura_paciente_id = ? LIMIT 1', [
        cob['id'],
      ])
    : null;
  return {
    contaId: c.id,
    editavel: contaEditavel(c.situacao),
    gravado: false,
    substituidos,
    segurado: {
      ...vazioSegurado(),
      coberturaPacienteId: cob ? n(cob['id']) : null,
      titularCoberturaId: titular ? n(titular['id']) : null,
      numeroCarteira: cob ? (txn(cob['numero_carteira']) ?? '') : '',
      validadeCarteira: cob ? dataIso(cob['validade']) : null,
      matriculaFuncional: cob ? txn(cob['matricula_titular']) : null,
      parentescoTitular: cob && n(cob['titular']) === 1 ? 'titular' : null,
    } satisfies SeguradoLido,
  };
}

// ── Campo adicional da operadora ─────────────────────────────────────────────────────────────────

/** Os campos adicionais da operadora, com as opções (inclui os inativos, marcados). */
export async function atributosFontePropria(l: Consulta, fonte: number): Promise<DefinicaoAtributoGuia[]> {
  const ds = await l.consultar<Linha>(
    `SELECT id, codigo, rotulo, tipo_dado, tipo_guia, obrigatorio, tamanho_maximo,
            depende_atributo_guia_fonte_pagadora_id AS depende, ativo, ordem, versao
       FROM atributo_guia_fonte_pagadora WHERE fonte_pagadora_id = ? ORDER BY ordem, id`,
    [fonte],
  );
  const ids = ds.map((d) => n(d['id']));
  const os = ids.length
    ? await l.consultar<Linha>(
        `SELECT id, atributo_guia_fonte_pagadora_id AS atributo, codigo, descricao, ativo, opcao_pai_id, valor_envio,
                versao
           FROM atributo_guia_opcao WHERE atributo_guia_fonte_pagadora_id IN (${ids.map(() => '?').join(', ')})
          ORDER BY ordem, id`,
        ids,
      )
    : [];
  return ds.map((d) => ({
    id: n(d['id']),
    codigo: String(d['codigo']),
    rotulo: String(d['rotulo']),
    tipoDado: String(d['tipo_dado']) as TipoDadoAtributo,
    tipoGuia: txn(d['tipo_guia']),
    obrigatorio: n(d['obrigatorio']) === 1,
    tamanhoMaximo: nn(d['tamanho_maximo']),
    dependeDeId: nn(d['depende']),
    ativo: n(d['ativo']) === 1,
    ordem: n(d['ordem']),
    versao: n(d['versao']),
    opcoes: os
      .filter((o) => n(o['atributo']) === n(d['id']))
      .map((o) => ({
        id: n(o['id']),
        codigo: String(o['codigo']),
        descricao: String(o['descricao']),
        ativo: n(o['ativo']) === 1,
        opcaoPaiId: nn(o['opcao_pai_id']),
        valorEnvio: txn(o['valor_envio']),
        versao: n(o['versao']),
      })),
  }));
}

async function guiaDa(l: Consulta, est: number, guia: number) {
  const g = await l.uma<Linha>(
    `SELECT id, tipo_guia, situacao, fonte_pagadora_id, conta_hospitalar_id, numero_guia_prestador
       FROM guia_tiss WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [guia, est],
  );
  if (!g) throw recusa('nao-encontrado', 'A guia não existe neste estabelecimento.', { campos: ['guiaId'] });
  return {
    id: n(g['id']),
    tipoGuia: String(g['tipo_guia']),
    situacao: String(g['situacao']),
    fontePagadoraId: n(g['fonte_pagadora_id']),
    contaId: n(g['conta_hospitalar_id']),
    numero: String(g['numero_guia_prestador']),
  };
}

/** Os campos que valem para a guia, os valores informados e os obrigatórios que faltam. */
export async function atributosGuiaPropria(l: Leitor, est: number, guia: number) {
  const g = await guiaDa(l, est, guia);
  const defs = atributosDaGuia(await atributosFontePropria(l, g.fontePagadoraId), g.tipoGuia);
  const vs = await l.consultar<Linha>(
    `SELECT atributo_guia_fonte_pagadora_id AS atributo, atributo_guia_opcao_id AS opcao, valor_texto
       FROM valor_atributo_guia WHERE guia_tiss_id = ? AND excluido_em IS NULL`,
    [guia],
  );
  const valores = vs.map((v) => ({
    atributoId: n(v['atributo']),
    opcaoId: nn(v['opcao']),
    texto: txn(v['valor_texto']),
  }));
  const { faltam } = validarValoresAtributos(defs, valores);
  return { guia: g, editavel: guiaAceitaAtributos(g.situacao), campos: defs, valores, faltam };
}

/**
 * As guias TISS da conta com os obrigatórios da operadora que faltam em cada uma (visão por conta: o faturista vê de
 * uma vez qual guia ainda não pode ir para o lote e abre a guia num clique).
 */
export async function guiasAtributosContaPropria(l: Consulta, est: number, conta: number) {
  const c = await contaDo(l, est, conta);
  const gs = await l.consultar<Linha>(
    `SELECT id, tipo_guia, situacao, fonte_pagadora_id, numero_guia_prestador FROM guia_tiss
      WHERE conta_hospitalar_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL ORDER BY id`,
    [c.id, est],
  );
  const ids = gs.map((g) => n(g['id']));
  const vs = ids.length
    ? await l.consultar<Linha>(
        `SELECT guia_tiss_id AS guia, atributo_guia_fonte_pagadora_id AS atributo, atributo_guia_opcao_id AS opcao,
                valor_texto FROM valor_atributo_guia
          WHERE guia_tiss_id IN (${ids.map(() => '?').join(', ')}) AND excluido_em IS NULL`,
        ids,
      )
    : [];
  const defsPorFonte = new Map<number, DefinicaoAtributoGuia[]>();
  const guias = [];
  for (const g of gs) {
    const fonte = n(g['fonte_pagadora_id']);
    if (!defsPorFonte.has(fonte)) defsPorFonte.set(fonte, await atributosFontePropria(l, fonte));
    const defs = atributosDaGuia(defsPorFonte.get(fonte) ?? [], String(g['tipo_guia']));
    const valores = vs
      .filter((v) => n(v['guia']) === n(g['id']))
      .map((v) => ({ atributoId: n(v['atributo']), opcaoId: nn(v['opcao']), texto: txn(v['valor_texto']) }));
    guias.push({
      id: n(g['id']),
      numero: String(g['numero_guia_prestador']),
      tipoGuia: String(g['tipo_guia']),
      situacao: String(g['situacao']),
      fontePagadoraId: fonte,
      campos: defs.length,
      faltam: validarValoresAtributos(defs, valores).faltam,
    });
  }
  return { contaId: c.id, fontePagadoraId: c.fontePagadoraId, guias };
}

/**
 * As guias da conta de um tipo (as não canceladas) com os obrigatórios da operadora que faltam: o lote TISS
 * (faturamento.gerar-lote) recusa a conta pela regra recusaObrigatoriosPendentes do domínio. Lido sob a transação.
 */
export async function obrigatoriosPendentesDaConta(
  l: Consulta,
  est: number,
  conta: number,
  tipoGuia: string,
) {
  const r = await guiasAtributosContaPropria(l, est, conta);
  return r.guias
    .filter((g) => g.tipoGuia === tipoGuia && g.situacao !== 'cancelada')
    .map((g) => ({ numero: g.numero, faltam: g.faltam }));
}

/**
 * O texto que os campos adicionais da operadora informados na guia levam à observação da guia TISS (06-FAT linha 10):
 * só os campos que valem para a guia, com o código de envio da opção (regra observacaoDosAtributos do domínio). O valor
 * de campo inativado fica guardado, mas não vai à operadora. Lido sob a transação do lote.
 */
export async function observacaoDaGuiaPropria(l: Consulta, est: number, guia: number) {
  const g = await guiaDa(l, est, guia);
  const defs = atributosDaGuia(await atributosFontePropria(l, g.fontePagadoraId), g.tipoGuia);
  if (!defs.length) return { numero: g.numero, texto: null, excede: false, erros: [] as string[] };
  const vs = await l.consultar<Linha>(
    `SELECT atributo_guia_fonte_pagadora_id AS atributo, atributo_guia_opcao_id AS opcao, valor_texto
       FROM valor_atributo_guia WHERE guia_tiss_id = ? AND excluido_em IS NULL`,
    [guia],
  );
  const valores = vs.map((v) => ({
    atributoId: n(v['atributo']),
    opcaoId: nn(v['opcao']),
    texto: txn(v['valor_texto']),
  }));
  return { numero: g.numero, ...observacaoDosAtributos(defs, valores) };
}

/** A carteira do segurado gravada na conta (a mais recente não substituída); sem ela, null (vale a da cobertura). */
export async function carteiraDoSeguradoDaConta(l: Consulta, conta: number): Promise<string | null> {
  const r = await l.uma<Linha>(
    `SELECT numero_carteira FROM conta_hospitalar_segurado WHERE conta_hospitalar_id = ? AND excluido_em IS NULL
      ORDER BY sequencia DESC LIMIT 1`,
    [conta],
  );
  return txn(r?.['numero_carteira']);
}

// ── Gravações ──────────────────────────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const idN = id.nullable().default(null);
const dataHoraZ = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
const textoN = (max: number) => z.string().trim().max(max).nullable().default(null);

export const esquemaPeriodo = z.object({
  contaId: id,
  inicio: dataHoraZ,
  fim: dataHoraZ,
  competencia: z.string().nullable().default(null),
  tipoLancamentoId: idN,
});

export const opIncluirPeriodo = definirOperacao({
  nome: 'faturamento.incluir-periodo-conta',
  tabelas: ['conta_hospitalar_periodo'],
  entrada: esquemaPeriodo,
  async gravar(tx, e, ctx) {
    const c = await contaDo(tx, estDe(ctx), e.contaId);
    // Trava a conta contra dois períodos simultâneos que se sobreporiam.
    await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ?', [c.id]);
    await existe(tx, 'tipo_lancamento', e.tipoLancamentoId, 'tipoLancamentoId');
    const existentes = await periodosDa(tx, c.id);
    const { erros, competencia } = validarPeriodoConta(c, existentes, e);
    exigirValido(erros);
    const seq = n(
      (
        await tx.uma<Linha>(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM conta_hospitalar_periodo WHERE conta_hospitalar_id = ?',
          [c.id],
        )
      )?.['s'],
    );
    const novo = await tx.incluir('conta_hospitalar_periodo', {
      conta_hospitalar_id: c.id,
      sequencia: seq,
      inicio_em: paraBanco(e.inicio),
      fim_em: paraBanco(e.fim),
      competencia,
      tipo_lancamento_id: e.tipoLancamentoId,
    });
    return { id: novo, sequencia: seq, competencia };
  },
  alvo: (_e, s) => ({ tabela: 'conta_hospitalar_periodo', id: s.id }),
});

export const esquemaRetirarPeriodo = z.object({
  id,
  versao: z.number().int().positive(),
  motivo: z.string().trim().min(5, 'Informe o motivo (ao menos 5 letras).').max(300),
});

export const opRetirarPeriodo = definirOperacao({
  nome: 'faturamento.retirar-periodo-conta',
  tabelas: ['conta_hospitalar_periodo'],
  entrada: esquemaRetirarPeriodo,
  async gravar(tx, e, ctx) {
    const p = await tx.uma<Linha>(
      'SELECT conta_hospitalar_id, fechado_em FROM conta_hospitalar_periodo WHERE id = ? AND excluido_em IS NULL',
      [e.id],
    );
    if (!p) throw recusa('nao-encontrado', 'O período não existe.', { campos: ['id'] });
    const c = await contaDo(tx, estDe(ctx), n(p['conta_hospitalar_id']));
    // O período fechado (faturado em separado) não sai: reabra-o antes.
    exigirValido(
      validarRetiradaPeriodo({ fechado: p['fechado_em'] !== null && p['fechado_em'] !== undefined }),
    );
    if (!contaEditavel(c.situacao))
      throw recusa('conta-fechada', 'A conta não está aberta: reabra-a para mudar os períodos.', {
        campos: [],
      });
    // Nada se apaga: o período retirado fica marcado (autor e data), com o motivo na trilha.
    await tx.alterar('conta_hospitalar_periodo', e.id, e.versao, {
      excluido_em: new Date(),
      excluido_por: ctx.usuario,
    });
    return { id: e.id };
  },
  alvo: (e) => ({ tabela: 'conta_hospitalar_periodo', id: e.id }),
  trilha: (e) => ({ motivo: e.motivo }),
});

export const esquemaSegurado = z.object({
  contaId: id,
  versao: z.number().int().positive().nullable().default(null),
  coberturaPacienteId: idN,
  titularCoberturaId: idN,
  numeroCarteira: z.string().trim().max(40),
  validadeCarteira: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  matriculaFuncional: textoN(30),
  cargo: textoN(60),
  padraoFuncional: textoN(20),
  classeFuncional: textoN(20),
  unidadeAdministrativa: textoN(100),
  parentescoTitular: textoN(30),
  numeroOrdem: textoN(10),
});

/**
 * Grava o segurado da conta. Mudou a carteira (ou a cobertura): o anterior fica marcado como excluído e entra um novo
 * na sequência seguinte (histórico preservado). Mesma carteira: altera os demais dados na mesma linha.
 */
export const opGravarSegurado = definirOperacao({
  nome: 'faturamento.gravar-segurado-conta',
  tabelas: ['conta_hospitalar_segurado'],
  entrada: esquemaSegurado,
  async gravar(tx, e, ctx) {
    const c = await contaDo(tx, estDe(ctx), e.contaId);
    const v = validarSeguradoConta(c.situacao, c.inicio, e);
    exigirValido(v.erros);
    if (e.coberturaPacienteId !== null) {
      const cob = await tx.uma<Linha>(
        'SELECT paciente_id, fonte_pagadora_id, excluido_em FROM cobertura_paciente WHERE id = ?',
        [e.coberturaPacienteId],
      );
      if (!cob || n(cob['paciente_id']) !== c.pacienteId)
        throw recusa('referencia-inexistente', 'A cobertura informada não é do paciente da conta.', {
          campos: ['coberturaPacienteId'],
        });
      if (cob['excluido_em'] !== null)
        throw recusa('entrada-invalida', 'A cobertura informada foi excluída do cadastro do paciente.', {
          campos: ['coberturaPacienteId'],
        });
      if (n(cob['fonte_pagadora_id']) !== c.fontePagadoraId)
        throw recusa(
          'entrada-invalida',
          'A cobertura informada é de outra fonte pagadora que não a da conta.',
          {
            campos: ['coberturaPacienteId'],
          },
        );
    }
    if (e.titularCoberturaId !== null) {
      // O titular tem de ser de uma cobertura (não excluída) do próprio paciente da conta, e da escolhida quando há.
      const t = await tx.uma<Linha>(
        `SELECT t.cobertura_paciente_id, c.paciente_id FROM titular_cobertura t
           JOIN cobertura_paciente c ON c.id = t.cobertura_paciente_id AND c.excluido_em IS NULL
          WHERE t.id = ?`,
        [e.titularCoberturaId],
      );
      if (
        !t ||
        n(t['paciente_id']) !== c.pacienteId ||
        (e.coberturaPacienteId !== null && n(t['cobertura_paciente_id']) !== e.coberturaPacienteId)
      )
        throw recusa('referencia-inexistente', 'O titular informado não é da cobertura escolhida.', {
          campos: ['titularCoberturaId'],
        });
    }
    const valores = {
      cobertura_paciente_id: e.coberturaPacienteId,
      titular_cobertura_id: e.titularCoberturaId,
      numero_carteira: e.numeroCarteira,
      validade_carteira: e.validadeCarteira,
      matricula_funcional: e.matriculaFuncional,
      cargo: e.cargo,
      padrao_funcional: e.padraoFuncional,
      classe_funcional: e.classeFuncional,
      unidade_administrativa: e.unidadeAdministrativa,
      parentesco_titular: e.parentescoTitular,
      numero_ordem: e.numeroOrdem,
    };
    const atual = await tx.consultarParaAtualizar(
      `SELECT id, versao, numero_carteira, cobertura_paciente_id FROM conta_hospitalar_segurado
        WHERE conta_hospitalar_id = ? AND excluido_em IS NULL ORDER BY sequencia DESC LIMIT 1`,
      [c.id],
    );
    const a = atual[0];
    if (a) {
      if (e.versao === null)
        throw recusa('conflito-versao', 'Os dados do segurado mudaram: recarregue a conta.', { campos: [] });
      const mesma =
        String(a['numero_carteira']) === e.numeroCarteira &&
        nn(a['cobertura_paciente_id']) === e.coberturaPacienteId;
      if (mesma) {
        const versao = await tx.alterar('conta_hospitalar_segurado', n(a['id']), e.versao, valores);
        return { id: n(a['id']), versao, substituido: null, alertas: v.alertas.join(' ') };
      }
      // O segurado substituído fica marcado (autor e data), nunca apagado.
      await tx.alterar('conta_hospitalar_segurado', n(a['id']), e.versao, {
        excluido_em: new Date(),
        excluido_por: ctx.usuario,
      });
    }
    const seq = n(
      (
        await tx.uma<Linha>(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM conta_hospitalar_segurado WHERE conta_hospitalar_id = ?',
          [c.id],
        )
      )?.['s'],
    );
    const novo = await tx.incluir('conta_hospitalar_segurado', {
      conta_hospitalar_id: c.id,
      sequencia: seq,
      ...valores,
    });
    return { id: novo, versao: 1, substituido: a ? n(a['id']) : null, alertas: v.alertas.join(' ') };
  },
  alvo: (_e, s) => ({ tabela: 'conta_hospitalar_segurado', id: s.id }),
});

export const esquemaAtributo = z.object({
  id: idN,
  versao: z.number().int().positive().nullable().default(null),
  fontePagadoraId: id,
  codigo: z.string().trim().max(30),
  rotulo: z.string().trim().max(150),
  tipoDado: z.string(),
  tipoGuia: z.string().nullable().default(null),
  obrigatorio: z.boolean().default(false),
  tamanhoMaximo: z.number().int().nullable().default(null),
  dependeDeId: idN,
  ordem: z.number().int().min(0).max(999).default(0),
  ativo: z.boolean().default(true),
  opcoes: z
    .array(
      z.object({
        id: idN,
        versao: z.number().int().positive().nullable().default(null),
        codigo: z.string().trim().min(1).max(30),
        descricao: z.string().trim().min(1).max(150),
        valorEnvio: textoN(60),
        opcaoPaiId: idN,
        ativo: z.boolean().default(true),
        ordem: z.number().int().min(0).max(999).default(0),
      }),
    )
    .default([]),
});

/**
 * Cadastra ou altera o campo adicional da operadora, com as opções num pedido só. Campo e opção nunca se apagam:
 * deixam de valer pelo "ativo" (a guia antiga continua com o valor informado).
 */
export const opGravarAtributo = definirOperacao({
  nome: 'faturamento.gravar-atributo-guia',
  tabelas: ['atributo_guia_fonte_pagadora', 'atributo_guia_opcao'],
  entrada: esquemaAtributo,
  async gravar(tx, e) {
    await existe(tx, 'fonte_pagadora', e.fontePagadoraId, 'fontePagadoraId');
    const outros = (await atributosFontePropria(tx, e.fontePagadoraId)).filter((o) => o.id !== e.id);
    exigirValido({ ...validarDefinicaoAtributo(e, outros), ...validarOpcoesAtributo(e.opcoes) });
    if (outros.some((o) => o.codigo.toUpperCase() === e.codigo.toUpperCase()))
      throw recusa('duplicado', 'Já existe um campo com este código na operadora.', { campos: ['codigo'] });
    if (e.tipoDado !== 'opcao' && e.opcoes.length)
      throw recusa('entrada-invalida', 'Só o campo de lista tem opções.', { campos: ['opcoes'] });
    // Inativar um campo de que outros ativos dependem travaria a escolha neles: inative os dependentes antes.
    const filhos = e.id !== null && !e.ativo ? dependentesAtivos(e.id, outros) : [];
    if (filhos.length)
      throw recusa('entrada-invalida', `Inative antes os campos que dependem deste: ${filhos.join(', ')}.`, {
        campos: ['ativo'],
      });
    const valores = {
      codigo: e.codigo,
      rotulo: e.rotulo,
      tipo_dado: e.tipoDado,
      tipo_guia: e.tipoGuia,
      obrigatorio: e.obrigatorio,
      tamanho_maximo: e.tamanhoMaximo,
      depende_atributo_guia_fonte_pagadora_id: e.dependeDeId,
      ordem: e.ordem,
      ativo: e.ativo,
    };
    let atributo: number;
    if (e.id === null)
      atributo = await tx.incluir('atributo_guia_fonte_pagadora', {
        fonte_pagadora_id: e.fontePagadoraId,
        ...valores,
      });
    else {
      const r = await tx.uma<Linha>(
        'SELECT fonte_pagadora_id FROM atributo_guia_fonte_pagadora WHERE id = ?',
        [e.id],
      );
      if (!r || n(r['fonte_pagadora_id']) !== e.fontePagadoraId)
        throw recusa('nao-encontrado', 'O campo não existe nesta operadora.', { campos: ['id'] });
      if (e.versao === null)
        throw recusa('conflito-versao', 'Informe a versão do campo.', { campos: ['versao'] });
      await tx.alterar('atributo_guia_fonte_pagadora', e.id, e.versao, valores);
      atributo = e.id;
    }
    // Opção-pai: tem de ser do campo de que este depende.
    const paisValidos = e.dependeDeId
      ? new Set(
          (
            await tx.consultar<Linha>(
              'SELECT id FROM atributo_guia_opcao WHERE atributo_guia_fonte_pagadora_id = ?',
              [e.dependeDeId],
            )
          ).map((r) => n(r['id'])),
        )
      : new Set<number>();
    const codigos = new Set<string>();
    let opcoes = 0;
    for (const [i, o] of e.opcoes.entries()) {
      if (codigos.has(o.codigo.toUpperCase()))
        throw recusa('duplicado', `Opção repetida: ${o.codigo}.`, { campos: [`opcoes.${i}.codigo`] });
      codigos.add(o.codigo.toUpperCase());
      if (o.opcaoPaiId !== null && !paisValidos.has(o.opcaoPaiId))
        throw recusa('entrada-invalida', 'A opção-pai tem de ser do campo de que este depende.', {
          campos: [`opcoes.${i}.opcaoPaiId`],
        });
      const vo = {
        codigo: o.codigo,
        descricao: o.descricao,
        valor_envio: o.valorEnvio,
        opcao_pai_id: o.opcaoPaiId,
        ativo: o.ativo,
        ordem: o.ordem,
      };
      if (o.id === null)
        await tx.incluir('atributo_guia_opcao', { atributo_guia_fonte_pagadora_id: atributo, ...vo });
      else {
        const r = await tx.uma<Linha>(
          'SELECT atributo_guia_fonte_pagadora_id AS a FROM atributo_guia_opcao WHERE id = ?',
          [o.id],
        );
        if (!r || n(r['a']) !== atributo || o.versao === null)
          throw recusa('nao-encontrado', 'A opção não é deste campo.', { campos: [`opcoes.${i}.id`] });
        await tx.alterar('atributo_guia_opcao', o.id, o.versao, vo);
      }
      opcoes++;
    }
    return { id: atributo, opcoes };
  },
  alvo: (_e, s) => ({ tabela: 'atributo_guia_fonte_pagadora', id: s.id }),
});

export const esquemaValoresGuia = z.object({
  guiaId: id,
  valores: z.array(
    z.object({ atributoId: id, opcaoId: idN, texto: z.string().max(500).nullable().default(null) }),
  ),
});

/**
 * Grava os campos adicionais da guia num pedido só. Valor que some do pedido fica marcado como excluído (a linha volta
 * a valer se o campo for informado de novo). Devolve os obrigatórios que ainda faltam.
 */
export const opGravarValoresGuia = definirOperacao({
  nome: 'faturamento.gravar-atributos-guia',
  tabelas: ['valor_atributo_guia'],
  entrada: esquemaValoresGuia,
  async gravar(tx, e, ctx) {
    const g = await guiaDa(tx, estDe(ctx), e.guiaId);
    if (!guiaAceitaAtributos(g.situacao))
      throw recusa('guia-apresentada', 'A guia já está em lote ou enviada: os campos não mudam mais.', {
        campos: [],
      });
    const defs = atributosDaGuia(await atributosFontePropria(tx, g.fontePagadoraId), g.tipoGuia);
    const r = validarValoresAtributos(defs, e.valores);
    exigirValido(r.erros);
    const atuais = await tx.consultarParaAtualizar(
      `SELECT id, versao, sequencia, atributo_guia_fonte_pagadora_id AS atributo, atributo_guia_opcao_id AS opcao,
              valor_texto, excluido_em FROM valor_atributo_guia WHERE guia_tiss_id = ?`,
      [g.id],
    );
    const porAtributo = new Map(atuais.map((a) => [n(a['atributo']), a]));
    let seq = atuais.reduce((m, a) => Math.max(m, n(a['sequencia'])), 0);
    let gravados = 0;
    let retirados = 0;
    for (const v of r.normalizados) {
      const a = porAtributo.get(v.atributoId);
      const valores = { atributo_guia_opcao_id: v.opcaoId, valor_texto: v.texto };
      if (!a) {
        await tx.incluir('valor_atributo_guia', {
          guia_tiss_id: g.id,
          sequencia: ++seq,
          atributo_guia_fonte_pagadora_id: v.atributoId,
          ...valores,
        });
        gravados++;
      } else if (
        a['excluido_em'] !== null ||
        nn(a['opcao']) !== v.opcaoId ||
        txn(a['valor_texto']) !== v.texto
      ) {
        await tx.alterar('valor_atributo_guia', n(a['id']), n(a['versao']), {
          ...valores,
          excluido_em: null,
          excluido_por: null,
        });
        gravados++;
      }
    }
    // Só se retira o valor de campo que vale hoje para a guia e veio vazio; o valor de um campo depois inativado (ou
    // de outro tipo de guia) fica como foi informado.
    const informados = new Set(r.normalizados.map((v) => v.atributoId));
    const vigentes = new Set(defs.map((d) => d.id));
    for (const a of atuais)
      if (a['excluido_em'] === null && vigentes.has(n(a['atributo'])) && !informados.has(n(a['atributo']))) {
        await tx.alterar('valor_atributo_guia', n(a['id']), n(a['versao']), {
          excluido_em: new Date(),
          excluido_por: ctx.usuario,
        });
        retirados++;
      }
    return { id: g.id, gravados, retirados, faltam: r.faltam.join(', ') };
  },
  alvo: (_e, s) => ({ tabela: 'guia_tiss', id: s.id }),
});

export const OPERACOES_COMPLEMENTOS = {
  'periodo.incluir': opIncluirPeriodo,
  'periodo.retirar': opRetirarPeriodo,
  segurado: opGravarSegurado,
  atributo: opGravarAtributo,
  'guia.atributos': opGravarValoresGuia,
} as const;
export type NomeOperacaoComplementos = keyof typeof OPERACOES_COMPLEMENTOS;

export async function gravarComplementos(
  executor: Executor,
  nome: NomeOperacaoComplementos,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const op = OPERACOES_COMPLEMENTOS[nome] as Parameters<Executor['executar']>[0];
  const r = await executor.executar(op, ctx.cliente, entrada, ctx);
  return r.resultado as Record<string, unknown>;
}
