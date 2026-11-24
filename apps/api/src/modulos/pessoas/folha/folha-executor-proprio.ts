// Gravador próprio do cálculo da folha (modulos-proprios-2, família folha-executor): o que a gravação do cálculo
// escreve e relê na transação, sobre o MariaDB do cliente, com o comportamento da porta de memória.
//   - processamento da folha (processamento_folha e processamento_folha_linha): o vigente com trava, a inclusão com as
//     linhas, a troca de situação pela versão e as releituras; calcular, recalcular ou descartar em período fechado
//     (fechamento_periodo_folha `fechado`) é recusado com `competencia-fechada`;
//   - rescisão (rescisao, ligada ao desligamento do vínculo e ao processamento `rescisao`): as do vínculo com trava, a
//     inclusão (o número complementar seguinte) e a troca de situação pela versão.
// Ficam recusando com `modelo-pendente` (sem lugar no modelo): as férias (programacao_ferias exige o período
// aquisitivo e o tipo de férias e não liga o processamento) e as obrigações (o arquivo cifrado pela porta de
// armazenamento e as situações `entregue`/`substituida`); os parâmetros das obrigações gravam (parametro_obrigacao,
// início AAAA-MM no primeiro dia do mês). O integrador junta este gravador ao de porta-calculo-propria.
// Tipos do processamento: o contrato diz `decimo1`/`decimo2`; o banco, `decimo_terceiro_1`/`decimo_terceiro_2`.
// Quem calculou e quem trocou a situação vêm da auditoria (criado_por e alterado_por), nunca de coluna à parte.
import {
  APURACAO_DO_TIPO,
  esquemaParametrosObrigacoes,
  type ModalidadeRescisao,
  type AvisoPrevio,
  type SituacaoProcessoFolha,
  type SituacaoRescisao,
  TIPO_DO_PAPEL,
  type TipoProcessoFolha,
  type TotaisCalculoFolha,
  type UnidadeLinhaFolha,
  type PapelLinhaFolha,
} from '@sgh/contratos';
import { ErroOperacao, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import { exigirUsuario } from '../../qualidade/apoio-propria.js';
import type { GravadorCalculoFolha } from './porta-calculo.js';
import type {
  LinhaCalculoDoVinculo,
  ProcessoDaFolha,
  RescisaoDaFolha,
  ResumoVinculoDoProcesso,
} from './tipos-folha.js';

type Linha = Record<string, unknown>;
const n = (v: unknown): number => Number(v ?? 0);
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const p2 = (x: number) => String(x).padStart(2, '0');
function dia(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
  return String(v).slice(0, 10);
}
const instante = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);
const json = <T>(v: unknown, padrao: T): T => {
  if (v === null || v === undefined) return padrao;
  if (typeof v === 'object') return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return padrao;
  }
};

// ── Traduções entre o contrato e o banco ────────────────────────────────────────────────────────────────────────

const TIPO_NO_BANCO: Readonly<Record<TipoProcessoFolha, string>> = {
  mensal: 'mensal',
  ferias: 'ferias',
  decimo1: 'decimo_terceiro_1',
  decimo2: 'decimo_terceiro_2',
  rescisao: 'rescisao',
};
const TIPO_DO_BANCO: Readonly<Record<string, TipoProcessoFolha>> = Object.fromEntries(
  Object.entries(TIPO_NO_BANCO).map(([k, v]) => [v, k as TipoProcessoFolha]),
);
/** O tipo do processamento como o banco grava. */
export const tipoProcessoNoBanco = (t: TipoProcessoFolha): string => TIPO_NO_BANCO[t];
/** A competência do contrato (AAAA-MM) no primeiro dia do mês, e de volta. */
export const competenciaNoBanco = (c: string): string => `${c.slice(0, 7)}-01`;
const competenciaDoBanco = (v: unknown): string => (dia(v) ?? '').slice(0, 7);
/** Data opcional do contrato (texto vazio: nenhuma) para o banco, e de volta. */
const dataOuNulo = (v: string | null | undefined): string | null =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const conferirData = (campo: string, v: string): string | null => {
  if (v === '') return null;
  const d = dataOuNulo(v);
  if (!d)
    throw recusa('data-invalida', `O campo ${campo} do processamento tem de ser uma data (AAAA-MM-DD).`);
  return d;
};
const modalidadeNoBanco = (m: ModalidadeRescisao): string => m.replace(/-/g, '_');
const modalidadeDoBanco = (v: unknown): ModalidadeRescisao =>
  String(v ?? '').replace(/_/g, '-') as ModalidadeRescisao;
