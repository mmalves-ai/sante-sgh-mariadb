// Programas de saúde e linhas de cuidado do paciente no banco próprio (F8, 02-CAD linha 11). Desenho próprio:
//   - Catálogo do hospital (`linha_cuidado`): código, nome, código no órgão público ou na operadora, público-alvo,
//     critérios de entrada e saída, faixa etária e se exige profissional de referência. Inativar não apaga.
//   - Inscrição do paciente (`paciente_linha_cuidado`): nasce no estado de entrada (o padrão do hospital), com o
//     profissional de referência; uma só inscrição viva por paciente, programa e estabelecimento (domínio e índice único
//     da migração 03_CAD/95). Mudar de estado segue as transições do domínio; o estado final (alta, abandono,
//     transferência, óbito) ou o marcado para encerrar fecha a vigência com o motivo. Nada é apagado.
//   - Histórico (`paciente_linha_cuidado_historico`): cada inclusão e cada mudança grava o retrato completo, com o estado
//     depois da operação e quem fez, na mesma transação (e a trilha do executor junto).
//   - Visão por paciente (as inscrições com a linha do tempo) e painel do programa (inscritos por estado).
// Regras no @sgh/dominio-cadastro; gravações pelo executor (trilha e idempotência na mesma transação). Datas AAAA-MM-DD.
import { randomUUID } from 'node:crypto';
import {
  conferirInscricao,
  conferirMudancaEstado,
  conferirTrocaReferencia,
  encerraAoEntrar,
  type EstadoLinha,
  estadoDeEntrada,
  type EventoHistoricoLinha,
  eventoDoHistorico,
  type TipoEstadoLinha,
  totaisPorEstado,
  TRANSICOES_LINHA,
  UNIDADES_IDADE,
  type UnidadeIdade,
} from '@sgh/dominio-cadastro';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from './porta.js';
import type { NucleoCadastro } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

export const LINHAS_CUIDADO = Symbol('LINHAS_CUIDADO');

type Linha = Record<string, unknown>;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 1n;
const dia = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const ID = z.number().int().positive();
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function recusar(rs: readonly { codigo: string; campo: string; mensagem: string }[]): void {
  const [r] = rs;
  if (r) throw recusa(r.codigo, r.mensagem, { campos: rs.map((x) => x.campo) });
}
const naoAchada = () => new ErroOperacao(404, 'nao-encontrado', 'Não encontrado', 'A inscrição não existe.');

async function hojeDo(tx: Leitor | TxOperacao): Promise<string> {
  const r = await tx.uma("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS hoje");
  return String(r?.['hoje']);
}

async function lerEstados(
  tx: Leitor | TxOperacao,
): Promise<(EstadoLinha & { codigo: string; descricao: string })[]> {
  const rs = await tx.consultar(
    `SELECT id, codigo, descricao, tipo_estado, padrao_ativacao, encerra_inscricao, ativo
       FROM estado_linha_cuidado ORDER BY FIELD(tipo_estado,'incluido','ativo','suspenso','alta','abandono','transferido','obito'), id`,
    [],
    { teto: 200 },
  );
  return rs.map((x) => ({
    id: Number(x['id']),
    codigo: String(x['codigo']),
    descricao: String(x['descricao']),
    tipo: String(x['tipo_estado']) as TipoEstadoLinha,
    padraoAtivacao: bool(x['padrao_ativacao']),
    encerraInscricao: bool(x['encerra_inscricao']),
    ativo: bool(x['ativo']),
  }));
}

const COLUNAS_INSCRICAO = `pl.id, pl.paciente_id, pl.linha_cuidado_id, pl.estabelecimento_id, pl.estado_linha_cuidado_id,
  pl.estado_desde, pl.referencia_profissional_id, pl.vigencia_inicio, pl.vigencia_fim, pl.motivo_saida, pl.ativo,
  pl.versao`;

/** Retrato completo da inscrição para o histórico (sem o nome do paciente). */
async function retrato(tx: TxOperacao, id: number): Promise<Linha> {
  const x = await tx.uma(`SELECT ${COLUNAS_INSCRICAO} FROM paciente_linha_cuidado pl WHERE pl.id = ?`, [id]);
  if (!x) throw naoAchada();
  return {
    id,
    paciente: num(x['paciente_id']),
    linha: num(x['linha_cuidado_id']),
    estabelecimento: num(x['estabelecimento_id']),
    estado: num(x['estado_linha_cuidado_id']),
    estadoDesde: x['estado_desde'] instanceof Date ? x['estado_desde'].toISOString() : txt(x['estado_desde']),
    referencia: num(x['referencia_profissional_id']),
    vigenciaInicio: dia(x['vigencia_inicio']),
    vigenciaFim: dia(x['vigencia_fim']),
    motivoSaida: txt(x['motivo_saida']),
    ativo: bool(x['ativo']),
    versao: num(x['versao']),
  };
}

