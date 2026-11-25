// Regras comerciais configuráveis da conta sobre o banco do cliente (F8, 06-FAT linhas 13, 19 e 23). Leitura pelo
// Leitor, gravação pelo Executor (trilha, autoria e idempotência na mesma transação). A regra é do
// @sgh/dominio-faturamento (conta/regras-comerciais): aqui só se lê, chama o domínio e grava.
// - Linha 13: cadastro da regra de criação ou quebra de conta (com exceções) e a simulação sobre um atendimento real
//   (que regra vale, por que as outras não, e o período da quebra).
// - Linha 19: cadastro do desconto por volume (faixas) e da franquia do acordo (com exceções); a aplicação na conta
//   calcula a franquia e o desconto pelo volume medido no banco e grava cada valor em conta_hospitalar_franquia; a
//   reaplicação marca a anterior como excluída (autor e data) e grava a nova: nada se apaga.
// - Linha 23: cadastro da regra de remoção e da regra de ligação, registro da ligação tarifada, lançamento da remoção
//   e das ligações pendentes na conta (item com preço da tabela vigente ou o valor do tarifador, memória do cálculo e
//   total da conta refeito); a ligação não cobrável fica marcada, com o motivo.
// Configuração nunca é apagada: inativar é marcar ativo = falso; a exceção ou a faixa retirada fica marcada.
import {
  calcularDescontoVolume,
  calcularFranquia,
  efeitoComercialNaConta,
  fatorReducaoGuia,
  cobrancaLigacao,
  cobrancaRemocao,
  contaEditavel,
  escolherRegraConta,
  type FaixaDesconto,
  type FranquiaContrato,
  motivoFranquiaNaoVale,
  tipoDaLigacao,
  validarFaixasDesconto,
  validarFranquia,
  validarRegraConta,
  VINCULOS_BENEFICIARIO,
  type VinculoBeneficiario,
  vinculoDaCarteira,
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
import { totalDosItens } from './operacoes.js';
import { precoVigente, tabelasDePreco } from './preco-conta.js';
import { regrasContaDo } from './regras-conta-leitura.js';

type Linha = Record<string, unknown>;
type Consulta = Pick<Leitor, 'consultar' | 'uma'>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown) => v === true || v === 1 || v === '1';
const r2 = (x: number) => Math.round(x * 100) / 100;
const p2 = (x: number, t = 2) => String(x).padStart(t, '0');
function dia(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
  return String(v).slice(0, 10);
}
const agoraBanco = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p2(d.getMilliseconds(), 3)}`;
};
const hoje = () => agoraBanco().slice(0, 10);
function estDe(ctx: ContextoOperacao): number {
  if (ctx.estabelecimento === null)
    throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.', { campos: [] });
  return ctx.estabelecimento;
}
function exigirValido(erros: Record<string, string>) {
  if (Object.keys(erros).length)
    throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos: Object.keys(erros) });
}
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');

const id = z.number().int().positive();
const idN = id.nullable().default(null);
const dataZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const versaoZ = z.number().int().positive().optional();

// ── Linha 13: regra de criação e quebra de conta ──────────────────────────────────────────────────────

/** Simulação sobre um atendimento real: que regra vale (e por que as outras não) e o período da quebra. */
export async function simularRegraContaPropria(
  l: Leitor,
  est: number,
  atendimentoId: number,
  o: { itemId?: number | null; data?: string | null } = {},
) {
  const a = await l.uma<Linha>(
    `SELECT a.id, a.numero, a.categoria_atendimento_id, a.origem_entrada_atendimento_id, a.setor_funcional_id,
            a.fonte_pagadora_id, a.horario_especial, a.entrada_em,
            (SELECT c.plano_fonte_pagadora_id FROM conta_hospitalar c WHERE c.atendimento_id = a.id
               AND c.excluido_em IS NULL ORDER BY c.id LIMIT 1) AS plano,
            (SELECT c.categoria_acomodacao_id FROM conta_hospitalar c WHERE c.atendimento_id = a.id
               AND c.excluido_em IS NULL ORDER BY c.id LIMIT 1) AS acomodacao
       FROM atendimento a WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
    [atendimentoId, est],
  );
  if (!a) throw recusa('nao-encontrado', 'Atendimento não encontrado.', { campos: ['atendimentoId'] });
  const item = o.itemId
    ? await l.uma<Linha>('SELECT id, grupo_faturamento_id FROM item_faturavel WHERE id = ?', [o.itemId])
    : null;
  const situacao = {
    data: o.data ?? dia(a['entrada_em']) ?? hoje(),
    categoriaAtendimento: nn(a['categoria_atendimento_id']),
    origemEntrada: nn(a['origem_entrada_atendimento_id']),
    categoriaAcomodacao: nn(a['acomodacao']),
    setor: nn(a['setor_funcional_id']),
    grupo: nn(item?.['grupo_faturamento_id']),
    item: nn(item?.['id']),
    fonteOrigem: nn(a['fonte_pagadora_id']),
    planoOrigem: nn(a['plano']),
    horarioEspecial: bool(a['horario_especial']),
  };
  const regras = await regrasContaDo(l, est);
  const criacao = escolherRegraConta(regras, situacao, 'criar_conta');
  const quebra = escolherRegraConta(regras, situacao, 'quebrar_conta');
  const transferencia = escolherRegraConta(regras, situacao, 'transferir_item');
  const resumo = (e: ReturnType<typeof escolherRegraConta>) => ({
    regraId: e.regra?.id ?? null,
    fonteDestino: e.regra?.fonteDestino ?? null,
    planoDestino: e.regra?.planoDestino ?? null,
    periodo: e.periodo,
    avaliadas: e.avaliadas,
  });
  return {
    atendimento: { id: n(a['id']), numero: String(a['numero']) },
    situacao,
    criacao: resumo(criacao),
    quebra: resumo(quebra),
    transferencia: resumo(transferencia),
  };
}

const criteriosZ = z.object({
  categoriaAtendimentoId: idN,
  origemEntradaId: idN,
  grupoId: idN,
  itemId: idN,
});
export const esquemaSalvarRegraConta = z.object({
  id: id.optional(),
  versao: versaoZ,
  acao: z.enum(['criar_conta', 'quebrar_conta', 'transferir_item']),
  categoriaAtendimentoId: idN,
  origemEntradaId: idN,
  categoriaAcomodacaoId: idN,
  setorId: idN,
  grupoId: idN,
  itemId: idN,
  horarioEspecial: z.boolean().nullable().default(null),
  fonteOrigemId: idN,
  planoOrigemId: idN,
  fonteDestinoId: idN,
  planoDestinoId: idN,
  periodicidade: z.enum(['diaria', 'semanal', 'quinzenal', 'mensal']).nullable().default(null),
  prioridade: z.number().int().min(0).max(65535).default(100),
  vigenciaInicio: dataZ,
  ativo: z.boolean().default(true),
  excecoes: z.array(criteriosZ).max(50).default([]),
});

