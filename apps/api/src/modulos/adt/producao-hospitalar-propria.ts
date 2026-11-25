// Produção hospitalar mensal e valor da categoria clínica (F8, 09-AREA linha 87), no banco do cliente. As regras são
// do domínio (@sgh/dominio-internacao, producao-hospitalar; Portaria MS 312/2002); a porta lê e grava:
// - faixa_valor_categoria_clinica (migração 07_INT/94_producao_hospitalar): a faixa nova encerra na véspera a anterior
//   da mesma categoria e abrangência; a que começa no mesmo dia ou depois recusa (nada se apaga);
// - atendimento_categoria_clinica: o novo período encerra o vigente no instante da troca (com o valor pela faixa de
//   cada dia) e começa aberto; se o paciente já saiu, já nasce encerrado na saída com o valor;
// - producao_hospitalar_mensal: a apuração do mês por categoria e o total (clínica nula), a partir das internações,
//   dos períodos de categoria, dos leitos operacionais e das faixas; reapurada enquanto aberta, fechada não muda.
import {
  apurarProducaoMensal,
  type FaixaValorCategoria,
  type IndicadoresProducao,
  type InternacaoProducao,
  limitesDoMes,
  type LeitosClinica,
  mesValido,
  type PeriodoCategoria,
  type ProducaoMensal,
  type TipoSaidaProducao,
  validarFaixaValor,
  validarPeriodoCategoria,
  valorDoPeriodo,
} from '@sgh/dominio-internacao';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type Operacao,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';

export const PORTA_PRODUCAO_HOSPITALAR = Symbol('PORTA_PRODUCAO_HOSPITALAR');

const T_FAIXA = 'faixa_valor_categoria_clinica';
const T_PERIODO = 'atendimento_categoria_clinica';
const T_PRODUCAO = 'producao_hospitalar_mensal';