/**
 * Linha do histórico com o retrato e o evento (inscrição, mudança de estado ou troca de referência); na troca, o
 * retrato leva também o profissional anterior, para a linha do tempo dizer de quem para quem.
 */
async function registrarHistorico(
  tx: TxOperacao,
  id: number,
  evento: Exclude<EventoHistoricoLinha, 'alteracao'>,
  estado: number,
  extra: Linha = {},
): Promise<void> {
  await tx.incluir('paciente_linha_cuidado_historico', {
    paciente_linha_cuidado_id: id,
    operacao: evento === 'inscricao' ? 'inclusao' : 'alteracao',
    dados: JSON.stringify({ ...(await retrato(tx, id)), evento, ...extra }),
    ocorrido_em: new Date(),
    usuario_id: tx.contexto.usuario ?? null,
    estado_linha_cuidado_id: estado,
  });
}

async function conferirReferencia(tx: TxOperacao, referencia: number | null): Promise<void> {
  if (!referencia) return;
  const p = await tx.uma('SELECT id, situacao FROM profissional WHERE id = ? AND excluido_em IS NULL', [
    referencia,
  ]);
  if (!p || p['situacao'] !== 'ativo')
    throw recusa('referencia-inexistente', 'O profissional de referência não existe ou está inativo.', {
      campos: ['referencia'],
    });
}

// ───────────────────────────── Catálogo ─────────────────────────────

export const esquemaLinha = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(3).max(150),
    codigoExterno: z.string().trim().max(30).nullable(),
    publicoAlvo: z.string().trim().max(500).nullable(),
    criterioEntrada: z.string().trim().max(4000).nullable(),
    criterioSaida: z.string().trim().max(4000).nullable(),
    faixaEtaria: ID.nullable(),
    exigeReferencia: z.boolean(),
  })
  .strict();
export type EntradaLinha = z.infer<typeof esquemaLinha>;

const colunasLinha = (e: EntradaLinha) => ({
  codigo: e.codigo.trim(),
  descricao: e.descricao.trim(),
  codigo_externo: e.codigoExterno?.trim() || null,
  publico_alvo: e.publicoAlvo?.trim() || null,
  criterio_entrada: e.criterioEntrada?.trim() || null,
  criterio_saida: e.criterioSaida?.trim() || null,
  faixa_etaria_id: e.faixaEtaria,
  exige_profissional_referencia: e.exigeReferencia,
});

async function codigoLivre(tx: TxOperacao, codigo: string, id: number | null): Promise<void> {
  const r = await tx.uma('SELECT id FROM linha_cuidado WHERE codigo = ? AND id <> ?', [
    codigo.trim(),
    id ?? 0,
  ]);
  if (r) throw recusa('codigo-repetido', 'Já existe programa com este código.', { campos: ['codigo'] });
}