export const opSalvarRegraConta = definirOperacao({
  nome: 'faturamento.salvar-regra-criacao-conta',
  tabelas: ['regra_criacao_conta', 'regra_criacao_conta_excecao'],
  entrada: esquemaSalvarRegraConta,
  async gravar(tx, e) {
    const est = estDe(tx.contexto);
    exigirValido(
      validarRegraConta({
        acao: e.acao,
        fonteDestino: e.fonteDestinoId,
        planoDestino: e.planoDestinoId,
        fonteOrigem: e.fonteOrigemId,
        planoOrigem: e.planoOrigemId,
        categoriaAtendimento: e.categoriaAtendimentoId,
        origemEntrada: e.origemEntradaId,
        categoriaAcomodacao: e.categoriaAcomodacaoId,
        setor: e.setorId,
        grupo: e.grupoId,
        item: e.itemId,
        periodicidade: e.periodicidade,
        prioridade: e.prioridade,
        vigenciaInicio: e.vigenciaInicio,
        excecoes: e.excecoes.map((x) => ({
          categoriaAtendimento: x.categoriaAtendimentoId,
          origemEntrada: x.origemEntradaId,
          grupo: x.grupoId,
          item: x.itemId,
        })),
      }),
    );
    const valores = {
      acao: e.acao,
      categoria_atendimento_id: e.categoriaAtendimentoId,
      origem_entrada_atendimento_id: e.origemEntradaId,
      categoria_acomodacao_id: e.categoriaAcomodacaoId,
      setor_funcional_id: e.setorId,
      grupo_faturamento_id: e.grupoId,
      item_faturavel_id: e.itemId,
      horario_especial: e.horarioEspecial,
      fonte_pagadora_origem_id: e.fonteOrigemId,
      plano_origem_id: e.planoOrigemId,
      fonte_pagadora_destino_id: e.fonteDestinoId,
      plano_destino_id: e.planoDestinoId,
      periodicidade: e.periodicidade,
      prioridade: e.prioridade,
      vigencia_inicio: e.vigenciaInicio,
      ativo: e.ativo,
    };
    let rid: number;
    if (e.id) {
      const atual = await tx.uma<Linha>(
        'SELECT id FROM regra_criacao_conta WHERE id = ? AND estabelecimento_id = ?',
        [e.id, est],
      );
      if (!atual) throw recusa('nao-encontrado', 'Regra não encontrada.', { campos: ['id'] });
      if (!e.versao) throw recusa('entrada-invalida', 'Informe a versão da regra.', { campos: ['versao'] });
      await tx.alterar('regra_criacao_conta', e.id, e.versao, valores);
      rid = e.id;
      // As exceções anteriores ficam marcadas como inativas (o histórico continua no banco).
      const antigas = await tx.consultar<Linha>(
        'SELECT id, versao FROM regra_criacao_conta_excecao WHERE regra_criacao_conta_id = ? AND ativo = 1',
        [rid],
        { teto: 1000 },
      );
      for (const x of antigas)
        await tx.alterar('regra_criacao_conta_excecao', n(x['id']), n(x['versao']), { ativo: false });
    } else {
      rid = await tx.incluir('regra_criacao_conta', { estabelecimento_id: est, ...valores });
    }
    for (const x of e.excecoes)
      await tx.incluir('regra_criacao_conta_excecao', {
        regra_criacao_conta_id: rid,
        categoria_atendimento_id: x.categoriaAtendimentoId,
        origem_entrada_atendimento_id: x.origemEntradaId,
        grupo_faturamento_id: x.grupoId,
        item_faturavel_id: x.itemId,
        ativo: true,
      });
    return { id: rid, excecoes: e.excecoes.length };
  },
  alvo: (_e, s) => ({ tabela: 'regra_criacao_conta', id: s.id }),
});

// ── Linha 19: desconto por volume e franquia ──────────────────────────────────────────────────────────

const faixaZ = z.object({
  sequencia: z.number().int().min(1).max(999),
  volumeInicial: z.number().min(0),
  volumeFinal: z.number().nullable().default(null),
  tipo: z.enum(['percentual', 'valor']).default('percentual'),
  percentual: z.number().nullable().default(null),
  valor: z.number().nullable().default(null),
  grupoId: idN,
  itemId: idN,
  setorId: idN,
});
export const esquemaSalvarDescontoVolume = z.object({
  id: id.optional(),
  versao: versaoZ,
  fontePagadoraId: id,
  planoId: idN,
  descricao: z.string().trim().min(1).max(150),
  baseVolume: z.enum(['valor_fatura', 'valor_competencia', 'quantidade_contas']).default('valor_fatura'),
  vigenciaInicio: dataZ,
  vigenciaFim: dataZ.nullable().default(null),
  ativo: z.boolean().default(true),
  faixas: z.array(faixaZ).min(1).max(50),
});
const faixaDominio = (f: z.infer<typeof faixaZ>): FaixaDesconto => ({
  sequencia: f.sequencia,
  volumeInicial: f.volumeInicial,
  volumeFinal: f.volumeFinal,
  tipo: f.tipo,
  percentual: f.percentual,
  valor: f.valor,
  grupo: f.grupoId,
  item: f.itemId,
  setor: f.setorId,
});

export const opSalvarDescontoVolume = definirOperacao({
  nome: 'faturamento.salvar-regra-desconto-volume',
  tabelas: ['regra_desconto_volume', 'regra_desconto_volume_faixa'],
  entrada: esquemaSalvarDescontoVolume,
  async gravar(tx, e) {
    const est = estDe(tx.contexto);
    const erros = validarFaixasDesconto(e.faixas.map(faixaDominio));
    if (e.vigenciaFim && e.vigenciaFim < e.vigenciaInicio)
      erros['vigenciaFim'] = 'O fim da vigência é anterior ao início.';
    exigirValido(erros);
    const valores = {
      fonte_pagadora_id: e.fontePagadoraId,
      plano_fonte_pagadora_id: e.planoId,
      descricao: e.descricao,
      base_volume: e.baseVolume,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      ativo: e.ativo,
    };
    let rid: number;
    if (e.id) {
      const atual = await tx.uma<Linha>(
        'SELECT id FROM regra_desconto_volume WHERE id = ? AND estabelecimento_id = ?',
        [e.id, est],
      );
      if (!atual) throw recusa('nao-encontrado', 'Regra de desconto não encontrada.', { campos: ['id'] });
      if (!e.versao) throw recusa('entrada-invalida', 'Informe a versão da regra.', { campos: ['versao'] });
      await tx.alterar('regra_desconto_volume', e.id, e.versao, valores);
      rid = e.id;
    } else {
      const repetida = await tx.uma<Linha>(
        `SELECT id FROM regra_desconto_volume WHERE estabelecimento_id = ? AND fonte_pagadora_id = ?
            AND plano_fonte_pagadora_id <=> ? AND vigencia_inicio = ?`,
        [est, e.fontePagadoraId, e.planoId, e.vigenciaInicio],
      );
      if (repetida)
        throw recusa(
          'entrada-invalida',
          'Já existe regra desta fonte e plano com o mesmo início de vigência.',
          {
            campos: ['vigenciaInicio'],
          },
        );
      rid = await tx.incluir('regra_desconto_volume', { estabelecimento_id: est, ...valores });
    }
    const existentes = await tx.consultar<Linha>(
      'SELECT id, versao, sequencia, excluido_em FROM regra_desconto_volume_faixa WHERE regra_desconto_volume_id = ?',
      [rid],
      { teto: 1000 },
    );
    const porSeq = new Map(existentes.map((x) => [n(x['sequencia']), x]));
    for (const f of e.faixas) {
      const v = {
        volume_inicial: f.volumeInicial,
        volume_final: f.volumeFinal,
        grupo_faturamento_id: f.grupoId,
        item_faturavel_id: f.itemId,
        setor_funcional_id: f.setorId,
        tipo_desconto: f.tipo,
        percentual_desconto: f.tipo === 'percentual' ? f.percentual : null,
        valor_desconto: f.tipo === 'valor' ? f.valor : null,
      };
      const x = porSeq.get(f.sequencia);
      if (x)
        await tx.alterar('regra_desconto_volume_faixa', n(x['id']), n(x['versao']), {
          ...v,
          excluido_em: null,
          excluido_por: null,
        });
      else
        await tx.incluir('regra_desconto_volume_faixa', {
          regra_desconto_volume_id: rid,
          sequencia: f.sequencia,
          ...v,
        });
    }
    // A faixa retirada fica marcada como excluída (autor e data), nunca apagada.
    const novas = new Set(e.faixas.map((f) => f.sequencia));
    for (const x of existentes)
      if (!novas.has(n(x['sequencia'])) && x['excluido_em'] === null)
        await tx.alterar('regra_desconto_volume_faixa', n(x['id']), n(x['versao']), {
          excluido_em: agoraBanco(),
          excluido_por: tx.contexto.usuario,
        });
    return { id: rid, faixas: e.faixas.length };
  },
  alvo: (_e, s) => ({ tabela: 'regra_desconto_volume', id: s.id }),
});

const excecaoFranquiaZ = z.object({
  itemId: idN,
  grupoId: idN,
  especialidadeId: idN,
  regimeId: idN,
  aplicaTitular: z.boolean().default(true),
  aplicaDependente: z.boolean().default(true),
  aplicaPensionista: z.boolean().default(true),
  motivo: z.string().trim().max(250).nullable().default(null),
});
export const esquemaSalvarFranquia = z.object({
  id: id.optional(),
  versao: versaoZ,
  contratoId: id,
  planoId: idN,
  descricao: z.string().trim().min(1).max(150),
  regimeId: idN,
  itemId: idN,
  grupoId: idN,
  aplicaTitular: z.boolean().default(true),
  aplicaDependente: z.boolean().default(true),
  aplicaPensionista: z.boolean().default(true),
  idadeMinima: z.number().int().min(0).max(150).nullable().default(null),
  idadeMaxima: z.number().int().min(0).max(150).nullable().default(null),
  tipo: z.enum(['valor', 'quantidade', 'percentual']),
  valorFranquia: z.number().nullable().default(null),
  quantidadePontos: z.number().nullable().default(null),
  valorPonto: z.number().nullable().default(null),
  percentualParticipacao: z.number().nullable().default(null),
  valorParticipacao: z.number().nullable().default(null),
  vigenciaInicio: dataZ,
  vigenciaFim: dataZ.nullable().default(null),
  ativo: z.boolean().default(true),
  excecoes: z.array(excecaoFranquiaZ).max(50).default([]),
});

