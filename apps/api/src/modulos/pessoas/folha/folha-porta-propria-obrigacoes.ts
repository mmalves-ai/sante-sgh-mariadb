// Férias (inclusão e cálculo) e obrigações da folha sobre o MariaDB do cliente (modulos-proprios-3, família
// folha-obrigacoes), com o comportamento da porta de memória (porta-calculo-memoria.ts).
//   - Férias (programacao_ferias): a inclusão liga o período aquisitivo DO VÍNCULO (migração 15_RH/98: o período é do
//     contrato de trabalho, CLT art. 130; o existente com o mesmo início ou um novo, com as faltas e os dias de direito
//     da escala do art. 130 calculados pelo domínio, com o limite concessivo de 12 meses depois do fim, CLT art. 134) e o tipo de férias individual ativo; a
//     fração é a seguinte das ativas do período (até três, CLT art. 134 § 1º). Marcar `calculada` grava o recibo de
//     férias (recibo_ferias) ligado ao processamento da folha, com a base e o INSS das linhas do vínculo; cancelar ou
//     voltar a programar segue a regra do gravador da folha (férias em gozo ou gozadas não se alteram).
//   - Obrigações (obrigacao_trabalhista, com a migração 15_RH/97_folha_obrigacoes): o número do contrato é a
//     retificação + 1; a competência é o primeiro dia do mês (anual: do ano-base). Situações do contrato no banco:
//     gerada = gerada (e `rejeitada`, que volta a ser entregue), entregue = transmitida/aceita, substituida = retificada,
//     cancelada = cancelada. O arquivo já cifrado vai para o armazenamento de arquivos da instalação (ADR 0004: disco,
//     gravado uma vez pelo hash, metadado na tabela `arquivo` na mesma transação); o resumo SHA-256 e o tamanho ficam em
//     arquivo_obrigacao (sequência 1, o envio); os fechamentos usados, em obrigacao_fechamento. Quem gerou e quem trocou
//     a situação vêm da auditoria (criado_por e alterado_por).
//   - Catálogo oficial das obrigações acessórias: a edição versionada de catalogo-obrigacoes-oficiais.ts (eSocial,
//     EFD-Reinf, DCTFWeb e FGTS Digital vigentes; SEFIP, CAGED e RAIS encerradas, sem gerador). Não depende de carga no
//     banco: nunca fica pendente.
// Sem o armazenamento de arquivos configurado, gravar e baixar o arquivo recusam com 503 (falha fechada).
import type { SituacaoFerias, SituacaoObrigacao, TipoObrigacao, TotaisObrigacao } from '@sgh/contratos';
import { APURACAO_DA_OBRIGACAO } from '@sgh/contratos';
import {
  chaveDoArquivo,
  type ContextoNucleo,
  ErroOperacao,
  gravarUmaVez,
  type Leitor,
  type NucleoProprio,
  recusa,
  sha256,
  type TxOperacao,
} from '@sgh/nucleo';
import {
  conferirFracaoNoDireito,
  direitoDoPeriodoGravado,
  type RecusaGravacaoFerias,
} from '@sgh/dominio-pessoas';
import { exigirUsuario } from '../../qualidade/apoio-propria.js';
import { exigirFeriasAlteravel, lerFeriasPorId } from './folha-porta-propria-calculo.js';
import type { ContextoCalculoFolha, GravadorCalculoFolha } from './porta-calculo.js';
import { catalogoObrigacoesNa } from './catalogo-obrigacoes-oficiais.js';
import {
  type CatalogoObrigacoesOficiais,
  type FiltroObrigacoesDaFolha,
  type ObrigacaoDaFolha,
} from './tipos-folha.js';

type Linha = Record<string, unknown>;
type LeitorObrigacoes = Pick<Leitor, 'consultar' | 'uma'>;

/** O que este arquivo usa do armazenamento de arquivos (ArmazemArquivosLocal). */
export interface ArquivosObrigacoes {
  caminho(cliente: string, chave: string): Promise<string>;
  ler(ctx: ContextoNucleo, id: number): Promise<{ readonly conteudo: Buffer }>;
}

/** As tabelas que este gravador escreve (somam-se às do gravador do cálculo). */
export const TABELAS_FOLHA_OBRIGACOES = [
  'programacao_ferias',
  'periodo_aquisitivo',
  'recibo_ferias',
  'obrigacao_trabalhista',
  'arquivo_obrigacao',
  'obrigacao_fechamento',
  'arquivo',
] as const;

export type GravadorFolhaObrigacoes = Pick<
  GravadorCalculoFolha,
  | 'incluirFerias'
  | 'situacaoFerias'
  | 'obrigacoesEmVigorComTrava'
  | 'obrigacaoComTrava'
  | 'incluirObrigacao'
  | 'substituirObrigacao'
  | 'registrarEntregaObrigacao'
  | 'cancelarObrigacao'