const avisoNoBanco = (a: AvisoPrevio): string => a.replace(/-/g, '_');
const avisoDoBanco = (v: unknown): AvisoPrevio => String(v ?? 'nenhum').replace(/_/g, '-') as AvisoPrevio;

/** O período do processamento no fechamento (mensal: o mês; anual: o ano), como o banco grava. */
function periodoDoFechamento(tipo: TipoProcessoFolha, competencia: string) {
  const apuracao = APURACAO_DO_TIPO[tipo];
  return {
    apuracao,
    periodo: apuracao === 'anual' ? `${competencia.slice(0, 4)}-01-01` : competenciaNoBanco(competencia),
  };
}
const recusaFechado = () =>
  recusa(
    'competencia-fechada',
    'O período desta folha está fechado: reabra o fechamento (com motivo) antes de calcular, recalcular ou descartar.',
  );
const desatualizado = () =>
  recusa('desatualizado', 'O registro mudou desde a leitura: abra de novo e confira.');
function erroModeloPendente(operacao: string, falta: string): ErroOperacao {
  return new ErroOperacao(
    409,
    'modelo-pendente',
    'Operação indisponível no modelo atual',
    `${operacao}: o modelo do banco ainda não tem ${falta}. A operação volta quando a tabela for criada.`,
  );
}

async function periodoFechado(
  l: Pick<Leitor, 'uma'>,
  est: number,
  tipo: TipoProcessoFolha,
  competencia: string,
): Promise<boolean> {
  const { apuracao, periodo } = periodoDoFechamento(tipo, competencia);
  return !!(await l.uma(
    `SELECT id FROM fechamento_periodo_folha
      WHERE estabelecimento_id = ? AND apuracao = ? AND periodo_inicio = ? AND situacao = 'fechado' LIMIT 1`,
    [est, apuracao, periodo],
  ));
}

// ── Processamento ───────────────────────────────────────────────────────────────────────────────────────────────

/** O processamento com quem calculou e quem trocou a situação (logins da auditoria); filtro e ordem no fim. */
export const SQL_PROCESSOS_FOLHA = `
  SELECT p.id, p.estabelecimento_id, p.competencia, p.tipo, p.numero, p.situacao, p.pagamento_em, p.totais,
         p.quantidade_fora_da_folha, p.tabela_legal_inicio, p.parametros_inicio, p.resumo, p.motivo, p.criado_em,
         p.alterado_em, p.versao, uc.login AS calculado_por, ua.login AS situacao_por
    FROM processamento_folha p
    LEFT JOIN usuario uc ON uc.id = p.criado_por
    LEFT JOIN usuario ua ON ua.id = p.alterado_por
   WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL`;

/** A linha do banco no processamento do contrato. */
export function processoDe(r: Linha): ProcessoDaFolha {
  const mudou = r['alterado_em'] !== null && r['alterado_em'] !== undefined;
  return {
    id: n(r['id']),
    empresa: n(r['estabelecimento_id']),
    competencia: competenciaDoBanco(r['competencia']),
    tipo: TIPO_DO_BANCO[String(r['tipo'])] ?? 'mensal',
    numero: n(r['numero']),
    situacao: String(r['situacao']) as SituacaoProcessoFolha,
    pagamento: dia(r['pagamento_em']),
    totais: json<TotaisCalculoFolha>(r['totais'], {} as TotaisCalculoFolha),
    foraDaFolha: n(r['quantidade_fora_da_folha']),
    tabelaLegal: dia(r['tabela_legal_inicio']) ?? '',
    parametros: dia(r['parametros_inicio']) ?? '',
    resumo: String(r['resumo'] ?? ''),
    calculadoPor: String(r['calculado_por'] ?? ''),
    calculadoEm: instante(r['criado_em']) ?? '',
    situacaoPor: mudou ? textoOuNulo(r['situacao_por']) : null,
    situacaoEm: mudou ? instante(r['alterado_em']) : null,
    motivo: textoOuNulo(r['motivo']),
    versao: n(r['versao']),
  };
}