export const opSalvarFranquia = definirOperacao({
  nome: 'faturamento.salvar-franquia-contrato',
  tabelas: ['franquia_contrato', 'franquia_contrato_excecao'],
  entrada: esquemaSalvarFranquia,
  async gravar(tx, e) {
    const est = estDe(tx.contexto);
    exigirValido(
      validarFranquia({
        tipo: e.tipo,
        valorFranquia: e.valorFranquia,
        quantidadePontos: e.quantidadePontos,
        valorPonto: e.valorPonto,
        percentualParticipacao: e.percentualParticipacao,
        idadeMinima: e.idadeMinima,
        idadeMaxima: e.idadeMaxima,
        vigenciaInicio: e.vigenciaInicio,
        vigenciaFim: e.vigenciaFim,
        aplicaTitular: e.aplicaTitular,
        aplicaDependente: e.aplicaDependente,
        aplicaPensionista: e.aplicaPensionista,
        excecoes: e.excecoes.map((x) => ({
          item: x.itemId,
          grupo: x.grupoId,
          especialidade: x.especialidadeId,
          regime: x.regimeId,
          aplicaTitular: x.aplicaTitular,
          aplicaDependente: x.aplicaDependente,
          aplicaPensionista: x.aplicaPensionista,
          ativo: true,
        })),
      }),
    );
    const contrato = await tx.uma<Linha>(
      'SELECT id FROM contrato_fonte_pagadora WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.contratoId, est],
    );
    if (!contrato) throw recusa('nao-encontrado', 'Contrato não encontrado.', { campos: ['contratoId'] });
    const valores = {
      contrato_fonte_pagadora_id: e.contratoId,
      plano_fonte_pagadora_id: e.planoId,
      descricao: e.descricao,
      regime_atendimento_id: e.regimeId,
      item_faturavel_id: e.itemId,
      grupo_faturamento_id: e.grupoId,
      aplica_titular: e.aplicaTitular,
      aplica_dependente: e.aplicaDependente,
      aplica_pensionista: e.aplicaPensionista,
      idade_minima: e.idadeMinima,
      idade_maxima: e.idadeMaxima,
      tipo_franquia: e.tipo,
      valor_franquia: e.valorFranquia,
      quantidade_pontos: e.quantidadePontos,
      valor_ponto: e.valorPonto,
      percentual_participacao: e.percentualParticipacao,
      valor_participacao: e.valorParticipacao,
      vigencia_inicio: e.vigenciaInicio,
      vigencia_fim: e.vigenciaFim,
      ativo: e.ativo,
    };
    let fid: number;
    if (e.id) {
      const atual = await tx.uma<Linha>(
        `SELECT f.id FROM franquia_contrato f JOIN contrato_fonte_pagadora c ON c.id = f.contrato_fonte_pagadora_id
          WHERE f.id = ? AND c.estabelecimento_id = ?`,
        [e.id, est],
      );
      if (!atual) throw recusa('nao-encontrado', 'Franquia não encontrada.', { campos: ['id'] });
      if (!e.versao)
        throw recusa('entrada-invalida', 'Informe a versão da franquia.', { campos: ['versao'] });
      await tx.alterar('franquia_contrato', e.id, e.versao, valores);
      fid = e.id;
      const antigas = await tx.consultar<Linha>(
        'SELECT id, versao FROM franquia_contrato_excecao WHERE franquia_contrato_id = ? AND ativo = 1',
        [fid],
        { teto: 1000 },
      );
      for (const x of antigas)
        await tx.alterar('franquia_contrato_excecao', n(x['id']), n(x['versao']), { ativo: false });
    } else fid = await tx.incluir('franquia_contrato', valores);
    for (const x of e.excecoes)
      await tx.incluir('franquia_contrato_excecao', {
        franquia_contrato_id: fid,
        item_faturavel_id: x.itemId,
        grupo_faturamento_id: x.grupoId,
        especialidade_medica_id: x.especialidadeId,
        regime_atendimento_id: x.regimeId,
        aplica_titular: x.aplicaTitular,
        aplica_dependente: x.aplicaDependente,
        aplica_pensionista: x.aplicaPensionista,
        motivo: x.motivo,
        ativo: true,
      });
    return { id: fid, excecoes: e.excecoes.length };
  },
  alvo: (_e, s) => ({ tabela: 'franquia_contrato', id: s.id }),
});

const COLUNAS_CONTA = `c.id, c.versao, c.numero, c.situacao, c.atendimento_id, c.paciente_id, c.fonte_pagadora_id,
  c.plano_fonte_pagadora_id, c.contrato_fonte_pagadora_id, c.tabela_preco_id, c.competencia, c.inicio_em,
  c.valor_itens, c.valor_acrescimo, c.valor_desconto, c.valor_paciente, c.valor_total`;
async function contaDa(l: Consulta, est: number, contaId: number) {
  const c = await l.uma<Linha>(
    `SELECT ${COLUNAS_CONTA}, a.regime_atendimento_id, a.especialidade_medica_id, pf.data_nascimento
       FROM conta_hospitalar c
       LEFT JOIN atendimento a ON a.id = c.atendimento_id
       LEFT JOIN paciente p ON p.id = c.paciente_id
       LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
      WHERE c.id = ? AND c.estabelecimento_id = ? AND c.excluido_em IS NULL`,
    [contaId, est],
  );
  if (!c)
    throw recusa('nao-encontrado', 'A conta não existe neste estabelecimento.', { campos: ['contaId'] });
  return c;
}
function idadeEm(nascimento: string | null, data: string): number | null {
  if (!nascimento) return null;
  const [a, m, d] = nascimento.split('-').map(Number) as [number, number, number];
  const [A, M, D] = data.split('-').map(Number) as [number, number, number];
  return A - a - (M < m || (M === m && D < d) ? 1 : 0);
}

async function franquiasDoContrato(
  l: Consulta,
  contrato: number,
): Promise<(FranquiaContrato & { descricao: string; plano: number | null; versao: number })[]> {
  const fs = await l.consultar<Linha>(
    'SELECT * FROM franquia_contrato WHERE contrato_fonte_pagadora_id = ? ORDER BY id',
    [contrato],
    { teto: 500 },
  );
  const ex = fs.length
    ? await l.consultar<Linha>(
        `SELECT * FROM franquia_contrato_excecao WHERE franquia_contrato_id IN (${lista(fs.length)}) ORDER BY id`,
        fs.map((f) => f['id']),
        { teto: 5000 },
      )
    : [];
  return fs.map((f) => ({
    id: n(f['id']),
    // A versão vai à tela para a edição da franquia (trava otimista na gravação).
    versao: n(f['versao']),
    descricao: String(f['descricao']),
    plano: nn(f['plano_fonte_pagadora_id']),
    tipo: String(f['tipo_franquia']) as FranquiaContrato['tipo'],
    valorFranquia: nn(f['valor_franquia']),
    quantidadePontos: nn(f['quantidade_pontos']),
    valorPonto: nn(f['valor_ponto']),
    percentualParticipacao: nn(f['percentual_participacao']),
    valorParticipacao: nn(f['valor_participacao']),
    regime: nn(f['regime_atendimento_id']),
    item: nn(f['item_faturavel_id']),
    grupo: nn(f['grupo_faturamento_id']),
    aplicaTitular: bool(f['aplica_titular']),
    aplicaDependente: bool(f['aplica_dependente']),
    aplicaPensionista: bool(f['aplica_pensionista']),
    idadeMinima: nn(f['idade_minima']),
    idadeMaxima: nn(f['idade_maxima']),
    vigenciaInicio: dia(f['vigencia_inicio']) ?? '',
    vigenciaFim: dia(f['vigencia_fim']),
    ativo: bool(f['ativo']),
    excecoes: ex
      .filter((x) => n(x['franquia_contrato_id']) === n(f['id']))
      .map((x) => ({
        item: nn(x['item_faturavel_id']),
        grupo: nn(x['grupo_faturamento_id']),
        especialidade: nn(x['especialidade_medica_id']),
        regime: nn(x['regime_atendimento_id']),
        aplicaTitular: bool(x['aplica_titular']),
        aplicaDependente: bool(x['aplica_dependente']),
        aplicaPensionista: bool(x['aplica_pensionista']),
        ativo: bool(x['ativo']),
      })),
  }));
}