>;

// ── Apoio ────────────────────────────────────────────────────────────────────────────────────────────────────

const n = (v: unknown): number => Number(v ?? 0);
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const p2 = (x: number) => String(x).padStart(2, '0');
function dia(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
  return String(v).slice(0, 10);
}
const instante = (v: unknown): string =>
  v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
const instanteOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : instante(v));
const marcas = (xs: readonly unknown[]) => xs.map(() => '?').join(', ');
const agoraNoBanco = () => new Date().toISOString().slice(0, 23).replace('T', ' ');
const hoje = () => dia(new Date()) as string;

function leitorComTrava(tx: TxOperacao): LeitorObrigacoes {
  return {
    consultar: ((sql: string, p?: readonly unknown[]) =>
      tx.consultarParaAtualizar(sql, p as unknown[])) as Leitor['consultar'],
    uma: (async (sql: string, p?: readonly unknown[]) =>
      (await tx.consultarParaAtualizar(sql, p as unknown[]))[0] ?? null) as Leitor['uma'],
  };
}

const desatualizado = () =>
  recusa('desatualizado', 'O registro mudou desde a leitura: abra de novo e confira.');
const foraDaSessao = () =>
  recusa('empresa-fora-da-sessao', 'A empresa da folha é o estabelecimento da sessão.');
const semArmazenamento = () =>
  new ErroOperacao(
    503,
    'armazenamento-indisponivel',
    'Armazenamento de arquivos indisponível',
    'O armazenamento de arquivos desta instalação não está configurado: o arquivo da obrigação não pode ser gravado nem lido.',
  );