const opIncluirLinha = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.linha_cuidado.incluir',
    tabelas: ['linha_cuidado'],
    entrada: esquemaLinha,
    acao: 'inclusao',
    async gravar(tx, e) {
      await codigoLivre(tx, e.codigo, null);
      return { id: await tx.incluir('linha_cuidado', { ...colunasLinha(e), ativo: true }) };
    },
    alvo: (_e, r) => ({ tabela: 'linha_cuidado', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

const esquemaAlterarLinha = z
  .object({ id: ID, versao: ID, ativo: z.boolean(), entrada: esquemaLinha })
  .strict();
const opAlterarLinha = (t: RegistroTrilhaTela) =>
  definirOperacao({
    nome: 'cadastro.linha_cuidado.alterar',
    tabelas: ['linha_cuidado'],
    entrada: esquemaAlterarLinha,
    acao: 'alteracao',
    async gravar(tx, e) {
      const x = await tx.uma('SELECT id FROM linha_cuidado WHERE id = ?', [e.id]);
      if (!x) throw new ErroOperacao(404, 'nao-encontrado', 'Não encontrado', 'O programa não existe.');
      await codigoLivre(tx, e.entrada.codigo, e.id);
      await tx.alterar('linha_cuidado', e.id, e.versao, { ...colunasLinha(e.entrada), ativo: e.ativo });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'linha_cuidado', id: e.id }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

// ───────────────────────────── Inscrição ─────────────────────────────

export const esquemaInscrever = z
  .object({
    paciente: ID,
    linha: ID,
    referencia: ID.nullable(),
    vigenciaInicio: DATA,
  })
  .strict();
export type EntradaInscrever = z.infer<typeof esquemaInscrever>;

const opInscrever = (t: RegistroTrilhaTela, estabelecimento: number) =>
  definirOperacao({
    nome: 'cadastro.linha_cuidado.inscrever',
    tabelas: ['paciente_linha_cuidado', 'paciente_linha_cuidado_historico'],
    entrada: esquemaInscrever,
    acao: 'inclusao',
    async gravar(tx, e) {
      const p = await tx.uma(
        `SELECT p.id, DATE_FORMAT(f.data_nascimento, '%Y-%m-%d') AS nasc, p.falecido
           FROM paciente p JOIN pessoa_fisica f ON f.id = p.pessoa_fisica_id
          WHERE p.id = ? AND p.excluido_em IS NULL`,
        [e.paciente],
      );
      if (!p) throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['paciente'] });
      const l = await tx.uma(
        `SELECT l.id, l.ativo, l.exige_profissional_referencia, f.idade_inicial, f.idade_final,
                u.unidade_calculo AS unidade
           FROM linha_cuidado l
           LEFT JOIN faixa_etaria f ON f.id = l.faixa_etaria_id
           LEFT JOIN unidade_idade u ON u.id = f.unidade_idade_id
          WHERE l.id = ?`,
        [e.linha],
      );
      if (!l) throw recusa('linha-inexistente', 'O programa não existe.', { campos: ['linha'] });
      const viva = await tx.uma(
        `SELECT id FROM paciente_linha_cuidado WHERE paciente_id = ? AND linha_cuidado_id = ? AND estabelecimento_id = ?
            AND inscricao_viva = 1`,
        [e.paciente, e.linha, estabelecimento],
      );
      // A faixa etária vale na unidade dela (ano, mês, semana, dia ou hora; sem unidade, em anos): nunca é descartada.
      const unidade = txt(l['unidade']);
      if (unidade !== null && !(UNIDADES_IDADE as readonly string[]).includes(unidade))
        throw recusa('faixa-unidade-invalida', 'A unidade da faixa etária do programa não é reconhecida.', {
          campos: ['linha'],
        });
      const temFaixa = l['idade_inicial'] !== null || l['idade_final'] !== null;
      recusar(
        conferirInscricao({
          linhaAtiva: bool(l['ativo']),
          exigeReferencia: bool(l['exige_profissional_referencia']),
          referencia: e.referencia,
          vigenciaInicio: e.vigenciaInicio,
          hoje: await hojeDo(tx),
          nascimento: txt(p['nasc']),
          inscricaoViva: !!viva,
          faixa: temFaixa
            ? {
                minima: num(l['idade_inicial']),
                maxima: num(l['idade_final']),
                unidade: (unidade ?? 'ano') as UnidadeIdade,
              }
            : null,
          pacienteFalecido: bool(p['falecido']),
        }),
      );
      await conferirReferencia(tx, e.referencia);
      const entrada = estadoDeEntrada(await lerEstados(tx));
      if (!entrada)
        throw recusa(
          'sem-estado-de-entrada',
          'O hospital não tem estado de entrada ativo para a inscrição.',
          {
            campos: ['linha'],
          },
        );
      const repetida = await tx.uma(
        `SELECT id FROM paciente_linha_cuidado WHERE paciente_id = ? AND linha_cuidado_id = ? AND estabelecimento_id = ?
            AND vigencia_inicio = ?`,
        [e.paciente, e.linha, estabelecimento, e.vigenciaInicio],
      );
      if (repetida)
        throw recusa(
          'inicio-repetido',
          'Já houve inscrição neste programa com o mesmo início; escolha outra data.',
          {
            campos: ['vigenciaInicio'],
          },
        );
      const id = await tx.incluir('paciente_linha_cuidado', {
        paciente_id: e.paciente,
        linha_cuidado_id: e.linha,
        estabelecimento_id: estabelecimento,
        estado_linha_cuidado_id: entrada.id,
        estado_desde: new Date(`${e.vigenciaInicio}T00:00:00Z`),
        referencia_profissional_id: e.referencia,
        vigencia_inicio: e.vigenciaInicio,
        ativo: true,
      });
      await registrarHistorico(tx, id, 'inscricao', entrada.id);
      return { id };
    },
    alvo: (_e, r) => ({ tabela: 'paciente_linha_cuidado', id: Number(r.id) }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

export const esquemaMudarEstado = z
  .object({
    paciente: ID,
    id: ID,
    versao: ID,
    estado: ID,
    data: DATA,
    motivo: z.string().trim().max(500).nullable(),
  })
  .strict();
export type EntradaMudarEstado = z.infer<typeof esquemaMudarEstado>;

async function inscricaoDoPaciente(tx: TxOperacao, id: number, paciente: number, estabelecimento: number) {
  const x = await tx.uma(
    `SELECT ${COLUNAS_INSCRICAO}, DATE_FORMAT(pl.estado_desde, '%Y-%m-%d') AS desde, e.tipo_estado
       FROM paciente_linha_cuidado pl JOIN estado_linha_cuidado e ON e.id = pl.estado_linha_cuidado_id
      WHERE pl.id = ? AND pl.excluido_em IS NULL`,
    [id],
  );
  if (!x || num(x['paciente_id']) !== paciente) throw naoAchada();
  if (num(x['estabelecimento_id']) !== estabelecimento)
    throw recusa('estabelecimento-fora-da-sessao', 'A inscrição é de outro estabelecimento.', {
      campos: ['id'],
    });
  return x;
}

const opMudarEstado = (t: RegistroTrilhaTela, estabelecimento: number) =>
  definirOperacao({
    nome: 'cadastro.linha_cuidado.mudar_estado',
    tabelas: ['paciente_linha_cuidado', 'paciente_linha_cuidado_historico'],
    entrada: esquemaMudarEstado,
    acao: 'alteracao',
    async gravar(tx, e) {
      const x = await inscricaoDoPaciente(tx, e.id, e.paciente, estabelecimento);
      const estados = await lerEstados(tx);
      const novo = estados.find((s) => s.id === e.estado);
      if (!novo) throw recusa('estado-inexistente', 'O estado escolhido não existe.', { campos: ['estado'] });
      const motivo = e.motivo?.trim() || null;
      recusar(
        conferirMudancaEstado({
          atual: String(x['tipo_estado']) as TipoEstadoLinha,
          atualId: Number(x['estado_linha_cuidado_id']),
          novo,
          inscricaoEncerrada: !bool(x['ativo']) || x['vigencia_fim'] !== null,
          data: e.data,
          hoje: await hojeDo(tx),
          estadoDesde: String(x['desde']),
          motivo,
        }),
      );
      const encerra = encerraAoEntrar(novo);
      await tx.alterar('paciente_linha_cuidado', e.id, e.versao, {
        estado_linha_cuidado_id: novo.id,
        estado_desde: new Date(`${e.data}T00:00:00Z`),
        ...(encerra ? { vigencia_fim: e.data, ativo: false, motivo_saida: motivo } : {}),
      });
      await registrarHistorico(tx, e.id, 'estado', novo.id);
      return { id: e.id, encerrada: encerra ? 1 : 0 };
    },
    alvo: (e) => ({ tabela: 'paciente_linha_cuidado', id: e.id }),
    trilha: (e) => ({
      dados: { ...(t.dadosDepois ?? {}), estado: e.estado },
      motivo: e.motivo?.trim() || null,
    }),
  });

export const esquemaReferencia = z
  .object({ paciente: ID, id: ID, versao: ID, referencia: ID.nullable() })
  .strict();
const opReferencia = (t: RegistroTrilhaTela, estabelecimento: number) =>
  definirOperacao({
    nome: 'cadastro.linha_cuidado.referencia',
    tabelas: ['paciente_linha_cuidado', 'paciente_linha_cuidado_historico'],
    entrada: esquemaReferencia,
    acao: 'alteracao',
    async gravar(tx, e) {
      const x = await inscricaoDoPaciente(tx, e.id, e.paciente, estabelecimento);
      const l = await tx.uma('SELECT exige_profissional_referencia FROM linha_cuidado WHERE id = ?', [
        num(x['linha_cuidado_id']),
      ]);
      const anterior = num(x['referencia_profissional_id']);
      recusar(
        conferirTrocaReferencia({
          inscricaoEncerrada: !bool(x['ativo']) || x['vigencia_fim'] !== null,
          exigeReferencia: bool(l?.['exige_profissional_referencia']),
          atual: anterior,
          nova: e.referencia,
        }),
      );
      await conferirReferencia(tx, e.referencia);
      await tx.alterar('paciente_linha_cuidado', e.id, e.versao, {
        referencia_profissional_id: e.referencia,
      });
      await registrarHistorico(tx, e.id, 'referencia', Number(x['estado_linha_cuidado_id']), {
        referenciaAnterior: anterior,
      });
      return { id: e.id };
    },
    alvo: (e) => ({ tabela: 'paciente_linha_cuidado', id: e.id }),
    trilha: () => ({ dados: t.dadosDepois ?? null, motivo: null }),
  });

// ───────────────────────────── Leituras ─────────────────────────────

export interface LinhaCuidado {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly codigoExterno: string | null;
  readonly publicoAlvo: string | null;
  readonly criterioEntrada: string | null;
  readonly criterioSaida: string | null;
  readonly faixaEtaria: number | null;
  readonly exigeReferencia: boolean;
  readonly ativo: boolean;
  readonly versao: number;
  readonly inscritosVivos: number;
  readonly encerradas: number;
  readonly porEstado: Partial<Record<TipoEstadoLinha, number>>;
}

export interface OpcoesLinhas {
  readonly linhas: readonly LinhaCuidado[];
  readonly estados: readonly {
    id: number;
    codigo: string;
    descricao: string;
    tipo: TipoEstadoLinha;
    encerra: boolean;
    ativo: boolean;
  }[];
  readonly faixas: readonly { id: number; descricao: string }[];
}

export interface HistoricoInscricao {
  readonly ocorridoEm: string;
  readonly operacao: string;
  /** O que aconteceu: inscrição, mudança de estado ou troca do profissional de referência. */
  readonly evento: EventoHistoricoLinha;
  readonly estado: string;
  /** Na troca de referência: de quem para quem (nome; null quando sem profissional). */
  readonly referenciaDe: string | null;
  readonly referenciaPara: string | null;
  readonly usuario: string | null;
}

export interface InscricaoDoPaciente {
  readonly id: number;
  readonly linha: { id: number; codigo: string; descricao: string };
  readonly estado: { id: number; descricao: string; tipo: TipoEstadoLinha };
  readonly estadoDesde: string;
  readonly referencia: { id: number; nome: string } | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly motivoSaida: string | null;
  readonly encerrada: boolean;
  readonly versao: number;
  /** Para onde a inscrição pode ir (ids de estado), pelas transições do domínio. */
  readonly proximos: readonly number[];
  readonly historico: readonly HistoricoInscricao[];
}

export interface InscritoDoPrograma {
  readonly inscricao: number;
  readonly paciente: number;
  /** Nome do paciente; o de acesso restrito (confidencial ou VIP) sai pelo pseudônimo, nunca pelo nome. */
  readonly nome: string;
  readonly restrito: boolean;
  readonly estado: string;
  readonly tipo: TipoEstadoLinha;
  readonly estadoDesde: string;
  readonly vigenciaInicio: string;
  readonly referencia: string | null;
}

export class LinhasCuidadoPropria {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoCadastro,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'linhas-cuidado' },
      fn,
    );
  }

  private async estabelecimento(c: ContextoPorta): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const r = c.hospital
      ? await this.ler(c, (l) =>
          l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
            c.hospital,
          ]),
        )
      : null;
    if (!r)
      throw new ErroOperacao(
        403,
        'sem-estabelecimento',
        'Sem estabelecimento',
        'A sessão não tem estabelecimento.',
      );
    return Number(r.id);
  }

  private async executar<E>(
    c: ContextoPorta,
    op: Parameters<Executor['executar']>[0],
    entrada: E,
    t: RegistroTrilhaTela,
    chave?: string,
  ): Promise<Record<string, unknown>> {
    const est = await this.estabelecimento(c);
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: t.estabelecimento ?? est,
      usuario: t.usuario ?? c.usuario,
      correlacao: (t.correlacao ?? c.correlacao).slice(0, 64) || 'linhas-cuidado',
      chaveIdempotencia: chave ?? `direta:${randomUUID()}`,
    };
    const x = await this.executor.executar(op, this.cliente, entrada, ctx);
    return x.resultado as Record<string, unknown>;
  }

  /** Catálogo com o painel de cada programa (inscritos do estabelecimento por estado), os estados e as faixas. */
  async opcoes(c: ContextoPorta): Promise<OpcoesLinhas> {
    const est = await this.estabelecimento(c);
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT id, codigo, descricao, codigo_externo, publico_alvo, criterio_entrada, criterio_saida, faixa_etaria_id,
                exige_profissional_referencia, ativo, versao
           FROM linha_cuidado ORDER BY ativo DESC, descricao`,
        [],
        { teto: 1000 },
      );
      const cont = await l.consultar(
        `SELECT pl.linha_cuidado_id, e.tipo_estado, (pl.inscricao_viva IS NULL) AS encerrada, COUNT(*) AS n
           FROM paciente_linha_cuidado pl JOIN estado_linha_cuidado e ON e.id = pl.estado_linha_cuidado_id
          WHERE pl.estabelecimento_id = ? AND pl.excluido_em IS NULL
          GROUP BY pl.linha_cuidado_id, e.tipo_estado, encerrada`,
        [est],
        { teto: 10000 },
      );
      const estados = await lerEstados(l);
      const faixas = await l.consultar(
        'SELECT id, descricao FROM faixa_etaria WHERE ativo ORDER BY ordem, descricao',
        [],
        { teto: 500 },
      );
      return {
        linhas: linhas.map((x) => {
          const id = Number(x['id']);
          const minhas = cont
            .filter((k) => Number(k['linha_cuidado_id']) === id)
            .flatMap((k) =>
              Array.from({ length: Number(k['n']) }, () => ({
                tipo: String(k['tipo_estado']) as TipoEstadoLinha,
                encerrada: bool(k['encerrada']),
              })),
            );
          const tot = totaisPorEstado(minhas);
          return {
            id,
            codigo: String(x['codigo']),
            descricao: String(x['descricao']),
            codigoExterno: txt(x['codigo_externo']),
            publicoAlvo: txt(x['publico_alvo']),
            criterioEntrada: txt(x['criterio_entrada']),
            criterioSaida: txt(x['criterio_saida']),
            faixaEtaria: num(x['faixa_etaria_id']),
            exigeReferencia: bool(x['exige_profissional_referencia']),
            ativo: bool(x['ativo']),
            versao: Number(x['versao']),
            inscritosVivos: tot.vivas,
            encerradas: tot.encerradas,
            porEstado: tot.porEstado,
          };
        }),
        estados: estados.map((s) => ({
          id: s.id,
          codigo: s.codigo,
          descricao: s.descricao,
          tipo: s.tipo,
          encerra: encerraAoEntrar(s),
          ativo: s.ativo,
        })),
        faixas: faixas.map((x) => ({ id: Number(x['id']), descricao: String(x['descricao']) })),
      };
    });
  }

  /**
   * Busca do profissional de referência (até 20 ativos pelo nome): só id e nome, para quem inscreve no programa sem
   * precisar da leitura do cadastro de profissionais.
   */
  profissionais(c: ContextoPorta, termo: string): Promise<{ id: number; nome: string }[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT p.id, COALESCE(p.nome_exibicao, pf.nome) AS nome
             FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE p.excluido_em IS NULL AND p.situacao = 'ativo' AND (pf.nome LIKE ? OR p.nome_exibicao LIKE ?)
            ORDER BY nome LIMIT 20`,
          [`%${termo.replace(/[%_]/g, '')}%`, `%${termo.replace(/[%_]/g, '')}%`],
        )
      ).map((r) => ({ id: Number(r['id']), nome: String(r['nome']) })),
    );
  }

  /** As inscrições do paciente no estabelecimento, vivas primeiro, com a linha do tempo de cada uma. */
  async doPaciente(c: ContextoPorta, paciente: number): Promise<InscricaoDoPaciente[]> {
    const est = await this.estabelecimento(c);
    return this.ler(c, async (l) => {
      const p = await l.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [paciente]);
      if (!p) throw new ErroOperacao(404, 'nao-encontrado', 'Não encontrado', 'O paciente não existe.');
      const estados = await lerEstados(l);
      const rs = await l.consultar(
        `SELECT ${COLUNAS_INSCRICAO}, DATE_FORMAT(pl.estado_desde, '%Y-%m-%d') AS desde,
                DATE_FORMAT(pl.vigencia_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(pl.vigencia_fim, '%Y-%m-%d') AS fim,
                lc.codigo AS lc_codigo, lc.descricao AS lc_descricao, e.descricao AS e_descricao, e.tipo_estado,
                COALESCE(pr.nome_exibicao, rf.nome) AS ref_nome
           FROM paciente_linha_cuidado pl
           JOIN linha_cuidado lc ON lc.id = pl.linha_cuidado_id
           JOIN estado_linha_cuidado e ON e.id = pl.estado_linha_cuidado_id
           LEFT JOIN profissional pr ON pr.id = pl.referencia_profissional_id
           LEFT JOIN pessoa_fisica rf ON rf.id = pr.pessoa_fisica_id
          WHERE pl.paciente_id = ? AND pl.estabelecimento_id = ? AND pl.excluido_em IS NULL
          ORDER BY (pl.inscricao_viva IS NULL), pl.vigencia_inicio DESC, pl.id DESC`,
        [paciente, est],
        { teto: 500 },
      );
      const ids = rs.map((x) => Number(x['id']));
      const hist = ids.length
        ? await l.consultar(
            `SELECT h.paciente_linha_cuidado_id, DATE_FORMAT(h.ocorrido_em, '%Y-%m-%dT%H:%i:%s') AS quando, h.operacao,
                    e.descricao AS estado, u.login, h.estado_linha_cuidado_id AS estado_id,
                    JSON_UNQUOTE(JSON_EXTRACT(h.dados, '$.evento')) AS evento,
                    JSON_EXTRACT(h.dados, '$.referencia') AS ref_id,
                    JSON_EXTRACT(h.dados, '$.referenciaAnterior') AS ref_anterior
               FROM paciente_linha_cuidado_historico h
               JOIN estado_linha_cuidado e ON e.id = h.estado_linha_cuidado_id
               LEFT JOIN usuario u ON u.id = h.usuario_id
              WHERE h.paciente_linha_cuidado_id IN (${ids.map(() => '?').join(',')})
              ORDER BY h.ocorrido_em, h.id`,
            ids,
            { teto: 5000 },
          )
        : [];
      // Nomes dos profissionais citados nas trocas de referência (o retrato guarda só o id).
      const citados = [
        ...new Set(
          hist
            .flatMap((h) => [num(h['ref_id']), num(h['ref_anterior'])])
            .filter((v): v is number => v !== null && Number.isFinite(v)),
        ),
      ];
      const nomes = new Map<number, string>();
      if (citados.length)
        for (const r of await l.consultar(
          `SELECT pr.id, COALESCE(pr.nome_exibicao, rf.nome) AS nome
             FROM profissional pr LEFT JOIN pessoa_fisica rf ON rf.id = pr.pessoa_fisica_id
            WHERE pr.id IN (${citados.map(() => '?').join(',')})`,
          citados,
          { teto: 500 },
        ))
          nomes.set(Number(r['id']), String(r['nome'] ?? ''));
      const nomeDe = (v: number | null) => (v === null ? null : (nomes.get(v) ?? null));
      return rs.map((x) => {
        const id = Number(x['id']);
        const tipo = String(x['tipo_estado']) as TipoEstadoLinha;
        const encerrada = !bool(x['ativo']) || x['fim'] !== null;
        return {
          id,
          linha: {
            id: Number(x['linha_cuidado_id']),
            codigo: String(x['lc_codigo']),
            descricao: String(x['lc_descricao']),
          },
          estado: { id: Number(x['estado_linha_cuidado_id']), descricao: String(x['e_descricao']), tipo },
          estadoDesde: String(x['desde']),
          referencia:
            x['referencia_profissional_id'] !== null
              ? { id: Number(x['referencia_profissional_id']), nome: String(x['ref_nome'] ?? '') }
              : null,
          vigenciaInicio: String(x['inicio']),
          vigenciaFim: txt(x['fim']),
          motivoSaida: txt(x['motivo_saida']),
          encerrada,
          versao: Number(x['versao']),
          proximos: encerrada
            ? []
            : estados.filter((s) => s.ativo && TRANSICOES_LINHA[tipo].includes(s.tipo)).map((s) => s.id),
          historico: hist
            .filter((h) => Number(h['paciente_linha_cuidado_id']) === id)
            .map((h, i, todas) => {
              const ant = i > 0 ? todas[i - 1] : undefined;
              const evento = eventoDoHistorico(
                ant ? { estado: num(ant['estado_id']), referencia: num(ant['ref_id']) } : null,
                { estado: num(h['estado_id']), referencia: num(h['ref_id']), evento: txt(h['evento']) },
              );
              const troca = evento === 'referencia';
              return {
                ocorridoEm: String(h['quando']),
                operacao: String(h['operacao']),
                evento,
                estado: String(h['estado']),
                referenciaDe: troca
                  ? nomeDe(
                      h['ref_anterior'] !== null ? num(h['ref_anterior']) : ant ? num(ant['ref_id']) : null,
                    )
                  : null,
                referenciaPara: troca ? nomeDe(num(h['ref_id'])) : null,
                usuario: txt(h['login']),
              };
            }),
        };
      });
    });
  }

  /** Inscritos do programa no estabelecimento (vivos; com `todos`, também os encerrados). */
  async inscritos(c: ContextoPorta, linha: number, todos: boolean): Promise<InscritoDoPrograma[]> {
    const est = await this.estabelecimento(c);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT pl.id, pl.paciente_id, pf.nome, e.descricao AS estado, e.tipo_estado,
                  (SELECT COALESCE(MAX(ar.pseudonimo), '') FROM paciente_acesso_restrito ar
                    WHERE ar.paciente_id = pl.paciente_id AND ar.situacao = 'ativa' AND ar.excluido_em IS NULL
                      AND ar.vigencia_inicio <= NOW(3) AND (ar.vigencia_fim IS NULL OR ar.vigencia_fim > NOW(3))
                      AND (ar.estabelecimento_id IS NULL OR ar.estabelecimento_id = pl.estabelecimento_id)
                   HAVING COUNT(*) > 0) AS restrito,
                  DATE_FORMAT(pl.estado_desde, '%Y-%m-%d') AS desde, DATE_FORMAT(pl.vigencia_inicio, '%Y-%m-%d') AS inicio,
                  COALESCE(pr.nome_exibicao, rf.nome) AS ref_nome
             FROM paciente_linha_cuidado pl
             JOIN paciente p ON p.id = pl.paciente_id
             JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
             JOIN estado_linha_cuidado e ON e.id = pl.estado_linha_cuidado_id
             LEFT JOIN profissional pr ON pr.id = pl.referencia_profissional_id
           LEFT JOIN pessoa_fisica rf ON rf.id = pr.pessoa_fisica_id
            WHERE pl.linha_cuidado_id = ? AND pl.estabelecimento_id = ? AND pl.excluido_em IS NULL
              ${todos ? '' : 'AND pl.inscricao_viva = 1'}
            ORDER BY pf.nome, pl.id
            LIMIT 1000`,
          [linha, est],
          { teto: 1000 },
        )
      ).map((x) => ({
        inscricao: Number(x['id']),
        paciente: Number(x['paciente_id']),
        // Lista nominal: paciente com marca de acesso restrito viva sai pelo pseudônimo (02-CAD linha 10).
        nome:
          x['restrito'] === null || x['restrito'] === undefined
            ? String(x['nome'])
            : String(x['restrito']) || 'Paciente com acesso restrito',
        restrito: x['restrito'] !== null && x['restrito'] !== undefined,
        estado: String(x['estado']),
        tipo: String(x['tipo_estado']) as TipoEstadoLinha,
        estadoDesde: String(x['desde']),
        vigenciaInicio: String(x['inicio']),
        referencia: txt(x['ref_nome']),
      })),
    );
  }

  async incluirLinha(
    c: ContextoPorta,
    e: EntradaLinha,
    t: RegistroTrilhaTela,
    chave?: string,
  ): Promise<number> {
    return Number((await this.executar(c, opIncluirLinha(t), e, t, chave))['id']);
  }

  async alterarLinha(
    c: ContextoPorta,
    e: { id: number; versao: number; ativo: boolean; entrada: EntradaLinha },
    t: RegistroTrilhaTela,
    chave?: string,
  ): Promise<number> {
    return Number((await this.executar(c, opAlterarLinha(t), e, t, chave))['id']);
  }

  async inscrever(
    c: ContextoPorta,
    e: EntradaInscrever,
    t: RegistroTrilhaTela,
    chave?: string,
  ): Promise<number> {
    const est = await this.estabelecimento(c);
    return Number((await this.executar(c, opInscrever(t, est), e, t, chave))['id']);
  }

  async mudarEstado(
    c: ContextoPorta,
    e: EntradaMudarEstado,
    t: RegistroTrilhaTela,
    chave?: string,
  ): Promise<{ id: number; encerrada: boolean }> {
    const est = await this.estabelecimento(c);
    const r = await this.executar(c, opMudarEstado(t, est), e, t, chave);
    return { id: Number(r['id']), encerrada: Number(r['encerrada']) === 1 };
  }

  async alterarReferencia(
    c: ContextoPorta,
    e: z.infer<typeof esquemaReferencia>,
    t: RegistroTrilhaTela,
    chave?: string,
  ): Promise<number> {
    const est = await this.estabelecimento(c);
    return Number((await this.executar(c, opReferencia(t, est), e, t, chave))['id']);
  }
}