/**
 * O volume medido no banco pela base da regra (fatura da conta, competência da fonte ou quantidade de contas). O valor
 * é o bruto (itens + acréscimo), antes da franquia e do desconto: aplicar o desconto não muda o volume que o decide.
 */
async function volumeDa(
  l: Consulta,
  est: number,
  c: Linha,
  base: string,
): Promise<{ volume: number; medida: string }> {
  if (base === 'valor_fatura') {
    const f = await l.uma<Linha>(
      `SELECT fc.fatura_fonte_pagadora_id AS f, (SELECT COALESCE(SUM(x.valor_itens + x.valor_acrescimo), 0) FROM fatura_fonte_pagadora_conta y
               JOIN conta_hospitalar x ON x.id = y.conta_hospitalar_id
              WHERE y.fatura_fonte_pagadora_id = fc.fatura_fonte_pagadora_id AND x.situacao <> 'cancelada'
                AND x.excluido_em IS NULL) AS v
         FROM fatura_fonte_pagadora_conta fc WHERE fc.conta_hospitalar_id = ? ORDER BY fc.id DESC LIMIT 1`,
      [c['id']],
    );
    if (f) return { volume: n(f['v']), medida: 'valor_fatura' };
  }
  const r = await l.uma<Linha>(
    `SELECT COALESCE(SUM(valor_itens + valor_acrescimo), 0) AS v, COUNT(*) AS q FROM conta_hospitalar
      WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND competencia = ? AND situacao <> 'cancelada'
        AND excluido_em IS NULL`,
    [est, c['fonte_pagadora_id'], dia(c['competencia'])],
  );
  return base === 'quantidade_contas'
    ? { volume: n(r?.['q']), medida: 'quantidade_contas' }
    : { volume: n(r?.['v']), medida: 'valor_competencia' };
}

async function itensDaConta(l: Consulta, conta: number) {
  return (
    await l.consultar<Linha>(
      `SELECT item_faturavel_id, grupo_faturamento_id, setor_funcional_id, quantidade, valor_total
         FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? AND excluido_em IS NULL
          AND situacao NOT IN ('estornado','transferido','sem_cobranca')`,
      [conta],
      { teto: 20000 },
    )
  ).map((i) => ({
    item: n(i['item_faturavel_id']),
    grupo: nn(i['grupo_faturamento_id']),
    setor: nn(i['setor_funcional_id']),
    quantidade: n(i['quantidade']),
    valor: n(i['valor_total']),
  }));
}

/**
 * A carteira do paciente na fonte pagadora da conta: primeiro a cobertura do atendimento (a que a recepção usou),
 * depois a cobertura do cadastro do paciente vigente na data da conta (a principal primeiro).
 */
async function carteiraDaConta(l: Consulta, c: Linha, data: string) {
  const sel = 'SELECT cp.id, cp.titular, cp.pensionista FROM cobertura_paciente cp';
  const doAtendimento = c['atendimento_id']
    ? await l.uma<Linha>(
        `${sel} JOIN cobertura_atendimento ca ON ca.cobertura_paciente_id = cp.id
          WHERE ca.atendimento_id = ? AND ca.fonte_pagadora_id = ? AND ca.excluido_em IS NULL AND cp.excluido_em IS NULL
          ORDER BY ca.ordem LIMIT 1`,
        [c['atendimento_id'], c['fonte_pagadora_id']],
      )
    : null;
  const x =
    doAtendimento ??
    (c['paciente_id']
      ? await l.uma<Linha>(
          `${sel} WHERE cp.paciente_id = ? AND cp.fonte_pagadora_id = ? AND cp.excluido_em IS NULL
              AND (cp.plano_fonte_pagadora_id IS NULL OR ? IS NULL OR cp.plano_fonte_pagadora_id = ?)
              AND cp.vigencia_inicio <= ? AND (cp.vigencia_fim IS NULL OR cp.vigencia_fim >= ?)
            ORDER BY cp.situacao = 'ativa' DESC, cp.principal DESC, cp.id DESC LIMIT 1`,
          [
            c['paciente_id'],
            c['fonte_pagadora_id'],
            c['plano_fonte_pagadora_id'],
            c['plano_fonte_pagadora_id'],
            data,
            data,
          ],
        )
      : null);
  return x ? { id: n(x['id']), titular: bool(x['titular']), pensionista: bool(x['pensionista']) } : null;
}

/**
 * Prévia da franquia e do desconto por volume da conta, com o motivo de cada franquia que não vale. O vínculo do
 * beneficiário vem da carteira do cadastro; `simulacao` só serve à leitura (prévia "e se fosse dependente"), nunca à
 * gravação. Sem vínculo no cadastro nem simulação, toda franquia sai com o motivo `sem_vinculo_no_cadastro`.
 */
export async function calculoComercialConta(
  l: Consulta,
  est: number,
  contaId: number,
  simulacao: VinculoBeneficiario | null = null,
) {
  const c = await contaDa(l, est, contaId);
  const data = dia(c['inicio_em']) ?? hoje();
  const carteira = await carteiraDaConta(l, c, data);
  const doCadastro = vinculoDaCarteira(carteira);
  const vinculo = simulacao ?? doCadastro;
  const origemVinculo: 'simulacao' | 'cadastro' | null = simulacao
    ? 'simulacao'
    : doCadastro
      ? 'cadastro'
      : null;
  const situacao = {
    data,
    regime: nn(c['regime_atendimento_id']),
    especialidade: nn(c['especialidade_medica_id']),
    vinculo,
    origemVinculo,
    coberturaPacienteId: carteira?.id ?? null,
    idade: idadeEm(dia(c['data_nascimento']), data),
  };
  const itens = await itensDaConta(l, contaId);
  const plano = nn(c['plano_fonte_pagadora_id']);
  const franquias = c['contrato_fonte_pagadora_id']
    ? (await franquiasDoContrato(l, n(c['contrato_fonte_pagadora_id']))).filter(
        (f) => f.plano === null || f.plano === plano,
      )
    : [];
  const franquia = franquias.map((f) => {
    const s = vinculo ? { ...situacao, vinculo } : null;
    const motivo = s ? motivoFranquiaNaoVale(f, s) : 'sem_vinculo_no_cadastro';
    const calc = motivo || !s ? null : calcularFranquia(f, s, itens);
    return { id: f.id, descricao: f.descricao, motivo, valor: calc?.valor ?? 0, base: calc?.base ?? 0 };
  });
  const regra = await l.uma<Linha>(
    `SELECT id, base_volume, descricao FROM regra_desconto_volume
      WHERE estabelecimento_id = ? AND fonte_pagadora_id = ? AND (plano_fonte_pagadora_id IS NULL OR plano_fonte_pagadora_id <=> ?)
        AND ativo = 1 AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
      ORDER BY plano_fonte_pagadora_id IS NULL, vigencia_inicio DESC, id DESC LIMIT 1`,
    [est, c['fonte_pagadora_id'], plano, data, data],
  );
  let desconto: { regraId: number; descricao: string; medida: string; volume: number; valor: number } | null =
    null;
  if (regra) {
    const fx = await l.consultar<Linha>(
      'SELECT * FROM regra_desconto_volume_faixa WHERE regra_desconto_volume_id = ? AND excluido_em IS NULL',
      [regra['id']],
      { teto: 200 },
    );
    const faixas: FaixaDesconto[] = fx.map((f) => ({
      sequencia: n(f['sequencia']),
      volumeInicial: n(f['volume_inicial']),
      volumeFinal: nn(f['volume_final']),
      tipo: String(f['tipo_desconto']) as FaixaDesconto['tipo'],
      percentual: nn(f['percentual_desconto']),
      valor: nn(f['valor_desconto']),
      grupo: nn(f['grupo_faturamento_id']),
      item: nn(f['item_faturavel_id']),
      setor: nn(f['setor_funcional_id']),
    }));
    const v = await volumeDa(l, est, c, String(regra['base_volume']));
    const d = calcularDescontoVolume(faixas, v.volume, itens);
    desconto = {
      regraId: n(regra['id']),
      descricao: String(regra['descricao']),
      medida: v.medida,
      volume: v.volume,
      valor: d.desconto,
    };
  }
  return { conta: c, situacao, franquia, desconto };
}

