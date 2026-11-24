// Gravador próprio do cálculo da folha (modulos-proprios-2, família folha-executor): o que a gravação do cálculo
// escreve e relê na transação, sobre o MariaDB do cliente, com o comportamento da porta de memória.
//   - processamento da folha (processamento_folha e processamento_folha_linha): o vigente com trava, a inclusão com as
//     linhas, a troca de situação pela versão e as releituras; calcular, recalcular ou descartar em período fechado
//     (fechamento_periodo_folha `fechado`) é recusado com `competencia-fechada`;
//   - rescisão (rescisao, ligada ao desligamento do vínculo e ao processamento `rescisao`): as do vínculo com trava, a
//     inclusão (o número complementar seguinte) e a troca de situação pela versão. O desligamento do domínio marca o
//     vínculo (data e tipo); a primeira rescisão cria a linha de `desligamento` a partir do vínculo travado (motivo do
//     eSocial e iniciativa do tipo de rescisão). A releitura usa as funções da leitura (folha-porta-propria-calculo.ts)
//     com trava: o mesmo filtro e a mesma tradução de situação, e o carimbo do serviço bate;
//   - férias (programacao_ferias): as do vínculo com trava (a leitura do cálculo); incluir e trocar a situação (cancelar,
//     voltar a programar, marcar calculada com o recibo) gravam pelo gravador próprio das férias
//     (folha-porta-propria-obrigacoes.ts: o período aquisitivo por vínculo, CLT art. 130).
// Aqui ficam recusando com `modelo-pendente` só as obrigações; na porta do cálculo (porta-calculo-propria.ts) elas são
// sobrescritas pelo gravador de folha-porta-propria-obrigacoes.ts (o arquivo cifrado pela porta de armazenamento). Os parâmetros das obrigações
// gravam aqui (parametro_obrigacao, início AAAA-MM no primeiro dia do mês).
// Tipos do processamento: o contrato diz `decimo1`/`decimo2`; o banco, `decimo_terceiro_1`/`decimo_terceiro_2`.
// Quem calculou e quem trocou a situação vêm da auditoria (criado_por e alterado_por), nunca de coluna à parte.
import {
  APURACAO_DO_TIPO,
  esquemaParametrosObrigacoes,
  type ModalidadeRescisao,
  type AvisoPrevio,
  type SituacaoProcessoFolha,
  TIPO_DO_PAPEL,
  type TipoProcessoFolha,
  type TotaisCalculoFolha,
  type UnidadeLinhaFolha,
  type PapelLinhaFolha,
} from '@sgh/contratos';
import { ErroOperacao, type Leitor, recusa, type TxOperacao } from '@sgh/nucleo';
import { exigirUsuario } from '../../qualidade/apoio-propria.js';
import {
  exigirRescisaoAlteravel,
  lerFerias,
  lerRescisaoPorId,
  lerRescisoes,
} from './folha-porta-propria-calculo.js';
import { gravadorFolhaObrigacoes } from './folha-porta-propria-obrigacoes.js';
import type { GravadorCalculoFolha } from './porta-calculo.js';
import type { LinhaCalculoDoVinculo, ProcessoDaFolha, ResumoVinculoDoProcesso } from './tipos-folha.js';

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
const avisoNoBanco = (a: AvisoPrevio): string => a.replace(/-/g, '_');

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

// ── Rescisão e férias: a mesma leitura do cálculo, com trava ─────────────────────────────────────────────────────

/** O leitor da transação que trava o que lê (SELECT ... FOR UPDATE): as releituras do gravador usam as mesmas funções
 * da leitura (folha-porta-propria-calculo.ts), com o mesmo filtro (rescisão migrada, sem modalidade ou em simulação
 * fica de fora) e a mesma tradução de situação (conferida, paga e homologada = calculada; aprovada = programada). Assim
 * o carimbo da releitura bate com o da montagem do serviço. Como a tradução esconde a situação real, a troca de situação
 * passa também pelas guardas exigirRescisaoAlteravel e exigirFeriasAlteravel, que leem a situação do banco com a trava
 * (rescisão paga ou homologada e férias em gozo ou gozadas recusam com 409). */