/** A data AAAA-MM-DD somada de meses (o dia que não existe no mês de chegada vira o último dia dele). */
export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${p2(mes)}-${p2(Math.min(d, ultimo))}`;
}

// ── Férias ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A situação do contrato como o gravador grava (a leitura traduz de volta em folha-porta-propria-calculo.ts). */
const FERIAS_GRAVADA: Readonly<Record<SituacaoFerias, string>> = {
  programada: 'programada',
  calculada: 'calculada',
  cancelada: 'cancelada',
};

function conferirDiasFerias(x: { dias: number; abono: number; dobra: number }) {
  if (!(x.dias >= 5 && x.dias <= 30) || !(x.abono >= 0 && x.abono <= 10) || !(x.dobra >= 0 && x.dobra <= 30))
    throw recusa(
      'ferias-dias-invalidos',
      'As férias têm de 5 a 30 dias de gozo, até 10 de abono e até 30 em dobro (CLT arts. 134 e 143).',
    );
}

const MENSAGEM_GRAVACAO_FERIAS: Readonly<Record<RecusaGravacaoFerias, string>> = {
  'periodo-direito-incoerente':
    'Os dias de direito não são os da escala do art. 130 da CLT para as faltas injustificadas informadas.',
  'periodo-aquisitivo-divergente':
    'O período aquisitivo já gravado tem outras faltas ou outro direito: confira o período antes de programar.',
  'ferias-acima-do-direito':
    'As frações de férias (gozo e abono) passam dos dias de direito do período aquisitivo (CLT arts. 130 e 143).',
  'fracao-quatorze':
    'Uma das frações tem de ter ao menos 14 dias, e esta programação não deixa lugar para ela (CLT art. 134, § 1º).',
};
const recusaFerias = (c: RecusaGravacaoFerias) => recusa(c, MENSAGEM_GRAVACAO_FERIAS[c]);

// ── Obrigações ───────────────────────────────────────────────────────────────────────────────────────────────

const TIPO_NO_BANCO: Readonly<Record<TipoObrigacao, string>> = {
  'fgts-digital': 'fgts_digital',
  sefip: 'sefip',
  caged: 'caged',
  rais: 'rais',
};
const TIPO_DO_BANCO: Readonly<Record<string, TipoObrigacao>> = Object.fromEntries(
  Object.entries(TIPO_NO_BANCO).map(([k, v]) => [v, k as TipoObrigacao]),
);
const OBRIGACAO_NO_BANCO: Readonly<Record<SituacaoObrigacao, readonly string[]>> = {
  gerada: ['gerada', 'rejeitada'],
  entregue: ['transmitida', 'aceita'],
  substituida: ['retificada'],
  cancelada: ['cancelada'],
};
const situacaoObrigacao = (v: unknown): SituacaoObrigacao =>
  (Object.keys(OBRIGACAO_NO_BANCO) as SituacaoObrigacao[]).find((k) =>
    OBRIGACAO_NO_BANCO[k].includes(texto(v)),
  ) ?? 'gerada';

/** O período do contrato (AAAA-MM ou AAAA) no primeiro dia do mês (ou do ano-base), e de volta. */
export const periodoNoBanco = (tipo: TipoObrigacao, periodo: string): string =>
  APURACAO_DA_OBRIGACAO[tipo] === 'anual' ? `${periodo.slice(0, 4)}-01-01` : `${periodo.slice(0, 7)}-01`;
const periodoDoBanco = (tipo: TipoObrigacao, v: unknown): string => {
  const d = dia(v) ?? '';
  return APURACAO_DA_OBRIGACAO[tipo] === 'anual' ? d.slice(0, 4) : d.slice(0, 7);
};

/**
 * O prazo legal de entrega do período: FGTS Digital até o dia 20 do mês seguinte (Lei 8.036/1990, art. 15, na redação
 * da Lei 14.438/2022); SEFIP e CAGED até o dia 7 do mês seguinte; RAIS até o último dia de março do ano seguinte ao
 * ano-base (data de referência; a portaria de cada ano-base pode antecipar).
 */
export function prazoEntregaObrigacao(tipo: TipoObrigacao, periodo: string): string {
  if (tipo === 'rais') return `${Number(periodo.slice(0, 4)) + 1}-03-31`;
  const seguinte = somarMeses(`${periodo.slice(0, 7)}-01`, 1);
  return `${seguinte.slice(0, 8)}${tipo === 'fgts-digital' ? '20' : '07'}`;
}

const TOTAIS_VAZIOS: TotaisObrigacao = {
  trabalhadores: 0,
  remuneracao: 0,
  remuneracaoDecimo: 0,
  baseFgts: 0,
  fgts: 0,
  rescisorio: 0,
  admissoes: 0,
  desligamentos: 0,
};
function totaisDe(v: unknown): TotaisObrigacao {
  if (v === null || v === undefined) return { ...TOTAIS_VAZIOS };
  const o = (typeof v === 'object' ? v : JSON.parse(String(v))) as Partial<TotaisObrigacao>;
  return { ...TOTAIS_VAZIOS, ...o };
}

/** As obrigações no formato do cálculo: as que têm arquivo (o envio) e tipo das quatro do contrato. */
const SQL_OBRIGACOES = `
  SELECT o.id, o.estabelecimento_id, o.tipo_obrigacao, o.competencia, o.numero_retificacao, o.situacao, o.leiaute,
         o.leiaute_conferido, o.totais, o.protocolo, o.transmitida_em, o.valor_guia, o.acrescimos, o.motivo_situacao,
         o.gerada_em, o.criado_em, o.alterado_em, o.versao, uc.login AS gerado_login, ua.login AS situacao_login,
         a.nome_original, COALESCE(ao.tamanho_bytes, a.tamanho_bytes) AS tamanho,
         COALESCE(ao.hash_sha256, a.hash_sha256) AS resumo,
         (SELECT GROUP_CONCAT(f.fechamento_periodo_folha_id ORDER BY f.fechamento_periodo_folha_id)
            FROM obrigacao_fechamento f WHERE f.obrigacao_trabalhista_id = o.id) AS fechamentos
    FROM obrigacao_trabalhista o
    JOIN arquivo a ON a.id = o.arquivo_id
    LEFT JOIN arquivo_obrigacao ao ON ao.obrigacao_trabalhista_id = o.id AND ao.sequencia = 1 AND ao.excluido_em IS NULL
    LEFT JOIN usuario uc ON uc.id = o.criado_por
    LEFT JOIN usuario ua ON ua.id = o.alterado_por
   WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL AND o.situacao <> 'pendente'
     AND o.tipo_obrigacao IN (${Object.values(TIPO_NO_BANCO)
       .map((t) => `'${t}'`)
       .join(', ')})`;

function obrigacaoDe(r: Linha): ObrigacaoDaFolha {
  const tipo = TIPO_DO_BANCO[texto(r['tipo_obrigacao'])] as TipoObrigacao;
  const situacao = situacaoObrigacao(r['situacao']);
  const trocada = situacao !== 'gerada';
  const entregue = situacao === 'entregue';
  const fechamentos = texto(r['fechamentos']);
  return {
    id: n(r['id']),
    empresa: n(r['estabelecimento_id']),
    tipo,
    periodo: periodoDoBanco(tipo, r['competencia']),
    numero: n(r['numero_retificacao']) + 1,
    situacao,
    leiaute: texto(r['leiaute']),
    leiauteConferido: n(r['leiaute_conferido']) === 1,
    nomeArquivo: texto(r['nome_original']),
    tamanho: n(r['tamanho']),
    resumo: texto(r['resumo']),
    totais: totaisDe(r['totais']),
    fechamentos: fechamentos ? fechamentos.split(',').map(Number) : [],
    geradoPor: texto(r['gerado_login']),
    geradoEm: instante(r['gerada_em'] ?? r['criado_em']),
    protocolo: entregue ? textoOuNulo(r['protocolo']) : null,
    entregueEm: entregue ? dia(r['transmitida_em']) : null,
    valorGuia: entregue ? numOuNulo(r['valor_guia']) : null,
    acrescimos: entregue ? numOuNulo(r['acrescimos']) : null,
    entreguePor: entregue ? textoOuNulo(r['situacao_login']) : null,
    entregaRegistrada: entregue ? instanteOuNulo(r['alterado_em']) : null,
    motivo: textoOuNulo(r['motivo_situacao']),
    situacaoPor: trocada ? textoOuNulo(r['situacao_login']) : null,
    situacaoEm: trocada ? instanteOuNulo(r['alterado_em']) : null,
    versao: n(r['versao']),
  };
}

/** Ordem da porta de memória: período mais recente, tipo, número mais alto. */
const ordenarObrigacoes = (xs: ObrigacaoDaFolha[]) =>
  xs.sort(
    (a, b) => b.periodo.localeCompare(a.periodo) || a.tipo.localeCompare(b.tipo) || b.numero - a.numero,
  );

/** As obrigações do estabelecimento pelo filtro (sem o conteúdo). */
export async function lerObrigacoes(
  l: LeitorObrigacoes,
  est: number,
  f: FiltroObrigacoesDaFolha,
): Promise<ObrigacaoDaFolha[]> {
  if (f.empresa !== undefined && f.empresa !== est) return [];
  const filtros: string[] = [];
  const p: unknown[] = [est];
  if (f.tipo !== undefined) {
    filtros.push('o.tipo_obrigacao = ?');
    p.push(TIPO_NO_BANCO[f.tipo]);
    if (f.periodo !== undefined) {
      filtros.push('o.competencia = ?');
      p.push(periodoNoBanco(f.tipo, f.periodo));
    }
  }
  if (f.ano !== undefined) {
    filtros.push('YEAR(o.competencia) = ?');
    p.push(Number(f.ano.slice(0, 4)));
  }
  if (f.situacoes?.length) {
    const s = f.situacoes.flatMap((x) => OBRIGACAO_NO_BANCO[x]);
    filtros.push(`o.situacao IN (${marcas(s)})`);
    p.push(...s);
  }
  const rs = await l.consultar(`${SQL_OBRIGACOES}${filtros.map((x) => ` AND ${x}`).join('')}`, p);
  // Sem o tipo, o período confere depois da tradução (AAAA-MM e AAAA caem no mesmo dia no banco).
  return ordenarObrigacoes(
    rs.map(obrigacaoDe).filter((x) => f.periodo === undefined || x.periodo === f.periodo),
  );
}

export async function lerObrigacao(
  l: LeitorObrigacoes,
  est: number,
  id: number,
): Promise<ObrigacaoDaFolha | null> {
  const r = await l.uma(`${SQL_OBRIGACOES} AND o.id = ?`, [est, id]);
  return r ? obrigacaoDe(r) : null;
}

/** As linhas cruas da obrigação com trava (situação e versão do banco), para as trocas de situação. */
async function obrigacaoParaTrocar(
  tx: TxOperacao,
  est: number,
  x: { id: number; versao: number },
): Promise<Linha> {
  const [r] = await tx.consultarParaAtualizar(
    `SELECT id, situacao, versao FROM obrigacao_trabalhista
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND arquivo_id IS NOT NULL`,
    [x.id, est],
  );
  if (!r || !OBRIGACAO_NO_BANCO.gerada.includes(texto(r['situacao'])) || n(r['versao']) !== x.versao)
    throw desatualizado();
  return r;
}

// ── Gravador ─────────────────────────────────────────────────────────────────────────────────────────────────

export function gravadorFolhaObrigacoes(
  tx: TxOperacao,
  est: number,
  opcoes: { readonly cliente: string; readonly arquivos: ArquivosObrigacoes | null },
): GravadorFolhaObrigacoes {
  const trava = leitorComTrava(tx);
  const daSessao = (empresa: number) => {
    if (empresa !== est) throw foraDaSessao();
  };

  /**
   * O período aquisitivo DO VÍNCULO com este início (travado) ou um novo. O período é do contrato de trabalho (CLT
   * art. 130; migração 15_RH/98): o colaborador com dois contratos, mesmo de mesmo início, tem um período em cada, e a
   * UNIQUE (vinculo_trabalho_id, inicio) garante um só por contrato e início. O período novo grava as faltas
   * injustificadas e os dias de direito da escala do art. 130 que o domínio calculou (sem eles, 0 faltas e 30 dias).
   * Direito incoerente com as faltas, ou faltas e direito diferentes dos do período já gravado, recusam
   * (direitoDoPeriodoGravado, no domínio): o período nunca muda nem se grava fora da escala em silêncio.
   */
  async function periodoAquisitivo(
    vinculo: number,
    colaborador: number,
    x: { aquisitivoInicio: string; aquisitivoFim: string; inicio: string; faltas?: number; direito?: number },
  ) {
    const { aquisitivoInicio: inicio, aquisitivoFim: fim } = x;
    const [pa] = await tx.consultarParaAtualizar(
      `SELECT id, fim, estabelecimento_id, faltas_injustificadas, dias_direito FROM periodo_aquisitivo
        WHERE vinculo_trabalho_id = ? AND inicio = ? AND excluido_em IS NULL`,
      [vinculo, inicio],
    );
    if (pa) {
      if (n(pa['estabelecimento_id']) !== est) throw foraDaSessao();
      if (dia(pa['fim']) !== fim)
        throw recusa(
          'periodo-aquisitivo-divergente',
          'O período aquisitivo com este início tem outro fim: confira as datas do período.',
        );
      const conf = direitoDoPeriodoGravado(
        { faltas: x.faltas, direito: x.direito },
        { faltas: n(pa['faltas_injustificadas']), direito: n(pa['dias_direito']) },
      );
      if (conf.recusa) throw recusaFerias(conf.recusa);
      return { id: n(pa['id']), direito: conf.direito };
    }
    if (!(fim > inicio))
      throw recusa('periodo-aquisitivo-invalido', 'O fim do período aquisitivo tem de ser depois do início.');
    const conf = direitoDoPeriodoGravado({ faltas: x.faltas, direito: x.direito }, null);
    if (conf.recusa) throw recusaFerias(conf.recusa);
    const direito = conf.direito;
    const id = await tx.incluir('periodo_aquisitivo', {
      estabelecimento_id: est,
      colaborador_id: colaborador,
      vinculo_trabalho_id: vinculo,
      inicio,
      fim,
      limite_concessivo: somarMeses(fim, 12),
      faltas_injustificadas: conf.faltas,
      dias_direito: direito,
      dias_saldo: direito,
      situacao: fim < x.inicio ? 'adquirido' : 'aberto',
    });
    return { id, direito };
  }

  /**
   * Cancela os recibos vigentes das férias (ao sair de `calculada` ou antes de recalcular): fica um só recibo vivo por
   * programação. Recibo conferido ou pago não se cancela: recusa e a transação inteira se desfaz.
   */
  async function cancelarRecibosVigentes(programacao: number) {
    const vivos = await tx.consultarParaAtualizar(
      `SELECT id, situacao, versao FROM recibo_ferias
        WHERE programacao_ferias_id = ? AND estabelecimento_id = ? AND situacao <> 'cancelado' AND excluido_em IS NULL`,
      [programacao, est],
    );
    if (vivos.some((r) => texto(r['situacao']) !== 'calculado'))
      throw recusa(
        'recibo-ferias-conferido',
        'O recibo destas férias já foi conferido ou pago: as férias não se cancelam nem se recalculam.',
      );
    for (const r of vivos)
      await tx.alterar('recibo_ferias', n(r['id']), n(r['versao']), { situacao: 'cancelado' });
  }

  return {
    async incluirFerias(x) {
      daSessao(x.empresa);
      conferirDiasFerias(x);
      const [v] = await tx.consultarParaAtualizar(
        'SELECT id, colaborador_id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.vinculo, est],
      );
      if (!v) throw recusa('vinculo-inexistente', 'O vínculo não existe neste estabelecimento.');
      await exigirUsuario(tx, x.por);
      const colaborador = n(v['colaborador_id']);
      const { id: periodo, direito } = await periodoAquisitivo(x.vinculo, colaborador, x);
      const tipo = await tx.uma(
        "SELECT id FROM tipo_ferias WHERE ativo = TRUE AND categoria = 'individual' ORDER BY id LIMIT 1",
      );
      if (!tipo)
        throw recusa(
          'catalogo-pendente',
          'O tipo de férias individual não está cadastrado neste cliente: cadastre-o antes de programar férias.',
        );
      const fracoes = await tx.consultarParaAtualizar(
        `SELECT id, numero_parcela, inicio_gozo, dias_gozo, dias_abono FROM programacao_ferias
          WHERE periodo_aquisitivo_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'`,
        [periodo],
      );
      if (fracoes.length >= 3)
        throw recusa(
          'ferias-fracoes-esgotadas',
          'O período aquisitivo já tem três frações de férias (CLT art. 134, § 1º).',
        );
      const cabe = conferirFracaoNoDireito(
        direito,
        fracoes.map((f) => ({ dias: n(f['dias_gozo']), abono: n(f['dias_abono']) })),
        { dias: x.dias, abono: x.abono },
      );
      if (cabe) throw recusaFerias(cabe);
      // A fração seguinte livre (a cancelada com o mesmo número e o mesmo início fica, só de acréscimo).
      const usadas = await tx.consultar(
        'SELECT numero_parcela, inicio_gozo FROM programacao_ferias WHERE periodo_aquisitivo_id = ?',
        [periodo],
      );
      const ocupada = (p: number) =>
        fracoes.some((f) => n(f['numero_parcela']) === p) ||
        usadas.some((f) => n(f['numero_parcela']) === p && dia(f['inicio_gozo']) === x.inicio);
      const parcela = [1, 2, 3].find((p) => !ocupada(p));
      if (parcela === undefined)
        throw recusa(
          'ferias-fracoes-esgotadas',
          'Não há fração livre neste período aquisitivo para este início de gozo.',
        );
      return tx.incluir('programacao_ferias', {
        estabelecimento_id: est,
        colaborador_id: colaborador,
        vinculo_trabalho_id: x.vinculo,
        periodo_aquisitivo_id: periodo,
        tipo_ferias_id: n(tipo['id']),
        numero_parcela: parcela,
        inicio_gozo: x.inicio,
        fim_gozo: x.fim,
        dias_gozo: x.dias,
        dias_abono: x.abono,
        dias_dobra: x.dobra,
        adianta_decimo_terceiro: x.adiantarDecimo,
        pagamento_previsto_em: x.pagamento,
        situacao: 'programada',
      });
    },

    async situacaoFerias(x) {
      const f = await lerFeriasPorId(trava, est, x.id);
      if (!f || f.situacao !== x.de || f.versao !== x.versao) throw desatualizado();
      // Férias em gozo ou gozadas não se cancelam nem se recalculam (o throw desfaz a transação inteira).
      await exigirFeriasAlteravel(trava, est, x.id);
      await exigirUsuario(tx, x.por);
      if (x.de === 'calculada' || x.para === 'calculada') await cancelarRecibosVigentes(x.id);
      if (x.para !== 'calculada') {
        await tx.alterar('programacao_ferias', x.id, x.versao, {
          situacao: FERIAS_GRAVADA[x.para],
          motivo_cancelamento: x.para === 'cancelada' ? x.motivo : null,
        });
        return;
      }
      const processo = x.processo ?? null;
      if (processo === null)
        throw recusa(
          'processo-obrigatorio',
          'Férias calculadas ligam o processamento da folha que as calculou.',
        );
      const [p] = await tx.consultarParaAtualizar(
        'SELECT id FROM processamento_folha WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [processo, est],
      );
      if (!p)
        throw recusa('processo-inexistente', 'O processamento da folha não existe neste estabelecimento.');
      const [pf] = await tx.consultar(
        'SELECT colaborador_id, periodo_aquisitivo_id, aviso_em FROM programacao_ferias WHERE id = ?',
        [x.id],
      );
      const valores = await tx.uma(
        `SELECT COALESCE(SUM(CASE WHEN papel = 'baseInss' THEN valor END), 0) AS base,
                COALESCE(SUM(CASE WHEN papel = 'inssFerias' THEN valor END), 0) AS inss
           FROM processamento_folha_linha WHERE processamento_folha_id = ? AND vinculo_trabalho_id = ?`,
        [processo, f.vinculo],
      );
      const recibos = await tx.uma(
        'SELECT COUNT(*) AS q FROM recibo_ferias WHERE programacao_ferias_id = ?',
        [x.id],
      );
      await tx.alterar('programacao_ferias', x.id, x.versao, {
        situacao: 'calculada',
        motivo_cancelamento: null,
      });
      const avisoProgramado = dia(pf?.['aviso_em']);
      const aviso = avisoProgramado ?? (hoje() < f.inicio ? hoje() : f.inicio);
      await tx.incluir('recibo_ferias', {
        estabelecimento_id: est,
        numero: `FER-${x.id}-${n(recibos?.['q']) + 1}`,
        colaborador_id: n(pf?.['colaborador_id']),
        programacao_ferias_id: x.id,
        periodo_aquisitivo_id: n(pf?.['periodo_aquisitivo_id']),
        processamento_folha_id: processo,
        aviso_em: aviso,
        inicio_gozo: f.inicio,
        fim_gozo: f.fim,
        dias_gozo: f.dias,
        dias_abono: f.abono,
        base_calculo: n(valores?.['base']),
        base_inss: n(valores?.['base']),
        valor_inss: n(valores?.['inss']),
        pagamento_previsto_em: f.pagamento,
        situacao: 'calculado',
      });
    },

    async obrigacoesEmVigorComTrava(empresa, tipo, periodo) {
      daSessao(empresa);
      const competencia = periodoNoBanco(tipo, periodo);
      // Todas as linhas do período (inclusive as fora do formato do cálculo): o número seguinte não colide.
      const [m] = await tx.consultarParaAtualizar(
        `SELECT MAX(numero_retificacao) AS m, COUNT(*) AS q FROM obrigacao_trabalhista
          WHERE estabelecimento_id = ? AND tipo_obrigacao = ? AND competencia = ?`,
        [est, TIPO_NO_BANCO[tipo], competencia],
      );
      const vigentes = (await lerObrigacoes(trava, est, { tipo, periodo })).filter(
        (o) => o.situacao === 'gerada' || o.situacao === 'entregue',
      );
      return {
        vigentes: vigentes.sort((a, b) => b.numero - a.numero),
        proximoNumero: n(m?.['q']) === 0 ? 1 : n(m?.['m']) + 2,
      };
    },

    obrigacaoComTrava: (id) => lerObrigacao(trava, est, id),

    async incluirObrigacao(x) {
      daSessao(x.empresa);
      if (!/^[0-9a-f]{64}$/.test(x.resumo))
        throw recusa('resumo-invalido', 'O resumo do arquivo tem de ser o SHA-256 em hexadecimal.');
      const competencia = periodoNoBanco(x.tipo, x.periodo);
      const repetida = await tx.consultarParaAtualizar(
        `SELECT id FROM obrigacao_trabalhista
          WHERE estabelecimento_id = ? AND tipo_obrigacao = ? AND competencia = ? AND numero_retificacao = ?`,
        [est, TIPO_NO_BANCO[x.tipo], competencia, x.numero - 1],
      );
      if (repetida.length > 0) throw desatualizado();
      const usuario = await exigirUsuario(tx, x.por);
      const fechamentos = [...new Set(x.fechamentos)];
      if (fechamentos.length > 0) {
        const achados = await tx.consultar(
          `SELECT id FROM fechamento_periodo_folha WHERE estabelecimento_id = ? AND id IN (${marcas(fechamentos)})`,
          [est, ...fechamentos],
        );
        if (achados.length !== fechamentos.length)
          throw recusa(
            'fechamento-inexistente',
            'Um dos fechamentos da obrigação não existe neste estabelecimento.',
          );
      }
      if (!opcoes.arquivos) throw semArmazenamento();
      // O arquivo (já cifrado) no disco, gravado uma vez pelo hash; o metadado na mesma transação.
      const bytes = Buffer.from(x.conteudoCifrado, 'utf8');
      if (bytes.byteLength === 0) throw recusa('arquivo-vazio', 'O arquivo da obrigação está vazio.');
      const hash = sha256(bytes);
      const chave = chaveDoArquivo('sistema', est, new Date(), hash);
      await gravarUmaVez(await opcoes.arquivos.caminho(opcoes.cliente, chave), bytes, hash);
      const [atual] = await tx.consultarParaAtualizar(
        'SELECT id, excluido_em FROM arquivo WHERE chave_armazenamento = ?',
        [chave],
      );
      if (atual && atual['excluido_em'] !== null)
        throw recusa(
          'arquivo-excluido',
          'Este arquivo foi excluído do armazenamento: gere a obrigação de novo.',
        );
      const arquivo = atual
        ? n(atual['id'])
        : await tx.incluir('arquivo', {
            estabelecimento_id: est,
            entidade: 'obrigacao_trabalhista',
            entidade_id: null,
            finalidade: 'obrigacao_trabalhista',
            nome_original: x.nomeArquivo,
            tipo_mime: 'text/plain',
            tamanho_bytes: bytes.byteLength,
            hash_sha256: hash,
            chave_armazenamento: chave,
            retencao_ate: null,
            imutavel: true,
            origem: 'sistema',
          });
      const valor =
        x.tipo === 'fgts-digital' || x.tipo === 'sefip'
          ? Math.round((x.totais.fgts + x.totais.rescisorio) * 100) / 100
          : null;
      const id = await tx.incluir('obrigacao_trabalhista', {
        estabelecimento_id: est,
        tipo_obrigacao: TIPO_NO_BANCO[x.tipo],
        competencia,
        numero_retificacao: x.numero - 1,
        prazo_entrega: prazoEntregaObrigacao(x.tipo, x.periodo),
        situacao: 'gerada',
        valor_apurado: valor,
        gerada_em: agoraNoBanco(),
        arquivo_id: arquivo,
        responsavel_usuario_id: usuario,
        leiaute: x.leiaute,
        leiaute_conferido: x.leiauteConferido,
        totais: JSON.stringify(x.totais),
      });
      await tx.incluir('arquivo_obrigacao', {
        obrigacao_trabalhista_id: id,
        sequencia: 1,
        tipo_envio: x.numero > 1 ? 'retificador' : 'original',
        arquivo_id: arquivo,
        hash_sha256: x.resumo,
        gerado_em: agoraNoBanco(),
        gerador_usuario_id: usuario,
        meio_entrega: 'transmissao',
        tamanho_bytes: x.tamanho,
      });
      for (const f of fechamentos)
        await tx.incluir('obrigacao_fechamento', {
          obrigacao_trabalhista_id: id,
          fechamento_periodo_folha_id: f,
        });
      return id;
    },

    async substituirObrigacao(x) {
      await obrigacaoParaTrocar(tx, est, x);
      await exigirUsuario(tx, x.por);
      await tx.alterar('obrigacao_trabalhista', x.id, x.versao, { situacao: 'retificada' });
    },

    async registrarEntregaObrigacao(x) {
      await obrigacaoParaTrocar(tx, est, x);
      await exigirUsuario(tx, x.por);
      await tx.alterar('obrigacao_trabalhista', x.id, x.versao, {
        situacao: 'transmitida',
        protocolo: x.protocolo,
        transmitida_em: x.data,
        valor_guia: x.valorGuia,
        acrescimos: x.acrescimos,
      });
      const [envio] = await tx.consultarParaAtualizar(
        'SELECT id, versao FROM arquivo_obrigacao WHERE obrigacao_trabalhista_id = ? AND sequencia = 1 AND excluido_em IS NULL',
        [x.id],
      );
      if (envio)
        await tx.alterar('arquivo_obrigacao', n(envio['id']), n(envio['versao']), {
          entregue: true,
          entregue_em: x.data,
          numero_recibo: x.protocolo.slice(0, 60),
        });
    },

    async cancelarObrigacao(x) {
      await obrigacaoParaTrocar(tx, est, x);
      await exigirUsuario(tx, x.por);
      await tx.alterar('obrigacao_trabalhista', x.id, x.versao, {
        situacao: 'cancelada',
        motivo_situacao: x.motivo,
      });
    },
  };
}