// O vínculo do beneficiário não entra pela requisição: a gravação usa só a carteira do cadastro.
export const esquemaAplicarComercial = z.object({ contaId: id });
export const opAplicarComercial = definirOperacao({
  nome: 'faturamento.aplicar-franquia-desconto-conta',
  tabelas: ['conta_hospitalar_franquia', 'conta_hospitalar'],
  entrada: esquemaAplicarComercial,
  async gravar(tx, e) {
    const est = estDe(tx.contexto);
    const r = await calculoComercialConta(tx, est, e.contaId);
    if (!contaEditavel(String(r.conta['situacao'])))
      throw recusa('conta-fechada', 'A conta não está aberta: a franquia e o desconto não mudam.', {
        campos: [],
      });
    if (r.franquia.length && r.situacao.origemVinculo !== 'cadastro')
      throw recusa(
        'sem-vinculo',
        'O contrato tem franquia e a carteira do paciente nesta fonte pagadora não está no cadastro: informe a titularidade (titular, dependente ou pensionista) na cobertura do paciente antes de aplicar.',
        { campos: ['coberturaPaciente'] },
      );
    const [cab] = await tx.consultarParaAtualizar(
      `SELECT id, versao, valor_itens, valor_acrescimo, valor_desconto, valor_paciente FROM conta_hospitalar
        WHERE id = ?`,
      [e.contaId],
    );
    const anteriores = await tx.consultar<Linha>(
      `SELECT id, versao, tipo, valor FROM conta_hospitalar_franquia WHERE conta_hospitalar_id = ? AND excluido_em IS NULL
          AND tipo IN ('franquia','desconto_volume')`,
      [e.contaId],
      { teto: 1000 },
    );
    for (const x of anteriores)
      await tx.alterar('conta_hospitalar_franquia', n(x['id']), n(x['versao']), {
        excluido_em: agoraBanco(),
        excluido_por: tx.contexto.usuario,
      });
    const seq = await tx.uma<Linha>(
      'SELECT COALESCE(MAX(sequencia), 0) AS s FROM conta_hospitalar_franquia WHERE conta_hospitalar_id = ?',
      [e.contaId],
    );
    let s = n(seq?.['s']);
    let franquia = 0;
    for (const f of r.franquia.filter((x) => x.motivo === null && x.valor > 0)) {
      s += 1;
      franquia = r2(franquia + f.valor);
      await tx.incluir('conta_hospitalar_franquia', {
        conta_hospitalar_id: e.contaId,
        sequencia: s,
        tipo: 'franquia',
        franquia_contrato_id: f.id,
        valor: f.valor,
        observacao: `Franquia "${f.descricao}" sobre base ${f.base.toFixed(2)} (vínculo ${r.situacao.vinculo ?? ''} da carteira ${r.situacao.coberturaPacienteId ?? ''}).`,
      });
    }
    const desconto = r.desconto?.valor ?? 0;
    if (r.desconto && desconto > 0) {
      s += 1;
      await tx.incluir('conta_hospitalar_franquia', {
        conta_hospitalar_id: e.contaId,
        sequencia: s,
        tipo: 'desconto_volume',
        regra_desconto_volume_id: r.desconto.regraId,
        valor: desconto,
        observacao: `Desconto por volume (${r.desconto.medida} ${r.desconto.volume.toFixed(2)}).`,
      });
    }
    // A franquia é do paciente e sai do total da fonte; o desconto por volume sai do total da fonte (e da guia TISS).
    const somaTipo = (t: string) =>
      r2(anteriores.filter((x) => x['tipo'] === t).reduce((a, x) => a + n(x['valor']), 0));
    const efeito = efeitoComercialNaConta(
      {
        valorItens: n(cab?.['valor_itens']),
        valorAcrescimo: n(cab?.['valor_acrescimo']),
        valorDesconto: n(cab?.['valor_desconto']),
        valorPaciente: n(cab?.['valor_paciente']),
      },
      { franquia: somaTipo('franquia'), desconto: somaTipo('desconto_volume') },
      { franquia, desconto: r.desconto && desconto > 0 ? desconto : 0 },
    );
    await tx.alterar('conta_hospitalar', e.contaId, n(cab?.['versao']), {
      valor_desconto: efeito.valorDesconto,
      valor_paciente: efeito.valorPaciente,
      valor_total: efeito.valorTotal,
    });
    return {
      contaId: e.contaId,
      franquia,
      desconto,
      substituidas: anteriores.length,
      valorTotal: efeito.valorTotal,
      valorPaciente: efeito.valorPaciente,
    };
  },
  alvo: (e) => ({ tabela: 'conta_hospitalar', id: e.contaId }),
});

/**
 * O abatimento comercial vigente da conta (desconto por volume e franquia aplicados) e o fator de redução da guia TISS
 * (reducaoAcrescimo) sobre o bruto da guia. Sem abatimento, fator null (a guia segue com 1.00).
 */
export async function abatimentoComercialDaConta(
  l: Pick<Consulta, 'uma'>,
  contaId: number,
  bruto: number,
): Promise<{ abatimento: number; fator: number | null }> {
  const a = await l.uma<Linha>(
    `SELECT COALESCE(SUM(valor), 0) AS v FROM conta_hospitalar_franquia
      WHERE conta_hospitalar_id = ? AND excluido_em IS NULL AND tipo IN ('franquia','desconto_volume')`,
    [contaId],
  );
  const abatimento = r2(n(a?.['v']));
  const f = fatorReducaoGuia(bruto, abatimento);
  return { abatimento, fator: f === 1 ? null : f };
}

// ── Linha 23: remoção em ambulância e ligação tarifada ────────────────────────────────────────────────

export const esquemaSalvarRegraAmbulancia = z.object({
  id: id.optional(),
  versao: versaoZ,
  fontePagadoraId: idN,
  categoriaAmbulanciaId: id,
  forma: z.enum(['quilometro', 'trajeto']),
  rotaId: idN,
  itemId: id,
  ativo: z.boolean().default(true),
});
export const opSalvarRegraAmbulancia = definirOperacao({
  nome: 'faturamento.salvar-regra-cobranca-ambulancia',
  tabelas: ['regra_cobranca_ambulancia'],
  entrada: esquemaSalvarRegraAmbulancia,
  async gravar(tx, e) {
    const est = estDe(tx.contexto);
    if (e.forma === 'trajeto' && !e.rotaId)
      throw recusa('entrada-invalida', 'A cobrança por trajeto pede o trajeto.', { campos: ['rotaId'] });
    const valores = {
      fonte_pagadora_id: e.fontePagadoraId,
      categoria_ambulancia_id: e.categoriaAmbulanciaId,
      forma_cobranca: e.forma,
      rota_ambulancia_id: e.forma === 'trajeto' ? e.rotaId : null,
      item_faturavel_id: e.itemId,
      ativo: e.ativo,
    };
    const igual = await tx.uma<Linha>(
      `SELECT id FROM regra_cobranca_ambulancia WHERE estabelecimento_id = ? AND fonte_pagadora_id <=> ?
          AND categoria_ambulancia_id = ? AND forma_cobranca = ? AND rota_ambulancia_id <=> ? AND id <> ?`,
      [
        est,
        valores.fonte_pagadora_id,
        e.categoriaAmbulanciaId,
        e.forma,
        valores.rota_ambulancia_id,
        e.id ?? 0,
      ],
    );
    if (igual)
      throw recusa('entrada-invalida', 'Já existe regra para esta fonte, ambulância e forma de cobrança.', {
        campos: ['categoriaAmbulanciaId'],
      });
    if (e.id) {
      const atual = await tx.uma<Linha>(
        'SELECT id FROM regra_cobranca_ambulancia WHERE id = ? AND estabelecimento_id = ?',
        [e.id, est],
      );
      if (!atual || !e.versao) throw recusa('nao-encontrado', 'Regra não encontrada.', { campos: ['id'] });
      await tx.alterar('regra_cobranca_ambulancia', e.id, e.versao, valores);
      return { id: e.id };
    }
    return { id: await tx.incluir('regra_cobranca_ambulancia', { estabelecimento_id: est, ...valores }) };
  },
  alvo: (_e, s) => ({ tabela: 'regra_cobranca_ambulancia', id: s.id }),
});