/** As linhas do processamento (com o código da rubrica do holerite), na ordem da gravação. */
export const SQL_LINHAS_FOLHA = `
  SELECT l.id, l.vinculo_trabalho_id, l.papel, l.tipo, l.rubrica_id, r.codigo AS codigo_rubrica, l.quantidade, l.unidade,
         l.valor, l.memoria_calculo, l.centro_custo_id, l.dias_pagos
    FROM processamento_folha_linha l
    JOIN processamento_folha p ON p.id = l.processamento_folha_id
    LEFT JOIN rubrica r ON r.id = l.rubrica_id
   WHERE p.estabelecimento_id = ? AND l.processamento_folha_id = ?`;

const codigoRubrica = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isInteger(x) && x >= 0 ? x : null;
};

export function linhaDe(r: Linha): LinhaCalculoDoVinculo {
  const papel = String(r['papel']) as PapelLinhaFolha;
  return {
    vinculo: n(r['vinculo_trabalho_id']),
    papel,
    tipo: (textoOuNulo(r['tipo']) as LinhaCalculoDoVinculo['tipo'] | null) ?? TIPO_DO_PAPEL[papel],
    rubrica: r['rubrica_id'] === null || r['rubrica_id'] === undefined ? null : n(r['rubrica_id']),
    codigoRubrica: codigoRubrica(r['codigo_rubrica']),
    quantidade: n(r['quantidade']),
    unidade: String(r['unidade']) as UnidadeLinhaFolha,
    valor: n(r['valor']),
    memoria: String(r['memoria_calculo'] ?? ''),
    centroCusto: n(r['centro_custo_id']),
    diasPagos: n(r['dias_pagos']),
  };
}

const PAPEIS_DO_RESUMO: readonly PapelLinhaFolha[] = [
  'baseInss',
  'baseIrrf',
  'baseFgts',
  'inss',
  'irrf',
  'fgts',
  'inssPatronal',
  'rat',
  'terceiros',
  'inssFerias',
  'irrfFerias',
  'inssDecimo',
  'irrfDecimo',
  'multaFgts',
] as PapelLinhaFolha[];

/** O resumo por vínculo (o mesmo da porta de memória): proventos, descontos e os papéis do resumo. */
export function resumirLinhas(linhas: readonly LinhaCalculoDoVinculo[]): ResumoVinculoDoProcesso[] {
  const por = new Map<number, LinhaCalculoDoVinculo[]>();
  for (const l of linhas) por.set(l.vinculo, [...(por.get(l.vinculo) ?? []), l]);
  return [...por.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([vinculo, ls]) => ({
      vinculo,
      centroCusto: ls[0]!.centroCusto,
      diasPagos: ls[0]!.diasPagos,
      proventos: ls.filter((l) => l.tipo === 'provento').reduce((s, l) => s + l.valor, 0),
      descontos: ls.filter((l) => l.tipo === 'desconto').reduce((s, l) => s + l.valor, 0),
      porPapel: Object.fromEntries(
        PAPEIS_DO_RESUMO.map((p) => [p, ls.filter((l) => l.papel === p).reduce((s, l) => s + l.valor, 0)]),
      ),
    }));
}

// ── Rescisão ────────────────────────────────────────────────────────────────────────────────────────────────────