// ── Leituras ─────────────────────────────────────────────────────────────────────────────────────────────────

export type NucleoLeituraObrigacoes = Pick<NucleoProprio, 'lerSomente'>;

function contextoDe(c: ContextoCalculoFolha): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: c.correlacao.slice(0, 64),
  };
}

/** As leituras das obrigações da porta do cálculo (obrigacoes, obrigacao, conteudoObrigacao, catalogosObrigacoes). */
export class LeiturasObrigacoesFolhaPropria {
  constructor(
    private readonly nucleo: NucleoLeituraObrigacoes,
    private readonly arquivos: ArquivosObrigacoes | null,
  ) {}

  private ler<T>(c: ContextoCalculoFolha, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  obrigacoes(c: ContextoCalculoFolha, f: FiltroObrigacoesDaFolha): Promise<ObrigacaoDaFolha[]> {
    return this.ler(c, (l, est) => lerObrigacoes(l, est, f));
  }

  obrigacao(c: ContextoCalculoFolha, id: number): Promise<ObrigacaoDaFolha | null> {
    return this.ler(c, (l, est) => lerObrigacao(l, est, id));
  }

  /** O arquivo cifrado da obrigação (texto), lido do armazenamento; null se a obrigação não existe na sessão. */
  async conteudoObrigacao(c: ContextoCalculoFolha, id: number): Promise<string | null> {
    const arquivo = await this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_OBRIGACOES} AND o.id = ?`, [est, id]);
      if (!r) return null;
      const a = await l.uma('SELECT arquivo_id FROM obrigacao_trabalhista WHERE id = ?', [id]);
      return numOuNulo(a?.['arquivo_id']);
    });
    if (arquivo === null) return null;
    if (!this.arquivos) throw semArmazenamento();
    const lido = await this.arquivos.ler(contextoDe(c), arquivo);
    return lido.conteudo.toString('utf8');
  }

  /** O catálogo oficial versionado vigente na data (hoje, por omissão): não lê o banco e nunca fica pendente. */
  async catalogosObrigacoes(
    _c: ContextoCalculoFolha,
    data: string = hoje(),
  ): Promise<CatalogoObrigacoesOficiais> {
    return catalogoObrigacoesNa(data);
  }
}