export const esquemaSalvarRegraLigacao = z.object({
  id: id.optional(),
  versao: versaoZ,
  tipoLigacaoId: id,
  codigoTarifador: z.string().trim().max(60).nullable().default(null),
  itemMinutoId: idN,
  itemSegundoId: idN,
  assumeValorTarifador: z.boolean().default(false),
  ativo: z.boolean().default(true),
});
export const opSalvarRegraLigacao = definirOperacao({
  nome: 'faturamento.salvar-regra-cobranca-ligacao',
  tabelas: ['regra_cobranca_ligacao'],
  entrada: esquemaSalvarRegraLigacao,
  async gravar(tx, e) {
    const est = estDe(tx.contexto);
    if (!e.itemMinutoId && !e.itemSegundoId && !e.assumeValorTarifador)
      throw recusa(
        'entrada-invalida',
        'Informe o item por minuto, o item por segundo ou o valor do tarifador.',
        {
          campos: ['itemMinutoId'],
        },
      );
    if (e.assumeValorTarifador && !e.itemMinutoId && !e.itemSegundoId)
      throw recusa('entrada-invalida', 'O valor do tarifador entra na conta por um item: informe-o.', {
        campos: ['itemMinutoId'],
      });
    const valores = {
      tipo_ligacao_tarifada_id: e.tipoLigacaoId,
      codigo_tarifador: e.codigoTarifador,
      item_faturavel_minuto_id: e.itemMinutoId,
      item_faturavel_segundo_id: e.itemSegundoId,
      assume_valor_tarifador: e.assumeValorTarifador,
      ativo: e.ativo,
    };
    const igual = await tx.uma<Linha>(
      'SELECT id, versao FROM regra_cobranca_ligacao WHERE estabelecimento_id = ? AND tipo_ligacao_tarifada_id = ?',
      [est, e.tipoLigacaoId],
    );
    if (igual && n(igual['id']) !== (e.id ?? 0)) {
      if (e.id)
        throw recusa('entrada-invalida', 'Já existe regra para este tipo de ligação.', {
          campos: ['tipoLigacaoId'],
        });
      await tx.alterar('regra_cobranca_ligacao', n(igual['id']), n(igual['versao']), valores);
      return { id: n(igual['id']) };
    }
    if (e.id) {
      if (!igual || !e.versao) throw recusa('nao-encontrado', 'Regra não encontrada.', { campos: ['id'] });
      await tx.alterar('regra_cobranca_ligacao', e.id, e.versao, valores);
      return { id: e.id };
    }
    return { id: await tx.incluir('regra_cobranca_ligacao', { estabelecimento_id: est, ...valores }) };
  },
  alvo: (_e, s) => ({ tabela: 'regra_cobranca_ligacao', id: s.id }),
});

export const esquemaRegistrarLigacao = z.object({
  atendimentoId: id,
  ramalId: idN,
  tipoLigacaoId: id,
  iniciadaEm: z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/),
  duracaoSegundos: z.number().int().min(0).max(86400),
  ddi: z.string().trim().max(5).nullable().default(null),
  ddd: z.string().trim().max(5).nullable().default(null),
  telefone: z.string().trim().min(3).max(20),
  valor: z.number().min(0).nullable().default(null),
});
export const opRegistrarLigacao = definirOperacao({
  nome: 'faturamento.registrar-ligacao-tarifada',
  tabelas: ['ligacao_tarifada'],
  entrada: esquemaRegistrarLigacao,
  async gravar(tx, e) {
    const est = estDe(tx.contexto);
    const a = await tx.uma<Linha>(
      'SELECT id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [e.atendimentoId, est],
    );
    if (!a) throw recusa('nao-encontrado', 'Atendimento não encontrado.', { campos: ['atendimentoId'] });
    const t = await tx.uma<Linha>(
      'SELECT abrangencia FROM tipo_ligacao_tarifada WHERE id = ? AND ativo = 1',
      [e.tipoLigacaoId],
    );
    if (!t) throw recusa('entrada-invalida', 'Tipo de ligação desconhecido.', { campos: ['tipoLigacaoId'] });
    const regra = await tx.uma<Linha>(
      'SELECT id FROM regra_cobranca_ligacao WHERE estabelecimento_id = ? AND tipo_ligacao_tarifada_id = ?',
      [est, e.tipoLigacaoId],
    );
    const lid = await tx.incluir('ligacao_tarifada', {
      estabelecimento_id: est,
      atendimento_id: e.atendimentoId,
      ramal_telefonico_id: e.ramalId,
      regra_cobranca_ligacao_id: nn(regra?.['id']),
      tipo_ligacao_tarifada_id: e.tipoLigacaoId,
      tipo_ligacao: tipoDaLigacao(String(t['abrangencia'])),
      iniciada_em: e.iniciadaEm.replace('T', ' '),
      duracao_segundos: e.duracaoSegundos,
      ddi: e.ddi,
      ddd: e.ddd,
      telefone_destino: e.telefone,
      valor: e.valor,
      situacao: 'pendente',
    });
    return { id: lid };
  },
  alvo: (_e, s) => ({ tabela: 'ligacao_tarifada', id: s.id }),
});

const TABELAS_ITEM = ['conta_hospitalar_item', 'conta_hospitalar_item_memoria', 'conta_hospitalar'];
/** Lança um item na conta com o preço da tabela vigente (ou o unitário informado), com a memória do cálculo. */
async function lancarItem(
  tx: TxOperacao,
  c: Linha,
  est: number,
  item: number,
  quantidade: number,
  unitarioFixo: number | null,
  data: string,
  dados: Record<string, unknown>,
): Promise<{ id: number }> {
  const i = await tx.uma<Linha>(
    "SELECT id, codigo, grupo_faturamento_id FROM item_faturavel WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
    [item],
  );
  if (!i) throw recusa('item-inativo', 'O item da regra está inativo ou fora do catálogo.', { campos: [] });
  const preco =
    unitarioFixo === null
      ? await precoVigente(
          tx,
          await tabelasDePreco(
            tx,
            est,
            n(c['fonte_pagadora_id']),
            nn(c['plano_fonte_pagadora_id']),
            nn(c['tabela_preco_id']),
          ),
          item,
          data,
        )
      : null;
  if (unitarioFixo === null && !preco)
    throw recusa(
      'sem-preco',
      `O item ${String(i['codigo'])} da regra não tem preço vigente em ${data} na tabela da fonte pagadora da conta: cadastre o preço e lance de novo.`,
      { campos: ['itemFaturavelId'] },
    );
  const unitario = unitarioFixo ?? preco?.unitario ?? 0;
  const total = r2(unitario * quantidade);
  const seq = await tx.uma<Linha>(
    'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM conta_hospitalar_item WHERE conta_hospitalar_id = ?',
    [c['id']],
  );
  const agora = new Date();
  const novo = await tx.incluir('conta_hospitalar_item', {
    conta_hospitalar_id: c['id'],
    sequencia: n(seq?.['s']),
    item_faturavel_id: item,
    grupo_faturamento_id: nn(i['grupo_faturamento_id']),
    realizado_em: `${data} 00:00:00`,
    quantidade,
    valor_unitario: unitario,
    valor_total: total,
    tipo_valorizacao: preco ? 'tabela' : 'manual',
    situacao: 'lancado',
  });
  await tx.incluir('conta_hospitalar_item_memoria', {
    conta_hospitalar_item_id: novo,
    tabela_preco_id: preco?.tabela ?? null,
    valor_unitario_calculado: unitario,
    valor_total_calculado: total,
    preco_manual: unitarioFixo !== null ? 1 : 0,
    operacao: 'inclusao',
    dados: JSON.stringify({
      ...dados,
      origemPreco: preco ? 'tabela' : 'tarifador',
    }),
    ocorrido_em: agora,
    usuario_id: tx.contexto.usuario,
  });
  return { id: novo };
}

export const esquemaLancarRemocao = z.object({
  contaId: id,
  categoriaAmbulanciaId: id,
  rotaId: idN,
  km: z.number().positive().max(100000).nullable().default(null),
  comVolta: z.boolean().default(false),
  data: dataZ.optional(),
});
export const opLancarRemocao = definirOperacao({
  nome: 'faturamento.lancar-remocao-ambulancia',
  tabelas: TABELAS_ITEM,
  entrada: esquemaLancarRemocao,
  gravar: (tx, e) => lancarRemocaoNaConta(tx, estDe(tx.contexto), e),
  alvo: (e) => ({ tabela: 'conta_hospitalar', id: e.contaId }),
});

/** Tabelas que o lançamento da remoção grava (para quem lança a remoção de outra operação, como o chamado). */
export const TABELAS_LANCAR_REMOCAO: readonly string[] = TABELAS_ITEM;