const num = (v: unknown): number => Number(v);
const numN = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const p2 = (n: number) => String(n).padStart(2, '0');
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`
      : String(v).slice(0, 10);
/** Instante local AAAA-MM-DDTHH:MM:SS (como o banco guarda). */
const instanteIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? `${dataIso(v)}T${p2(v.getHours())}:${p2(v.getMinutes())}:${p2(v.getSeconds())}`
      : String(v).replace(' ', 'T').slice(0, 19);
const paraBanco = (iso: string): string => iso.replace('T', ' ').slice(0, 19);
const vespera = (d: string): string => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};
const TIPOS_SAIDA: readonly TipoSaidaProducao[] = ['alta', 'transferencia', 'obito', 'evasao'];
const tipoSaida = (v: unknown): TipoSaidaProducao | null =>
  v === null || v === undefined
    ? null
    : TIPOS_SAIDA.includes(String(v) as TipoSaidaProducao)
      ? (String(v) as TipoSaidaProducao)
      : 'outra';

async function agoraDoBanco(l: Leitor): Promise<{ hoje: string; agora: string }> {
  const r = await l.uma<Linha>('SELECT NOW(3) AS agora');
  const agora = instanteIso(r?.['agora']) ?? new Date().toISOString().slice(0, 19);
  return { hoje: agora.slice(0, 10), agora };
}

/** As faixas que valem para o estabelecimento: as próprias da categoria; sem próprias, as de todos. */
async function lerFaixas(l: Leitor, est: number): Promise<(FaixaValorCategoria & FaixaLinha)[]> {
  const ls = await l.consultar<Linha>(
    `SELECT f.id, f.clinica_assistencial_id, f.estabelecimento_id, f.vigencia_inicio, f.vigencia_fim, f.valor_diaria,
            f.observacao, f.versao, c.descricao AS clinica
       FROM faixa_valor_categoria_clinica f JOIN clinica_assistencial c ON c.id = f.clinica_assistencial_id
      WHERE f.estabelecimento_id = ? OR f.estabelecimento_id IS NULL
      ORDER BY c.descricao, f.vigencia_inicio`,
    [est],
    { teto: 5000 },
  );
  const todas = ls.map((x) => ({
    id: num(x['id']),
    clinicaId: num(x['clinica_assistencial_id']),
    clinica: String(x['clinica']),
    todasUnidades: x['estabelecimento_id'] === null,
    inicio: dataIso(x['vigencia_inicio']) ?? '',
    fim: dataIso(x['vigencia_fim']),
    valorDiaria: Number(x['valor_diaria']),
    observacao: x['observacao'] === null ? null : String(x['observacao']),
    versao: num(x['versao']),
  }));
  const comPropria = new Set(todas.filter((f) => !f.todasUnidades).map((f) => f.clinicaId));
  return todas.filter((f) => !f.todasUnidades || !comPropria.has(f.clinicaId));
}

interface FaixaLinha {
  readonly id: number;
  readonly clinica: string;
  readonly todasUnidades: boolean;
  readonly observacao: string | null;
  readonly versao: number;
}

/** Lê o mês e apura pelo domínio (nada gravado). */
async function apurar(l: Leitor, est: number, mes: string, hoje: string): Promise<ProducaoMensal> {
  const { de, ate: fimMes } = limitesDoMes(mes);
  const ontem = vespera(hoje);
  const ate = fimMes < hoje ? fimMes : ontem;
  const leitos: LeitosClinica[] = (
    await l.consultar<Linha>(
      `SELECT ui.clinica_assistencial_id AS clinica, COUNT(*) AS n
         FROM leito_hospitalar lh JOIN unidade_internacao ui ON ui.id = lh.unidade_internacao_id
        WHERE lh.estabelecimento_id = ? AND lh.ativo AND NOT lh.extra AND NOT lh.virtual AND lh.excluido_em IS NULL
          AND (lh.data_ativacao IS NULL OR lh.data_ativacao <= ?) AND (lh.data_desativacao IS NULL OR lh.data_desativacao > ?)
        GROUP BY ui.clinica_assistencial_id`,
      [est, ate, de],
      { teto: 500 },
    )
  ).map((x) => ({ clinicaId: numN(x['clinica']), leitos: num(x['n']) }));
  const ints = await l.consultar<Linha>(
    `SELECT i.atendimento_id, i.data_hora_entrada, i.data_hora_alta, i.data_prevista_alta, m.tipo_saida,
            COALESCE(a.clinica_assistencial_id, ui.clinica_assistencial_id) AS clinica
       FROM internacao i JOIN atendimento a ON a.id = i.atendimento_id
       JOIN unidade_internacao ui ON ui.id = i.unidade_internacao_id
       LEFT JOIN motivo_saida_hospitalar m ON m.id = i.motivo_saida_hospitalar_id
      WHERE i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.situacao <> 'cancelada'
        AND i.data_hora_entrada < ? + INTERVAL 1 DAY AND (i.data_hora_alta IS NULL OR i.data_hora_alta >= ?)`,
    [est, ate, de],
    { teto: 200_000 },
  );
  const periodos = new Map<number, PeriodoCategoria[]>();
  const ids = ints.map((x) => num(x['atendimento_id']));
  for (let k = 0; k < ids.length; k += 1000) {
    const lote = ids.slice(k, k + 1000);
    const ps = await l.consultar<Linha>(
      `SELECT atendimento_id, clinica_assistencial_id, inicio_em, fim_em FROM atendimento_categoria_clinica
        WHERE operacao <> 'exclusao' AND atendimento_id IN (${lote.map(() => '?').join(',')})
        ORDER BY atendimento_id, inicio_em`,
      lote,
      { teto: 50_000 },
    );
    for (const p of ps) {
      const a = num(p['atendimento_id']);
      const lista = periodos.get(a) ?? [];
      lista.push({
        clinicaId: num(p['clinica_assistencial_id']),
        inicio: instanteIso(p['inicio_em']) ?? '',
        fim: instanteIso(p['fim_em']),
      });
      periodos.set(a, lista);
    }
  }
  const internacoes: InternacaoProducao[] = ints.map((x) => ({
    entrada: instanteIso(x['data_hora_entrada']) ?? '',
    saida: instanteIso(x['data_hora_alta']),
    tipoSaida: x['data_hora_alta'] === null ? null : tipoSaida(x['tipo_saida']),
    previstaAlta: dataIso(x['data_prevista_alta']),
    clinicaId: numN(x['clinica']),
    periodos: periodos.get(num(x['atendimento_id'])) ?? [],
  }));
  return apurarProducaoMensal({ mes, ate, leitos, internacoes, faixas: await lerFaixas(l, est) });
}

// ---------------------------------------------------------------- entradas

const idP = z.number().int().positive();
const dataP = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instanteP = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/);
const mesP = z.string().regex(/^\d{4}-\d{2}$/);

export const esquemaFaixaCategoria = z
  .object({
    clinicaId: idP,
    inicio: dataP,
    fim: dataP.nullable().default(null),
    valorDiaria: z.number().min(0).max(9_999_999),
    todasUnidades: z.boolean().default(false),
    observacao: z.string().trim().max(400).nullable().default(null),
  })
  .strict();
export type EntradaFaixaCategoria = z.infer<typeof esquemaFaixaCategoria>;

export const esquemaPeriodoCategoria = z
  .object({ atendimentoId: idP, clinicaId: idP, inicio: instanteP })
  .strict();
export type EntradaPeriodoCategoria = z.infer<typeof esquemaPeriodoCategoria>;

export const esquemaApurarProducao = z.object({ mes: mesP, fechar: z.boolean().default(false) }).strict();
export type EntradaApurarProducao = z.infer<typeof esquemaApurarProducao>;

type Gravado = { id: number; versao: number } & ResultadoOperacao;

// ---------------------------------------------------------------- gravações

async function incluirFaixa(tx: TxOperacao, e: EntradaFaixaCategoria, est: number): Promise<Gravado> {
  const erros = validarFaixaValor(e);
  if (Object.keys(erros).length)
    throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos: Object.keys(erros) });
  if (!(await tx.uma('SELECT id FROM clinica_assistencial WHERE id = ? AND ativo', [e.clinicaId])))
    throw recusa('referencia-inexistente', 'A categoria clínica não existe ou está inativa.', {
      campos: ['clinicaId'],
    });
  const estab = e.todasUnidades ? null : est;
  const anteriores = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, vigencia_inicio FROM faixa_valor_categoria_clinica
      WHERE clinica_assistencial_id = ? AND estabelecimento_id <=> ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
    [e.clinicaId, estab, e.inicio],
  );
  for (const r of anteriores)
    if ((dataIso(r['vigencia_inicio']) ?? '') >= e.inicio)
      throw recusa(
        'faixa-sobreposta',
        'Já existe faixa desta categoria que começa nesta data ou depois: escolha um início posterior.',
        { campos: ['inicio'] },
      );
  for (const r of anteriores)
    await tx.alterar(T_FAIXA, num(r['id']), num(r['versao']), { vigencia_fim: vespera(e.inicio) });
  const id = await tx.incluir(T_FAIXA, {
    clinica_assistencial_id: e.clinicaId,
    estabelecimento_id: estab,
    vigencia_inicio: e.inicio,
    vigencia_fim: e.fim,
    valor_diaria: e.valorDiaria,
    observacao: e.observacao || null,
  });
  return { id, versao: 1 };
}

async function classificar(
  tx: TxOperacao,
  e: EntradaPeriodoCategoria,
  ctx: ContextoOperacao,
): Promise<Gravado & { encerrado: number | null }> {
  const est = ctx.estabelecimento as number;
  const a = await tx.uma<Linha>(
    `SELECT a.id, a.entrada_em, a.saida_em, i.data_hora_entrada, i.data_hora_alta, i.situacao
       FROM atendimento a LEFT JOIN internacao i ON i.atendimento_id = a.id AND i.excluido_em IS NULL
      WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
    [e.atendimentoId, est],
  );
  if (!a)
    throw new ErroOperacao(404, 'nao-encontrado', 'Atendimento', 'O atendimento não existe nesta unidade.');
  if (a['situacao'] === 'cancelada')
    throw recusa('internacao-cancelada', 'A internação foi cancelada: a categoria clínica não muda mais.');
  if (!(await tx.uma('SELECT id FROM clinica_assistencial WHERE id = ? AND ativo', [e.clinicaId])))
    throw recusa('referencia-inexistente', 'A categoria clínica não existe ou está inativa.', {
      campos: ['clinicaId'],
    });
  const entrada = instanteIso(a['data_hora_entrada'] ?? a['entrada_em']) ?? '';
  const saida = instanteIso(a['data_hora_alta'] ?? a['saida_em']);
  const vigente = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, clinica_assistencial_id, inicio_em, dados FROM atendimento_categoria_clinica
      WHERE atendimento_id = ? AND operacao <> 'exclusao' ORDER BY inicio_em DESC, id DESC LIMIT 1`,
    [e.atendimentoId],
  );
  const v = vigente[0];
  const inicio = e.inicio.length === 16 ? `${e.inicio}:00` : e.inicio;
  const { agora } = await agoraDoBanco(tx);
  const erros = validarPeriodoCategoria({
    entrada,
    saida,
    inicioVigente: v ? instanteIso(v['inicio_em']) : null,
    inicio,
    agora,
  });
  if (Object.keys(erros).length)
    throw recusa('entrada-invalida', Object.values(erros).join(' '), { campos: Object.keys(erros) });
  if (v && num(v['clinica_assistencial_id']) === e.clinicaId)
    throw recusa('mesma-categoria', 'O paciente já está nesta categoria clínica.', { campos: ['clinicaId'] });
  const faixas = await lerFaixas(tx, est);
  const memoria = (p: PeriodoCategoria, fim: string) => {
    const r = valorDoPeriodo({ ...p, fim }, faixas, fim.slice(0, 10), '1900-01-01', false);
    return {
      valor: r.valor,
      dados: JSON.stringify({ diarias: r.diarias, diasSemFaixa: r.diasSemFaixa, faixas: r.faixas }),
    };
  };
  let encerrado: number | null = null;
  if (v) {
    const m = memoria(
      { clinicaId: num(v['clinica_assistencial_id']), inicio: instanteIso(v['inicio_em']) ?? '', fim: null },
      inicio,
    );
    await tx.alterar(T_PERIODO, num(v['id']), num(v['versao']), {
      fim_em: paraBanco(inicio),
      valor_total: m.valor,
      dados: m.dados,
      operacao: 'alteracao',
      ocorrido_em: paraBanco(agora),
      usuario_id: ctx.usuario ?? null,
    });
    encerrado = num(v['id']);
  }
  const conta = await tx.uma<Linha>(
    'SELECT id FROM conta_hospitalar WHERE atendimento_id = ? AND excluido_em IS NULL ORDER BY id DESC LIMIT 1',
    [e.atendimentoId],
  );
  const fechado = saida ? memoria({ clinicaId: e.clinicaId, inicio, fim: null }, saida) : null;
  const id = await tx.incluir(T_PERIODO, {
    atendimento_id: e.atendimentoId,
    clinica_assistencial_id: e.clinicaId,
    conta_hospitalar_id: conta ? num(conta['id']) : null,
    inicio_em: paraBanco(inicio),
    fim_em: saida ? paraBanco(saida) : null,
    valor_total: fechado?.valor ?? null,
    operacao: 'inclusao',
    dados: fechado?.dados ?? null,
    ocorrido_em: paraBanco(agora),
    usuario_id: ctx.usuario ?? null,
  });
  return { id, versao: 1, encerrado };
}

const colunasIndicadores = (x: IndicadoresProducao) => ({
  leitos_operacionais: x.leitosOperacionais,
  entradas: x.entradas,
  saidas: x.saidas,
  obitos: x.obitos,
  transferencias_externas: x.transferenciasExternas,
  paciente_dia: x.pacienteDia,
  leito_dia: x.leitoDia,
  taxa_ocupacao: x.taxaOcupacao,
  media_permanencia: x.mediaPermanencia,
  giro_leito: x.giroLeito,
  intervalo_substituicao: x.intervaloSubstituicao,
  taxa_mortalidade: x.taxaMortalidade,
  saidas_com_previsao: x.saidasComPrevisao,
  saidas_no_prazo: x.saidasNoPrazo,
  pontualidade_alta: x.pontualidadeAlta,
  valor_produzido: x.valorProduzido,
  dias_sem_faixa: x.diasSemFaixa,
});

async function apurarGravando(
  tx: TxOperacao,
  e: EntradaApurarProducao,
  ctx: ContextoOperacao,
): Promise<Gravado & { linhas: number; situacao: string }> {
  const est = ctx.estabelecimento as number;
  if (!mesValido(e.mes)) throw recusa('entrada-invalida', 'Mês inválido.', { campos: ['mes'] });
  const { hoje, agora } = await agoraDoBanco(tx);
  const { de, ate: fimMes } = limitesDoMes(e.mes);
  if (de >= hoje)
    throw recusa('mes-futuro', 'O mês ainda não começou a ser contado (o dia de hoje não fecha).');
  if (e.fechar && fimMes >= hoje)
    throw recusa('mes-em-curso', 'Só se fecha um mês que já terminou; o mês corrente fica aberto.');
  const competencia = `${e.mes}-01`;
  const existentes = await tx.consultarParaAtualizar<Linha>(
    `SELECT id, versao, clinica_assistencial_id, situacao FROM producao_hospitalar_mensal
      WHERE estabelecimento_id = ? AND competencia = ?`,
    [est, competencia],
  );
  if (existentes.some((x) => x['situacao'] === 'fechada'))
    throw recusa('competencia-fechada', 'A produção deste mês já foi fechada e não muda mais.');
  const r = await apurar(tx, est, e.mes, hoje);
  const zero = apurarProducaoMensal({
    mes: e.mes,
    ate: r.ate,
    leitos: [],
    internacoes: [],
    faixas: [],
  }).total;
  const alvo = new Map<number | null, IndicadoresProducao>([[null, r.total]]);
  for (const c of r.porClinica) if (c.clinicaId !== null) alvo.set(c.clinicaId, c);
  for (const x of existentes) {
    const c = numN(x['clinica_assistencial_id']);
    if (!alvo.has(c)) alvo.set(c, zero);
  }
  const fecho = e.fechar
    ? { situacao: 'fechada', fechado_em: paraBanco(agora), fechado_por: ctx.usuario ?? null }
    : { situacao: 'aberta' };
  let idTotal = 0;
  let versaoTotal = 1;
  for (const [c, ind] of alvo) {
    const valores = {
      apurado_ate: r.ate,
      apurado_em: paraBanco(agora),
      ...colunasIndicadores(ind),
      ...fecho,
    };
    const atual = existentes.find((x) => numN(x['clinica_assistencial_id']) === c);
    let id: number;
    let versao = 1;
    if (atual) {
      id = num(atual['id']);
      versao = await tx.alterar(T_PRODUCAO, id, num(atual['versao']), valores);
    } else
      id = await tx.incluir(T_PRODUCAO, {
        estabelecimento_id: est,
        competencia,
        clinica_assistencial_id: c,
        ...valores,
      });
    if (c === null) {
      idTotal = id;
      versaoTotal = versao;
    }
  }
  return { id: idTotal, versao: versaoTotal, linhas: alvo.size, situacao: fecho.situacao };
}

// ---------------------------------------------------------------- porta

export interface NucleoProducaoHospitalar {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

export interface ContextoProducao {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoProducao = ContextoProducao & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export interface Opcao {
  readonly id: number;
  readonly rotulo: string;
}

export interface LinhaProducaoGravada extends IndicadoresProducao {
  readonly clinicaId: number | null;
  readonly situacao: 'aberta' | 'fechada';
  readonly apuradoAte: string;
  readonly apuradoEm: string;
  readonly fechadoEm: string | null;
  readonly versao: number;
}

export interface PainelProducao {
  readonly mes: string;
  readonly hoje: string;
  readonly situacao: 'nao_apurada' | 'aberta' | 'fechada';
  readonly aoVivo: ProducaoMensal;
  readonly gravada: LinhaProducaoGravada[];
  readonly clinicas: Opcao[];
}

export interface PeriodoCategoriaVisao {
  readonly id: number;
  readonly clinicaId: number;
  readonly clinica: string;
  readonly inicio: string;
  readonly fim: string | null;
  readonly diarias: number;
  readonly valor: number;
  readonly diasSemFaixa: number;
  readonly emAberto: boolean;
  readonly versao: number;
}

export interface CategoriasDoAtendimento {
  readonly atendimento: {
    readonly id: number;
    readonly numero: string;
    readonly entrada: string;
    readonly saida: string | null;
    readonly internado: boolean;
  };
  readonly periodos: PeriodoCategoriaVisao[];
  readonly valorTotal: number;
  readonly clinicas: Opcao[];
}

export type FaixaVisao = FaixaValorCategoria & FaixaLinha & { readonly vigente: boolean };

const ind = (x: Linha): IndicadoresProducao => ({
  leitosOperacionais: num(x['leitos_operacionais']),
  entradas: num(x['entradas']),
  saidas: num(x['saidas']),
  obitos: num(x['obitos']),
  transferenciasExternas: num(x['transferencias_externas']),
  pacienteDia: num(x['paciente_dia']),
  leitoDia: num(x['leito_dia']),
  taxaOcupacao: numN(x['taxa_ocupacao']),
  mediaPermanencia: numN(x['media_permanencia']),
  giroLeito: numN(x['giro_leito']),
  intervaloSubstituicao: numN(x['intervalo_substituicao']),
  taxaMortalidade: numN(x['taxa_mortalidade']),
  saidasComPrevisao: num(x['saidas_com_previsao']),
  saidasNoPrazo: num(x['saidas_no_prazo']),
  pontualidadeAlta: numN(x['pontualidade_alta']),
  valorProduzido: Number(x['valor_produzido']),
  diasSemFaixa: num(x['dias_sem_faixa']),
});

export class PortaProducaoHospitalarPropria {
  private readonly executor: Executor;
  private readonly opFaixa = definirOperacao<EntradaFaixaCategoria, Gravado>({
    nome: 'internacao.incluir_faixa_categoria_clinica',
    tabelas: [T_FAIXA],
    entrada: esquemaFaixaCategoria as unknown as z.ZodType<EntradaFaixaCategoria>,
    gravar: (tx, e, ctx) => incluirFaixa(tx, e, ctx.estabelecimento as number),
    alvo: (_e, r) => ({ tabela: T_FAIXA, id: r.id }),
  });
  private readonly opPeriodo = definirOperacao<
    EntradaPeriodoCategoria,
    Gravado & { encerrado: number | null }
  >({
    nome: 'internacao.classificar_categoria_clinica',
    tabelas: [T_PERIODO],
    entrada: esquemaPeriodoCategoria as unknown as z.ZodType<EntradaPeriodoCategoria>,
    travar: (e) => ({ tabela: 'atendimento', id: e.atendimentoId }),
    gravar: classificar,
    alvo: (_e, r) => ({ tabela: T_PERIODO, id: r.id }),
  });
  private readonly opApurar = definirOperacao<
    EntradaApurarProducao,
    Gravado & { linhas: number; situacao: string }
  >({
    nome: 'internacao.apurar_producao_mensal',
    tabelas: [T_PRODUCAO],
    entrada: esquemaApurarProducao as unknown as z.ZodType<EntradaApurarProducao>,
    gravar: apurarGravando,
    alvo: (_e, r) => ({ tabela: T_PRODUCAO, id: r.id }),
  });

  constructor(
    private readonly nucleo: NucleoProducaoHospitalar,
    private readonly cliente: string,
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'producao-hospitalar' }, fn);
  }

  private async quem(
    l: Leitor,
    c: ContextoProducao,
  ): Promise<{ estabelecimento: number; usuario: number | null }> {
    const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
      c.hospital,
    ]);
    if (!e)
      throw new ErroOperacao(
        403,
        'estabelecimento-desconhecido',
        'Estabelecimento',
        'O estabelecimento da sessão não existe no cliente.',
      );
    const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
    return { estabelecimento: num(e['id']), usuario: u ? num(u['id']) : null };
  }

  private async clinicas(l: Leitor): Promise<Opcao[]> {
    return (
      await l.consultar<Linha>(
        'SELECT id, descricao FROM clinica_assistencial WHERE ativo ORDER BY descricao',
        [],
        {
          teto: 500,
        },
      )
    ).map((x) => ({ id: num(x['id']), rotulo: String(x['descricao']) }));
  }

  /** O mês ao vivo (sem gravar) ao lado do que foi apurado e gravado. */
  painel(c: ContextoProducao, mes: string): Promise<PainelProducao> {
    if (!mesValido(mes)) throw recusa('entrada-invalida', 'Mês inválido.', { campos: ['mes'] });
    return this.ler(async (l) => {
      const { estabelecimento } = await this.quem(l, c);
      const { hoje } = await agoraDoBanco(l);
      if (`${mes}-01` >= hoje) throw recusa('mes-futuro', 'O mês ainda não começou a ser contado.');
      const gravada = (
        await l.consultar<Linha>(
          `SELECT * FROM producao_hospitalar_mensal WHERE estabelecimento_id = ? AND competencia = ?
            ORDER BY clinica_assistencial_id IS NULL, clinica_assistencial_id`,
          [estabelecimento, `${mes}-01`],
        )
      ).map((x) => ({
        ...ind(x),
        clinicaId: numN(x['clinica_assistencial_id']),
        situacao: String(x['situacao']) as 'aberta' | 'fechada',
        apuradoAte: dataIso(x['apurado_ate']) ?? '',
        apuradoEm: instanteIso(x['apurado_em']) ?? '',
        fechadoEm: instanteIso(x['fechado_em']),
        versao: num(x['versao']),
      }));
      const situacao = gravada.length === 0 ? 'nao_apurada' : (gravada[0]?.situacao ?? 'aberta');
      return {
        mes,
        hoje,
        situacao,
        aoVivo: await apurar(l, estabelecimento, mes, hoje),
        gravada,
        clinicas: await this.clinicas(l),
      };
    });
  }

  /** As faixas de valor que valem para a unidade, com a vigente marcada. */
  faixas(c: ContextoProducao): Promise<{ hoje: string; faixas: FaixaVisao[]; clinicas: Opcao[] }> {
    return this.ler(async (l) => {
      const { estabelecimento } = await this.quem(l, c);
      const { hoje } = await agoraDoBanco(l);
      const faixas = (await lerFaixas(l, estabelecimento)).map((f) => ({
        ...f,
        vigente: f.inicio <= hoje && (f.fim === null || f.fim >= hoje),
      }));
      return { hoje, faixas, clinicas: await this.clinicas(l) };
    });
  }

  /** Visão por paciente: os períodos do atendimento (pelo número) em cada categoria, com o valor de cada um. */
  categorias(c: ContextoProducao, numero: string): Promise<CategoriasDoAtendimento> {
    return this.ler(async (l) => {
      const { estabelecimento } = await this.quem(l, c);
      const a = await l.uma<Linha>(
        `SELECT a.id, a.numero, a.entrada_em, a.saida_em, i.data_hora_entrada, i.data_hora_alta, i.situacao
           FROM atendimento a LEFT JOIN internacao i ON i.atendimento_id = a.id AND i.excluido_em IS NULL
          WHERE a.numero = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [numero.trim(), estabelecimento],
      );
      if (!a)
        throw new ErroOperacao(
          404,
          'nao-encontrado',
          'Atendimento',
          'O atendimento não existe nesta unidade.',
        );
      const { hoje } = await agoraDoBanco(l);
      const faixas = await lerFaixas(l, estabelecimento);
      const ps = await l.consultar<Linha>(
        `SELECT p.id, p.clinica_assistencial_id, c.descricao, p.inicio_em, p.fim_em, p.valor_total, p.versao
           FROM atendimento_categoria_clinica p JOIN clinica_assistencial c ON c.id = p.clinica_assistencial_id
          WHERE p.atendimento_id = ? AND p.operacao <> 'exclusao' ORDER BY p.inicio_em, p.id`,
        [num(a['id'])],
      );
      const periodos = ps.map((p) => {
        const inicio = instanteIso(p['inicio_em']) ?? '';
        const fim = instanteIso(p['fim_em']);
        const unico = ps.length === 1;
        const v = valorDoPeriodo(
          { clinicaId: num(p['clinica_assistencial_id']), inicio, fim },
          faixas,
          fim ? fim.slice(0, 10) : hoje,
          '1900-01-01',
          unico,
        );
        return {
          id: num(p['id']),
          clinicaId: num(p['clinica_assistencial_id']),
          clinica: String(p['descricao']),
          inicio,
          fim,
          diarias: v.diarias,
          valor: fim && p['valor_total'] !== null ? Number(p['valor_total']) : v.valor,
          diasSemFaixa: v.diasSemFaixa,
          emAberto: fim === null,
          versao: num(p['versao']),
        };
      });
      return {
        atendimento: {
          id: num(a['id']),
          numero: String(a['numero']),
          entrada: instanteIso(a['data_hora_entrada'] ?? a['entrada_em']) ?? '',
          saida: instanteIso(a['data_hora_alta'] ?? a['saida_em']),
          internado: a['data_hora_entrada'] !== null && a['data_hora_entrada'] !== undefined,
        },
        periodos,
        valorTotal: Math.round(periodos.reduce((s, p) => s + p.valor, 0) * 100) / 100,
        clinicas: await this.clinicas(l),
      };
    });
  }

  private async executar<E, S extends ResultadoOperacao>(
    op: Operacao<E, S>,
    c: ContextoGravacaoProducao,
    entrada: unknown,
    exigencia: string,
  ): Promise<{ resultado: S; repetida: boolean }> {
    const q = await this.ler((l) => this.quem(l, c));
    if (q.usuario === null)
      throw recusa(
        'usuario-sem-conta',
        `${exigencia} exige uma conta de usuário do cliente (o responsável fica no registro).`,
      );
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(op, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }

  incluirFaixa(c: ContextoGravacaoProducao, entrada: unknown) {
    return this.executar(this.opFaixa, c, entrada, 'Incluir a faixa de valor');
  }

  classificar(c: ContextoGravacaoProducao, entrada: unknown) {
    return this.executar(this.opPeriodo, c, entrada, 'Mudar a categoria clínica');
  }

  apurar(c: ContextoGravacaoProducao, entrada: unknown) {
    return this.executar(this.opApurar, c, entrada, 'Apurar a produção');
  }
}