function leitorComTrava(tx: TxOperacao): Pick<Leitor, 'consultar' | 'uma'> {
  return {
    consultar: ((sql: string, p?: readonly unknown[]) =>
      tx.consultarParaAtualizar(sql, p as unknown[])) as Leitor['consultar'],
    uma: (async (sql: string, p?: readonly unknown[]) =>
      (await tx.consultarParaAtualizar(sql, p as unknown[]))[0] ?? null) as Leitor['uma'],
  };
}

/** O aviso prévio do contrato no desligamento (o desligamento não distingue o aviso não cumprido: era trabalhado). */
const AVISO_NO_DESLIGAMENTO: Readonly<Record<AvisoPrevio, string>> = {
  indenizado: 'indenizado',
  trabalhado: 'trabalhado',
  'nao-cumprido': 'trabalhado',
  dispensado: 'dispensado',
  nenhum: 'nao_se_aplica',
};

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
  'desligamento',
  'programacao_ferias',
  'parametro_obrigacao',
] as const;

const FALTA = {
  obrigacoes:
    'a obrigação gerada no formato do cálculo (o arquivo cifrado pela porta de armazenamento, as situações entregue e substituída e a numeração por período)',
} as const;

export function gravadorFolhaExecutor(tx: TxOperacao, est: number): GravadorFolhaExecutor {
  const daSessao = (empresa: number) => {
    if (empresa !== est)
      throw recusa('empresa-fora-da-sessao', 'A empresa da folha é o estabelecimento da sessão.');
  };
  const sem = (operacao: string, falta: string) => () => Promise.reject(erroModeloPendente(operacao, falta));
  let ferias: ReturnType<typeof gravadorFolhaObrigacoes> | null = null;
  const feriasProprias = () =>
    (ferias ??= gravadorFolhaObrigacoes(tx, est, {
      // O cliente só serve ao arquivo da obrigação (sem armazenamento aqui): lido quando for usado.
      get cliente() {
        return tx.contexto.cliente;
      },
      arquivos: null,
    }));
  const trava = leitorComTrava(tx);
  /** O desligamento da rescisão: o registrado no vínculo nesta data ou, quando o desligamento do domínio só marcou o
   * vínculo (data e tipo de rescisão em vinculo_trabalho), o desligamento criado aqui a partir do vínculo travado, com a
   * mesma data e o mesmo tipo, o motivo do eSocial e a iniciativa do tipo de rescisão e o aviso da rescisão. Uma fonte
   * só: a data vem sempre do vínculo. */
  const desligamentoDaRescisao = async (
    v: Linha,
    x: Parameters<GravadorFolhaExecutor['incluirRescisao']>[0],
  ): Promise<number> => {
    if (dia(v['data_desligamento']) !== x.desligamento)
      throw recusa(
        'desligamento-nao-registrado',
        'O vínculo não está desligado nesta data: registre o desligamento antes da rescisão.',
      );
    const [d] = await tx.consultarParaAtualizar(
      `SELECT id FROM desligamento
        WHERE vinculo_trabalho_id = ? AND estabelecimento_id = ? AND data_desligamento = ? AND excluido_em IS NULL
          AND situacao <> 'cancelado'
        ORDER BY id DESC LIMIT 1`,
      [x.vinculo, est, x.desligamento],
    );
    if (d) return n(d['id']);
    const tipoId =
      v['tipo_rescisao_id'] === null || v['tipo_rescisao_id'] === undefined
        ? x.tipoRescisao
        : n(v['tipo_rescisao_id']);
    const t = await tx.uma(
      'SELECT id, iniciativa, motivo_desligamento_codigo_esocial_id AS motivo FROM tipo_rescisao WHERE id = ?',
      [tipoId],
    );
    if (!t) throw recusa('tipo-rescisao-inexistente', 'Tipo de rescisão inexistente.');
    if (t['motivo'] === null || t['motivo'] === undefined)
      throw recusa(
        'tipo-rescisao-sem-motivo-esocial',
        'O tipo de rescisão não indica o motivo de desligamento do eSocial (tabela 19): complete o cadastro do tipo antes de gravar a rescisão.',
      );
    const projecao = dataOuNulo(x.projecao);
    return tx.incluir('desligamento', {
      estabelecimento_id: est,
      vinculo_trabalho_id: x.vinculo,
      motivo_codigo_esocial_id: n(t['motivo']),
      tipo_rescisao_id: tipoId,
      iniciativa: String(t['iniciativa']),
      // A data do aviso não chega à rescisão: fica a do desligamento (a CHECK exige comunicação até o desligamento).
      data_comunicacao: x.desligamento,
      data_desligamento: x.desligamento,
      aviso_previo: AVISO_NO_DESLIGAMENTO[x.aviso],
      dias_aviso_previo: x.diasAviso >= 30 && x.diasAviso <= 90 ? x.diasAviso : null,
      data_projetada_aviso: projecao && projecao > x.desligamento ? projecao : null,
      justa_causa: x.modalidade === 'justa-causa',
      situacao: 'confirmado',
    });
  };
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
      const rescisoes = await lerRescisoes(trava, est, { vinculo });
      return {
        desligamento: dia(v['data_desligamento']),
        tipoRescisao:
          v['tipo_rescisao_id'] === null || v['tipo_rescisao_id'] === undefined
            ? null
            : n(v['tipo_rescisao_id']),
        rescisoes,
      };
    },

    async incluirRescisao(x) {
      daSessao(x.empresa);
      await exigirUsuario(tx, x.por);
      const [v] = await tx.consultarParaAtualizar(
        `SELECT id, colaborador_id, data_desligamento, tipo_rescisao_id FROM vinculo_trabalho
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [x.vinculo, est],
      );
      if (!v) throw recusa('vinculo-inexistente', 'O vínculo não existe neste estabelecimento.');
      if (x.tipoRescisao === null)
        throw recusa(
          'tipo-rescisao-obrigatorio',
          'Informe o tipo de rescisão do desligamento do vínculo antes de gravar a rescisão.',
        );
      const desligamentoId = await desligamentoDaRescisao(v, x);
      const p = await processoNaTx(x.processo);
      if (!p || p.tipo !== 'rescisao')
        throw recusa(
          'processamento-inexistente',
          'O processamento da rescisão não existe neste estabelecimento.',
        );
      const [ultimo] = await tx.consultarParaAtualizar(
        'SELECT MAX(numero_complementar) AS m, COUNT(*) AS q FROM rescisao WHERE desligamento_id = ?',
        [desligamentoId],
      );
      const numero = n(ultimo?.['q']) === 0 ? 0 : n(ultimo?.['m']) + 1;
      return tx.incluir('rescisao', {
        estabelecimento_id: est,
        colaborador_id: n(v['colaborador_id']),
        desligamento_id: desligamentoId,
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
      // A situação relida pela tradução da leitura: `de: calculada` vale para a conferida, a paga e a homologada.
      const r = await lerRescisaoPorId(trava, est, x.id);
      if (!r || r.situacao !== x.de || r.versao !== x.versao) throw desatualizado();
      // Rescisão paga ou homologada não se cancela nem se substitui (a leitura a mostra como calculada).
      await exigirRescisaoAlteravel(trava, est, x.id);
      await exigirUsuario(tx, x.por);
      await tx.alterar('rescisao', x.id, x.versao, { situacao: x.para, motivo_situacao: x.motivo });
    },

    feriasDoVinculoComTrava: (vinculo) => lerFerias(trava, est, { vinculo }),
    // Incluir as férias e trocar a situação delas (inclusive marcar calculada, com o recibo ligado ao processamento)
    // gravam pelo gravador próprio das férias (folha-porta-propria-obrigacoes.ts): o período aquisitivo por vínculo
    // (CLT art. 130), o tipo de férias e o recibo. É o mesmo gravador que a porta do cálculo usa e que o efeito do
    // autoatendimento alcança sobre a transação da solicitação.
    incluirFerias: (x) => feriasProprias().incluirFerias(x),
    situacaoFerias: (x) => feriasProprias().situacaoFerias(x),
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