const SQL_RESCISOES = `
  SELECT r.id, d.vinculo_trabalho_id, r.estabelecimento_id, r.data_desligamento, r.tipo_rescisao_id, r.modalidade,
         r.aviso_previo, r.dias_aviso, r.dias_aviso_indenizados, r.data_projetada_aviso, r.termo_contrato,
         r.saldo_fgts, r.saldo_fgts_informado, r.valor_multa_fgts, r.pagamento_limite_em, r.situacao,
         r.processamento_folha_id, r.motivo_situacao, r.criado_em, r.alterado_em, r.versao,
         uc.login AS registrado_por, ua.login AS situacao_por
    FROM rescisao r
    JOIN desligamento d ON d.id = r.desligamento_id
    LEFT JOIN usuario uc ON uc.id = r.criado_por
    LEFT JOIN usuario ua ON ua.id = r.alterado_por
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL`;

export function rescisaoDe(r: Linha): RescisaoDaFolha {
  const mudou = r['alterado_em'] !== null && r['alterado_em'] !== undefined;
  return {
    id: n(r['id']),
    vinculo: n(r['vinculo_trabalho_id']),
    empresa: n(r['estabelecimento_id']),
    desligamento: dia(r['data_desligamento']) ?? '',
    tipoRescisao:
      r['tipo_rescisao_id'] === null || r['tipo_rescisao_id'] === undefined ? null : n(r['tipo_rescisao_id']),
    modalidade: modalidadeDoBanco(r['modalidade']),
    aviso: avisoDoBanco(r['aviso_previo']),
    diasAviso: n(r['dias_aviso']),
    diasIndenizados: n(r['dias_aviso_indenizados']),
    projecao: dia(r['data_projetada_aviso']) ?? dia(r['data_desligamento']) ?? '',
    termo: dia(r['termo_contrato']),
    saldoFgts: n(r['saldo_fgts']),
    saldoFgtsInformado: !!n(r['saldo_fgts_informado']),
    multaFgts: n(r['valor_multa_fgts']),
    pagamento: dia(r['pagamento_limite_em']) ?? '',
    situacao: String(r['situacao']) as SituacaoRescisao,
    processo: n(r['processamento_folha_id']),
    motivo: textoOuNulo(r['motivo_situacao']),
    registradoPor: String(r['registrado_por'] ?? ''),
    registradoEm: instante(r['criado_em']) ?? '',
    situacaoPor: mudou ? textoOuNulo(r['situacao_por']) : null,
    situacaoEm: mudou ? instante(r['alterado_em']) : null,
    versao: n(r['versao']),
  };
}

// ── O gravador ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Os métodos do gravador do cálculo que este arquivo provê (os 20 do executor que dependiam do processamento). */
export type GravadorFolhaExecutor = Pick<
  GravadorCalculoFolha,
  | 'emVigorComTrava'
  | 'incluirProcesso'
  | 'incluirLinhas'
  | 'situacaoProcesso'
  | 'processo'
  | 'resumoVinculos'
  | 'processosCalculadosComTrava'
  | 'rescisoesDoVinculoComTrava'
  | 'incluirRescisao'
  | 'situacaoRescisao'
  | 'feriasDoVinculoComTrava'
  | 'incluirFerias'
  | 'situacaoFerias'
  | 'incluirParametrosObrigacoes'
  | 'obrigacoesEmVigorComTrava'
  | 'obrigacaoComTrava'
  | 'incluirObrigacao'
  | 'substituirObrigacao'
  | 'registrarEntregaObrigacao'
  | 'cancelarObrigacao'
>;

/** As tabelas que este gravador escreve (somam-se às de TABELAS_CALCULO_FOLHA). */
export const TABELAS_FOLHA_EXECUTOR = [
  'processamento_folha',
  'processamento_folha_linha',
  'rescisao',
  'parametro_obrigacao',
] as const;

const FALTA = {
  ferias:
    'a concessão de férias no formato do cálculo (programacao_ferias exige o período aquisitivo e o tipo de férias e não liga o processamento da folha)',
  obrigacoes:
    'a obrigação gerada no formato do cálculo (o arquivo cifrado pela porta de armazenamento, as situações entregue e substituída e a numeração por período)',
} as const;