/**
 * Lança a remoção por ambulância na conta pela regra de cobrança (trajeto ou quilômetro, da fonte da conta ou a padrão).
 * Toda recusa (conta fechada, trajeto, regra, item ou preço) acontece antes de gravar qualquer linha.
 */
export async function lancarRemocaoNaConta(
  tx: TxOperacao,
  est: number,
  e: Omit<z.infer<typeof esquemaLancarRemocao>, 'data'> & { data?: string | undefined },
  dados: Record<string, unknown> = {},
): Promise<{ contaId: number; itemId: number; regraId: number; quantidade: number }> {
  const c = await contaDa(tx, est, e.contaId);
  if (!contaEditavel(String(c['situacao'])))
    throw recusa('conta-fechada', 'A conta não está aberta: a remoção não entra nela.', { campos: [] });
  await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ?', [c['id']]);
  const rota = e.rotaId
    ? await tx.uma<Linha>(
        'SELECT id, distancia_km, ida_e_volta FROM rota_ambulancia WHERE id = ? AND estabelecimento_id = ? AND ativo = 1',
        [e.rotaId, est],
      )
    : null;
  if (e.rotaId && !rota) throw recusa('nao-encontrado', 'Trajeto não encontrado.', { campos: ['rotaId'] });
  const regras = (
    await tx.consultar<Linha>(
      'SELECT * FROM regra_cobranca_ambulancia WHERE estabelecimento_id = ? AND categoria_ambulancia_id = ?',
      [est, e.categoriaAmbulanciaId],
      { teto: 500 },
    )
  ).map((r) => ({
    id: n(r['id']),
    fonte: nn(r['fonte_pagadora_id']),
    categoria: n(r['categoria_ambulancia_id']),
    forma: String(r['forma_cobranca']) as 'quilometro' | 'trajeto',
    rota: nn(r['rota_ambulancia_id']),
    item: n(r['item_faturavel_id']),
    ativo: bool(r['ativo']),
  }));
  const cob = cobrancaRemocao(regras, {
    fonte: n(c['fonte_pagadora_id']),
    categoria: e.categoriaAmbulanciaId,
    rota: rota
      ? { id: n(rota['id']), distanciaKm: n(rota['distancia_km']), idaEVolta: bool(rota['ida_e_volta']) }
      : null,
    km: e.km,
    comVolta: e.comVolta,
  });
  exigirValido(cob.erros);
  const regra = cob.regra as NonNullable<typeof cob.regra>;
  const l = await lancarItem(tx, c, est, regra.item, cob.quantidade, null, e.data ?? hoje(), {
    origem: 'remocao_ambulancia',
    regra: regra.id,
    forma: regra.forma,
    rota: e.rotaId,
    km: e.km,
    comVolta: e.comVolta,
    ...dados,
  });
  await tx.alterar('conta_hospitalar', n(c['id']), n(c['versao']), await totalDosItens(tx, n(c['id'])));
  return {
    contaId: e.contaId,
    itemId: l.id,
    regraId: regra.id,
    quantidade: cob.quantidade,
  };
}

export const esquemaLancarLigacoes = z.object({ contaId: id });
export const opLancarLigacoes = definirOperacao({
  nome: 'faturamento.lancar-ligacoes-conta',
  tabelas: [...TABELAS_ITEM, 'ligacao_tarifada'],
  entrada: esquemaLancarLigacoes,
  async gravar(tx, e) {
    const est = estDe(tx.contexto);
    const c = await contaDa(tx, est, e.contaId);
    if (!contaEditavel(String(c['situacao'])))
      throw recusa('conta-fechada', 'A conta não está aberta: as ligações não entram nela.', { campos: [] });
    if (c['atendimento_id'] === null)
      throw recusa('entrada-invalida', 'A conta não tem atendimento: não há ligações a cobrar.', {
        campos: [],
      });
    await tx.consultarParaAtualizar('SELECT id FROM conta_hospitalar WHERE id = ?', [c['id']]);
    const ls = await tx.consultarParaAtualizar<Linha>(
      `SELECT l.id, l.versao, l.duracao_segundos, l.valor, l.iniciada_em, r.id AS regra, r.item_faturavel_minuto_id,
              r.item_faturavel_segundo_id, r.assume_valor_tarifador, r.ativo AS regra_ativa, t.id AS tipo, t.cobravel
         FROM ligacao_tarifada l
         LEFT JOIN regra_cobranca_ligacao g ON g.id = l.regra_cobranca_ligacao_id
         LEFT JOIN tipo_ligacao_tarifada t ON t.id = COALESCE(l.tipo_ligacao_tarifada_id, g.tipo_ligacao_tarifada_id)
         LEFT JOIN regra_cobranca_ligacao r ON r.estabelecimento_id = l.estabelecimento_id AND r.tipo_ligacao_tarifada_id = t.id
        WHERE l.atendimento_id = ? AND l.estabelecimento_id = ? AND l.situacao = 'pendente' AND l.excluido_em IS NULL
        ORDER BY l.iniciada_em, l.id`,
      [c['atendimento_id'], est],
      { teto: 5000 },
    );
    let lancadas = 0;
    let naoCobradas = 0;
    for (const x of ls) {
      const regra =
        x['regra'] === null
          ? null
          : {
              id: n(x['regra']),
              itemMinuto: nn(x['item_faturavel_minuto_id']),
              itemSegundo: nn(x['item_faturavel_segundo_id']),
              assumeValorTarifador: bool(x['assume_valor_tarifador']),
              ativo: bool(x['regra_ativa']),
            };
      // A regra é a vigente do tipo hoje (não a gravada no registro): a ligação registrada antes da regra entra
      // assim que o faturista a cria. O tipo não cobrável fica marcado mesmo sem regra.
      const cob = cobrancaLigacao(regra, x['tipo'] === null ? true : bool(x['cobravel']), {
        duracaoSegundos: n(x['duracao_segundos']),
        valorTarifador: nn(x['valor']),
      });
      if (!cob.cobra || cob.item === null) {
        // Sem regra a ligação continua pendente (aparece para o faturista); as demais ficam marcadas, com o motivo.
        if (cob.motivo === 'sem_regra') continue;
        await tx.alterar('ligacao_tarifada', n(x['id']), n(x['versao']), {
          situacao: 'nao_cobrada',
          regra_cobranca_ligacao_id: regra?.id ?? null,
        });
        naoCobradas += 1;
        continue;
      }
      const l = await lancarItem(
        tx,
        c,
        est,
        cob.item,
        cob.quantidade,
        cob.unitario,
        dia(x['iniciada_em']) ?? hoje(),
        {
          origem: 'ligacao_tarifada',
          ligacao: n(x['id']),
          regra: regra?.id ?? null,
          duracaoSegundos: n(x['duracao_segundos']),
        },
      );
      await tx.alterar('ligacao_tarifada', n(x['id']), n(x['versao']), {
        situacao: 'lancada',
        regra_cobranca_ligacao_id: regra?.id ?? null,
        lancamento_conta_hospitalar_item_id: l.id,
      });
      lancadas += 1;
    }
    if (lancadas)
      await tx.alterar('conta_hospitalar', n(c['id']), n(c['versao']), await totalDosItens(tx, n(c['id'])));
    return { contaId: e.contaId, lancadas, naoCobradas, pendentes: ls.length - lancadas - naoCobradas };
  },
  alvo: (e) => ({ tabela: 'conta_hospitalar', id: e.contaId }),
});

// ── Leituras para a tela ──────────────────────────────────────────────────────────────────────────────