export function gravadorFolhaExecutor(tx: TxOperacao, est: number): GravadorFolhaExecutor {
  const daSessao = (empresa: number) => {
    if (empresa !== est)
      throw recusa('empresa-fora-da-sessao', 'A empresa da folha é o estabelecimento da sessão.');
  };
  const sem = (operacao: string, falta: string) => () => Promise.reject(erroModeloPendente(operacao, falta));
  const processoNaTx = async (id: number) => {
    const r = await tx.uma(`${SQL_PROCESSOS_FOLHA} AND p.id = ?`, [est, id]);
    return r ? processoDe(r) : null;
  };

  return {
    async emVigorComTrava(empresa, competencia, tipo = 'mensal', intervalo = null) {
      if (empresa !== est) return { vigente: null, proximoNumero: 1 };
      const tipoBanco = TIPO_NO_BANCO[tipo];
      const da = await tx.consultarParaAtualizar(
        'SELECT id, numero FROM processamento_folha WHERE estabelecimento_id = ? AND tipo = ? AND competencia = ?',
        [est, tipoBanco, competenciaNoBanco(competencia)],
      );
      const proximoNumero = da.reduce((m, r) => Math.max(m, n(r['numero'])), 0) + 1;
      if (tipo === 'ferias' || tipo === 'rescisao') return { vigente: null, proximoNumero };
      const de = competenciaNoBanco(intervalo?.de ?? competencia);
      const ate = competenciaNoBanco(intervalo?.ate ?? competencia);
      const [v] = await tx.consultarParaAtualizar(
        `${SQL_PROCESSOS_FOLHA} AND p.tipo = ? AND p.situacao = 'calculada' AND p.competencia BETWEEN ? AND ?
          ORDER BY p.competencia, p.id LIMIT 1`,
        [est, tipoBanco, de, ate],
      );
      return { vigente: v ? processoDe(v) : null, proximoNumero };
    },

    async incluirProcesso(x) {
      daSessao(x.empresa);
      const tipo = x.tipo ?? 'mensal';
      if (await periodoFechado(tx, est, tipo, x.competencia)) throw recusaFechado();
      await exigirUsuario(tx, x.por);
      const ja = await tx.uma(
        'SELECT id FROM processamento_folha WHERE estabelecimento_id = ? AND competencia = ? AND tipo = ? AND numero = ?',
        [est, competenciaNoBanco(x.competencia), TIPO_NO_BANCO[tipo], x.numero],
      );
      if (ja)
        throw recusa(
          'calculo-concorrente',
          'Outra pessoa calculou esta competência ao mesmo tempo: abra de novo e confira.',
        );
      return tx.incluir('processamento_folha', {
        estabelecimento_id: est,
        competencia: competenciaNoBanco(x.competencia),
        tipo: TIPO_NO_BANCO[tipo],
        numero: x.numero,
        situacao: 'calculada',
        pagamento_em: tipo === 'mensal' ? null : dataOuNulo(x.pagamento ?? null),
        totais: JSON.stringify(x.totais),
        quantidade_fora_da_folha: x.foraDaFolha,
        tabela_legal_inicio: conferirData('tabelaLegal', x.tabelaLegal),
        parametros_inicio: conferirData('parametros', x.parametros),
        resumo: x.resumo,
      });
    },

    async incluirLinhas(processo, linhas) {
      const p = await processoNaTx(processo);
      if (!p)
        throw recusa(
          'processamento-inexistente',
          'O processamento da folha não existe neste estabelecimento.',
        );
      const vistas = new Set<string>();
      for (const l of linhas) {
        const k = `${l.vinculo}/${l.papel}`;
        if (vistas.has(k)) throw new Error(`linha repetida: ${k}`);
        vistas.add(k);
      }
      if (vistas.size > 0) {
        const ja = await tx.consultar(
          'SELECT vinculo_trabalho_id, papel FROM processamento_folha_linha WHERE processamento_folha_id = ?',
          [processo],
        );
        for (const r of ja) {
          const k = `${n(r['vinculo_trabalho_id'])}/${String(r['papel'])}`;
          if (vistas.has(k)) throw new Error(`linha repetida: ${k}`);
        }
      }
      for (const l of linhas)
        await tx.incluir('processamento_folha_linha', {
          processamento_folha_id: processo,
          vinculo_trabalho_id: l.vinculo,
          papel: l.papel,
          tipo: l.tipo,
          rubrica_id: l.rubrica,
          quantidade: l.quantidade,
          unidade: l.unidade,
          valor: l.valor,
          memoria_calculo: l.memoria,
          centro_custo_id: l.centroCusto > 0 ? l.centroCusto : null,
          dias_pagos: l.diasPagos,
        });
      return linhas.length;
    },

    async situacaoProcesso(x) {
      const [r] = await tx.consultarParaAtualizar(
        `SELECT id, tipo, competencia, situacao, versao FROM processamento_folha
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [x.id, est],
      );
      if (r) {
        const tipo = TIPO_DO_BANCO[String(r['tipo'])] ?? 'mensal';
        if (await periodoFechado(tx, est, tipo, competenciaDoBanco(r['competencia']))) throw recusaFechado();
      }
      if (!r || r['situacao'] !== x.de || n(r['versao']) !== x.versao) throw desatualizado();
      await exigirUsuario(tx, x.por);
      await tx.alterar('processamento_folha', x.id, x.versao, { situacao: x.para, motivo: x.motivo });
    },

    processo: (id) => processoNaTx(id),

    async resumoVinculos(processo) {
      const rs = await tx.consultar(`${SQL_LINHAS_FOLHA} ORDER BY l.id`, [est, processo]);
      return resumirLinhas(rs.map(linhaDe));
    },

    async processosCalculadosComTrava(empresa, de, ate) {
      if (empresa !== est) return [];
      const rs = await tx.consultarParaAtualizar(
        `${SQL_PROCESSOS_FOLHA} AND p.situacao = 'calculada' AND p.competencia BETWEEN ? AND ?
          ORDER BY p.competencia, p.id`,
        [est, competenciaNoBanco(de), competenciaNoBanco(ate)],
      );
      return rs.map(processoDe);
    },

    async rescisoesDoVinculoComTrava(vinculo) {
      const [v] = await tx.consultarParaAtualizar(
        `SELECT id, data_desligamento, tipo_rescisao_id FROM vinculo_trabalho
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [vinculo, est],
      );
      if (!v) return { desligamento: null, tipoRescisao: null, rescisoes: [] };
      const rs = await tx.consultarParaAtualizar(
        `${SQL_RESCISOES} AND d.vinculo_trabalho_id = ? ORDER BY r.id`,
        [est, vinculo],
      );
      return {
        desligamento: dia(v['data_desligamento']),
        tipoRescisao:
          v['tipo_rescisao_id'] === null || v['tipo_rescisao_id'] === undefined
            ? null
            : n(v['tipo_rescisao_id']),
        rescisoes: rs.map(rescisaoDe),
      };
    },

    async incluirRescisao(x) {
      daSessao(x.empresa);
      await exigirUsuario(tx, x.por);
      const [v] = await tx.consultarParaAtualizar(
        'SELECT id, colaborador_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.vinculo, est],
      );
      if (!v) throw recusa('vinculo-inexistente', 'O vínculo não existe neste estabelecimento.');
      if (x.tipoRescisao === null)
        throw recusa(
          'tipo-rescisao-obrigatorio',
          'Informe o tipo de rescisão do desligamento do vínculo antes de gravar a rescisão.',
        );
      const [d] = await tx.consultarParaAtualizar(
        `SELECT id FROM desligamento
          WHERE vinculo_trabalho_id = ? AND estabelecimento_id = ? AND data_desligamento = ? AND excluido_em IS NULL
            AND situacao <> 'cancelado'
          ORDER BY id DESC LIMIT 1`,
        [x.vinculo, est, x.desligamento],
      );
      if (!d)
        throw recusa(
          'desligamento-nao-registrado',
          'O desligamento do vínculo nesta data não está registrado: registre o desligamento antes da rescisão.',
        );
      const p = await processoNaTx(x.processo);
      if (!p || p.tipo !== 'rescisao')
        throw recusa(
          'processamento-inexistente',
          'O processamento da rescisão não existe neste estabelecimento.',
        );
      const [ultimo] = await tx.consultarParaAtualizar(
        'SELECT MAX(numero_complementar) AS m, COUNT(*) AS q FROM rescisao WHERE desligamento_id = ?',
        [n(d['id'])],
      );
      const numero = n(ultimo?.['q']) === 0 ? 0 : n(ultimo?.['m']) + 1;
      return tx.incluir('rescisao', {
        estabelecimento_id: est,
        colaborador_id: n(v['colaborador_id']),
        desligamento_id: n(d['id']),
        tipo_rescisao_id: x.tipoRescisao,
        numero_complementar: numero,
        data_desligamento: x.desligamento,
        data_projetada_aviso: x.projecao,
        saldo_fgts: x.saldoFgts,
        saldo_fgts_informado: x.saldoFgtsInformado,
        valor_multa_fgts: x.multaFgts,
        pagamento_limite_em: x.pagamento,
        situacao: 'calculada',
        modalidade: modalidadeNoBanco(x.modalidade),
        aviso_previo: avisoNoBanco(x.aviso),
        dias_aviso: x.diasAviso,
        dias_aviso_indenizados: x.diasIndenizados,
        termo_contrato: x.termo,
        processamento_folha_id: x.processo,
      });
    },

    async situacaoRescisao(x) {
      const [r] = await tx.consultarParaAtualizar(
        'SELECT id, situacao, versao FROM rescisao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.id, est],
      );
      if (!r || r['situacao'] !== x.de || n(r['versao']) !== x.versao) throw desatualizado();
      await exigirUsuario(tx, x.por);
      await tx.alterar('rescisao', x.id, x.versao, { situacao: x.para, motivo_situacao: x.motivo });
    },

    feriasDoVinculoComTrava: sem('Ler as férias do vínculo', FALTA.ferias),
    incluirFerias: sem('Gravar as férias', FALTA.ferias),
    situacaoFerias: sem('Trocar a situação das férias', FALTA.ferias),
    async incluirParametrosObrigacoes(x) {
      daSessao(x.empresa);
      const repetida = await tx.consultarParaAtualizar(
        'SELECT id FROM parametro_obrigacao WHERE estabelecimento_id = ? AND vigencia_inicio = ? AND excluido_em IS NULL',
        [est, competenciaNoBanco(x.inicio)],
      );
      if (repetida.length > 0)
        throw recusa(
          'parametros-vigencia-repetida',
          'Já há parâmetros das obrigações com este início: a correção é uma vigência nova.',
        );
      await exigirUsuario(tx, x.por);
      // A mesma validação da porta de memória; empresa e início são colunas, o resto vai em `dados`.
      const dados: Record<string, unknown> = esquemaParametrosObrigacoes.parse({
        ...(JSON.parse(x.dados) as object),
        empresa: x.empresa,
        inicio: x.inicio,
      });
      delete dados['empresa'];
      delete dados['inicio'];
      return tx.incluir('parametro_obrigacao', {
        estabelecimento_id: est,
        vigencia_inicio: competenciaNoBanco(x.inicio),
        dados: JSON.stringify(dados),
      });
    },
    obrigacoesEmVigorComTrava: sem('Ler as obrigações em vigor', FALTA.obrigacoes),
    obrigacaoComTrava: sem('Ler a obrigação', FALTA.obrigacoes),
    incluirObrigacao: sem('Gravar a obrigação', FALTA.obrigacoes),
    substituirObrigacao: sem('Substituir a obrigação', FALTA.obrigacoes),
    registrarEntregaObrigacao: sem('Registrar a entrega da obrigação', FALTA.obrigacoes),
    cancelarObrigacao: sem('Cancelar a obrigação', FALTA.obrigacoes),
  };
}