/** Tudo o que a tela de regras comerciais precisa: as regras de cada função e as opções dos combos. */
export async function regrasComerciaisPropria(l: Leitor, est: number) {
  const opcoes = async (sql: string, p: unknown[] = []) =>
    (await l.consultar<Linha>(sql, p, { teto: 1000 })).map((x) => ({
      id: n(x['id']),
      descricao: String(x['d']),
    }));
  const descontos = await l.consultar<Linha>(
    'SELECT * FROM regra_desconto_volume WHERE estabelecimento_id = ? ORDER BY id',
    [est],
    { teto: 500 },
  );
  const faixas = descontos.length
    ? await l.consultar<Linha>(
        `SELECT * FROM regra_desconto_volume_faixa WHERE regra_desconto_volume_id IN (${lista(descontos.length)})
            AND excluido_em IS NULL ORDER BY sequencia`,
        descontos.map((d) => d['id']),
        { teto: 5000 },
      )
    : [];
  const contratos = await l.consultar<Linha>(
    `SELECT id, numero, descricao FROM contrato_fonte_pagadora WHERE estabelecimento_id = ? AND excluido_em IS NULL
      ORDER BY numero`,
    [est],
    { teto: 1000 },
  );
  const franquias = [];
  for (const c of contratos)
    for (const f of await franquiasDoContrato(l, n(c['id'])))
      franquias.push({ ...f, contratoId: n(c['id']) });
  return {
    regrasConta: await regrasContaDo(l, est),
    descontos: descontos.map((d) => ({
      id: n(d['id']),
      versao: n(d['versao']),
      fontePagadoraId: n(d['fonte_pagadora_id']),
      planoId: nn(d['plano_fonte_pagadora_id']),
      descricao: String(d['descricao']),
      baseVolume: String(d['base_volume']),
      vigenciaInicio: dia(d['vigencia_inicio']),
      vigenciaFim: dia(d['vigencia_fim']),
      ativo: bool(d['ativo']),
      faixas: faixas
        .filter((f) => n(f['regra_desconto_volume_id']) === n(d['id']))
        .map((f) => ({
          sequencia: n(f['sequencia']),
          volumeInicial: n(f['volume_inicial']),
          volumeFinal: nn(f['volume_final']),
          tipo: String(f['tipo_desconto']),
          percentual: nn(f['percentual_desconto']),
          valor: nn(f['valor_desconto']),
          grupoId: nn(f['grupo_faturamento_id']),
          itemId: nn(f['item_faturavel_id']),
          setorId: nn(f['setor_funcional_id']),
        })),
    })),
    franquias,
    ambulancia: (
      await l.consultar<Linha>(
        'SELECT * FROM regra_cobranca_ambulancia WHERE estabelecimento_id = ? ORDER BY id',
        [est],
        { teto: 500 },
      )
    ).map((r) => ({
      id: n(r['id']),
      versao: n(r['versao']),
      fontePagadoraId: nn(r['fonte_pagadora_id']),
      categoriaAmbulanciaId: n(r['categoria_ambulancia_id']),
      forma: String(r['forma_cobranca']),
      rotaId: nn(r['rota_ambulancia_id']),
      itemId: n(r['item_faturavel_id']),
      ativo: bool(r['ativo']),
    })),
    ligacao: (
      await l.consultar<Linha>(
        'SELECT * FROM regra_cobranca_ligacao WHERE estabelecimento_id = ? ORDER BY id',
        [est],
        { teto: 500 },
      )
    ).map((r) => ({
      id: n(r['id']),
      versao: n(r['versao']),
      tipoLigacaoId: n(r['tipo_ligacao_tarifada_id']),
      codigoTarifador: txt(r['codigo_tarifador']),
      itemMinutoId: nn(r['item_faturavel_minuto_id']),
      itemSegundoId: nn(r['item_faturavel_segundo_id']),
      assumeValorTarifador: bool(r['assume_valor_tarifador']),
      ativo: bool(r['ativo']),
    })),
    opcoes: {
      fontes: await opcoes(
        'SELECT id, nome AS d FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome',
      ),
      contratos: contratos.map((c) => ({
        id: n(c['id']),
        descricao: `${c['numero']} ${c['descricao'] ?? ''}`.trim(),
      })),
      origensEntrada: await opcoes(
        'SELECT id, descricao AS d FROM origem_entrada_atendimento WHERE ativo = 1 ORDER BY descricao',
      ),
      categoriasAtendimento: await opcoes(
        'SELECT id, descricao AS d FROM categoria_atendimento WHERE ativo = 1 ORDER BY descricao',
      ),
      setores: await opcoes(
        'SELECT id, nome AS d FROM setor_funcional WHERE excluido_em IS NULL ORDER BY nome',
      ),
      grupos: await opcoes(
        'SELECT id, descricao AS d FROM grupo_faturamento WHERE ativo = 1 ORDER BY descricao',
      ),
      categoriasAmbulancia: await opcoes(
        'SELECT id, descricao AS d FROM categoria_ambulancia WHERE ativo = 1 ORDER BY descricao',
      ),
      rotas: await opcoes(
        `SELECT id, CONCAT(descricao, ' (', distancia_km, ' km)') AS d FROM rota_ambulancia
          WHERE estabelecimento_id = ? AND ativo = 1 ORDER BY descricao`,
        [est],
      ),
      tiposLigacao: await opcoes(
        'SELECT id, descricao AS d FROM tipo_ligacao_tarifada WHERE ativo = 1 ORDER BY descricao',
      ),
    },
  };
}

/** Serviços acessórios e cálculo comercial da conta: ligações do atendimento e o que foi aplicado. */
export async function comercialDaContaPropria(
  l: Leitor,
  est: number,
  contaId: number,
  simulacao: string | null = null,
) {
  if (simulacao !== null && !(VINCULOS_BENEFICIARIO as readonly string[]).includes(simulacao))
    throw recusa('entrada-invalida', 'Vínculo de simulação inválido: titular, dependente ou pensionista.', {
      campos: ['vinculo'],
    });
  const calc = await calculoComercialConta(l, est, contaId, simulacao as VinculoBeneficiario | null);
  const c = calc.conta;
  const ligacoes = c['atendimento_id']
    ? (
        await l.consultar<Linha>(
          `SELECT id, tipo_ligacao, iniciada_em, duracao_segundos, valor, situacao, lancamento_conta_hospitalar_item_id
             FROM ligacao_tarifada WHERE atendimento_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
            ORDER BY iniciada_em, id`,
          [c['atendimento_id'], est],
          { teto: 5000 },
        )
      ).map((x) => ({
        id: n(x['id']),
        tipo: String(x['tipo_ligacao']),
        iniciadaEm: String(
          x['iniciada_em'] instanceof Date ? (x['iniciada_em'] as Date).toISOString() : x['iniciada_em'],
        ),
        duracaoSegundos: n(x['duracao_segundos']),
        valor: nn(x['valor']),
        situacao: String(x['situacao']),
        itemId: nn(x['lancamento_conta_hospitalar_item_id']),
      }))
    : [];
  const aplicados = (
    await l.consultar<Linha>(
      `SELECT id, sequencia, tipo, valor, observacao, excluido_em FROM conta_hospitalar_franquia
        WHERE conta_hospitalar_id = ? ORDER BY sequencia`,
      [contaId],
      { teto: 1000 },
    )
  ).map((x) => ({
    id: n(x['id']),
    sequencia: n(x['sequencia']),
    tipo: String(x['tipo']),
    valor: n(x['valor']),
    observacao: txt(x['observacao']),
    vigente: x['excluido_em'] === null,
  }));
  return {
    conta: {
      id: n(c['id']),
      numero: String(c['numero']),
      situacao: String(c['situacao']),
      atendimentoId: nn(c['atendimento_id']),
      // Valores da conta: o total é o cobrado da fonte pagadora; a parte do paciente é a franquia (06-FAT linha 19).
      valorItens: n(c['valor_itens']),
      valorAcrescimo: n(c['valor_acrescimo']),
      valorDesconto: n(c['valor_desconto']),
      valorPaciente: n(c['valor_paciente']),
      valorTotal: n(c['valor_total']),
    },
    previa: { franquia: calc.franquia, desconto: calc.desconto, situacao: calc.situacao },
    aplicados,
    ligacoes,
  };
}

export const OPERACOES_REGRAS_COMERCIAIS = {
  'salvar-regra-conta': opSalvarRegraConta,
  'salvar-desconto-volume': opSalvarDescontoVolume,
  'salvar-franquia': opSalvarFranquia,
  'aplicar-comercial': opAplicarComercial,
  'salvar-regra-ambulancia': opSalvarRegraAmbulancia,
  'salvar-regra-ligacao': opSalvarRegraLigacao,
  'registrar-ligacao': opRegistrarLigacao,
  'lancar-remocao': opLancarRemocao,
  'lancar-ligacoes': opLancarLigacoes,
} as const;
export type NomeOperacaoRegrasComerciais = keyof typeof OPERACOES_REGRAS_COMERCIAIS;

export async function gravarRegrasComerciais(
  executor: Executor,
  nome: NomeOperacaoRegrasComerciais,
  ctx: ContextoOperacao,
  entrada: unknown,
): Promise<Record<string, unknown>> {
  const op = OPERACOES_REGRAS_COMERCIAIS[nome] as Parameters<Executor['executar']>[0];
  const r = await executor.executar(op, ctx.cliente, entrada, ctx);
  return r.resultado as Record<string, unknown>;
}
