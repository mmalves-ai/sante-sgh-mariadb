// Diferença de acomodação cobrada do paciente (F3.4, 04-INT linha 81), no banco do cliente. A regra é do domínio
// (@sgh/dominio-faturamento, conta/diferenca-acomodacao.ts: validação na hora e cobrança por dia de diária); a porta lê e
// grava diferenca_acomodacao e, na mesma transação, apura a conta particular da diferença (faturamento/conta-entrada.ts:
// lançamento "diferenca:<id>" por dia de diária na acomodação utilizada, com o valor diário combinado).
// - registrar: a proposta, com a fonte pagadora da internação (a de direito pelo plano) e o período;
// - aceitar: o aceite do paciente ou do responsável (nome e instante) e a conta particular onde a diferença é cobrada (a
//   informada ou a única conta do atendimento em outra fonte pagadora); a apuração lança os dias devidos;
// - recusar (só a proposta), encerrar (a aceita, no dia informado ou hoje) e cancelar (a proposta ou a aceita): a
//   apuração refaz a conta particular (os dias que deixaram de valer são estornados; nada se apaga).
import { FUSO_PADRAO, instanteParaDataHora } from '@sgh/contratos';
import { type DiferencaAcomodacao, type SituacaoDiferenca, validarDiferenca } from '@sgh/dominio-faturamento';
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
import { apurarConta, TABELAS_CONTA_ENTRADA } from '../faturamento/conta-entrada.js';

export const PORTA_DIFERENCA_ACOMODACAO = Symbol('PORTA_DIFERENCA_ACOMODACAO');

const T_DIFERENCA = 'diferenca_acomodacao';
const num = (v: unknown) => Number(v ?? 0);
const numOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const hoje = () => instanteParaDataHora(new Date().toISOString(), FUSO_PADRAO).data;

export const esquemaRegistrarDiferenca = z
  .object({
    internacao: z.number().int().positive(),
    direito: z.number().int().positive(),
    utilizada: z.number().int().positive(),
    item: z.number().int().positive().nullable().optional(),
    valorDiario: z.number().min(0).max(9_999_999),
    inicio: z.string().regex(DIA),
    fim: z.string().regex(DIA).nullable().optional(),
  })
  .strict();
export const esquemaAceitarDiferenca = z
  .object({
    diferenca: z.number().int().positive(),
    versao: z.number().int().positive(),
    responsavel: z.string().trim().min(3).max(150),
    conta: z.number().int().positive().nullable().optional(),
  })
  .strict();
export const esquemaDecidirDiferenca = z
  .object({
    diferenca: z.number().int().positive(),
    versao: z.number().int().positive(),
    acao: z.enum(['recusar', 'encerrar', 'cancelar']),
    fim: z.string().regex(DIA).nullable().optional(),
  })
  .strict();
export type EntradaRegistrarDiferenca = z.infer<typeof esquemaRegistrarDiferenca>;
export type EntradaAceitarDiferenca = z.infer<typeof esquemaAceitarDiferenca>;
export type EntradaDecidirDiferenca = z.infer<typeof esquemaDecidirDiferenca>;

interface Gravado extends ResultadoOperacao {
  readonly id: number;
  readonly lancados: number;
  readonly estornados: number;
}

function exigirEstabelecimento(tx: TxOperacao): number {
  const est = tx.contexto.estabelecimento;
  if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
  return est;
}

async function diferencaParaAlterar(tx: TxOperacao, est: number, id: number, versao: number) {
  const [d] = await tx.consultarParaAtualizar<Linha>(
    `SELECT d.*, DATE_FORMAT(d.inicio_em, '%Y-%m-%d') AS inicio, DATE_FORMAT(d.fim_em, '%Y-%m-%d') AS fim,
            i.atendimento_id
       FROM diferenca_acomodacao d JOIN internacao i ON i.id = d.internacao_id
      WHERE d.id = ? AND i.estabelecimento_id = ? AND d.excluido_em IS NULL`,
    [id, est],
  );
  if (!d) throw recusa('registro-inexistente', 'A diferença de acomodação não existe neste estabelecimento.');
  if (num(d['versao']) !== versao)
    throw recusa('versao-desatualizada', 'A diferença foi alterada por outra pessoa: recarregue e confira.');
  return d;
}

const comoDominio = (d: Linha, mudar: Partial<DiferencaAcomodacao> = {}): DiferencaAcomodacao => ({
  id: num(d['id']),
  direito: num(d['direito_categoria_acomodacao_id']),
  utilizada: num(d['utilizada_categoria_acomodacao_id']),
  item: numOuNulo(d['item_faturavel_id']),
  valorDiario: num(d['valor_diario']),
  inicio: texto(d['inicio']),
  fim: d['fim'] === null || d['fim'] === undefined ? null : texto(d['fim']),
  situacao: texto(d['situacao']) as SituacaoDiferenca,
  aceite: Boolean(num(d['aceite_paciente'])),
  ...mudar,
});

async function reapurar(tx: TxOperacao, est: number, conta: number | null) {
  if (conta === null) return { lancados: 0, estornados: 0 };
  const r = await apurarConta(tx, est, conta);
  return { lancados: r.lancados, estornados: r.estornados };
}

async function registrar(tx: TxOperacao, e: EntradaRegistrarDiferenca): Promise<Gravado> {
  const est = exigirEstabelecimento(tx);
  const i = await tx.uma<Linha>(
    `SELECT i.id, i.situacao, a.fonte_pagadora_id FROM internacao i JOIN atendimento a ON a.id = i.atendimento_id
      WHERE i.id = ? AND i.estabelecimento_id = ? AND i.excluido_em IS NULL`,
    [e.internacao, est],
  );
  if (!i) throw recusa('registro-inexistente', 'A internação não existe neste estabelecimento.');
  if (texto(i['situacao']) === 'cancelada')
    throw recusa('internacao-cancelada', 'A internação foi excluída: não há diferença a cobrar.');
  if (i['fonte_pagadora_id'] === null)
    throw recusa('sem-fonte-pagadora', 'A internação não tem fonte pagadora: não há acomodação de direito.');
  const erro = validarDiferenca({
    id: 0,
    direito: e.direito,
    utilizada: e.utilizada,
    item: e.item ?? null,
    valorDiario: e.valorDiario,
    inicio: e.inicio,
    fim: e.fim ?? null,
    situacao: 'proposta',
    aceite: false,
  });
  if (erro) throw recusa('diferenca-invalida', erro);
  const id = await tx.incluir(T_DIFERENCA, {
    internacao_id: e.internacao,
    fonte_pagadora_id: num(i['fonte_pagadora_id']),
    direito_categoria_acomodacao_id: e.direito,
    utilizada_categoria_acomodacao_id: e.utilizada,
    item_faturavel_id: e.item ?? null,
    valor_diario: e.valorDiario,
    inicio_em: e.inicio,
    fim_em: e.fim ?? null,
    situacao: 'proposta',
    origem: 'sistema',
  });
  return { id, lancados: 0, estornados: 0 };
}

async function aceitar(tx: TxOperacao, e: EntradaAceitarDiferenca): Promise<Gravado> {
  const est = exigirEstabelecimento(tx);
  const d = await diferencaParaAlterar(tx, est, e.diferenca, e.versao);
  if (texto(d['situacao']) !== 'proposta')
    throw recusa('situacao-invalida', 'Só a diferença proposta recebe o aceite.');
  const erro = validarDiferenca(comoDominio(d, { situacao: 'aceita', aceite: true }));
  if (erro) throw recusa('diferenca-invalida', erro);
  // A conta particular: a informada ou a única do atendimento em outra fonte pagadora (nunca "a primeira").
  const contas = await tx.consultar<Linha>(
    `SELECT id FROM conta_hospitalar WHERE atendimento_id = ? AND fonte_pagadora_id <> ? AND situacao <> 'cancelada'
        AND excluido_em IS NULL ORDER BY id`,
    [num(d['atendimento_id']), num(d['fonte_pagadora_id'])],
    { teto: 50 },
  );
  const ids = contas.map((c) => num(c['id']));
  const conta = e.conta ?? (ids.length === 1 ? ids[0]! : null);
  if (conta === null)
    throw recusa(
      'sem-conta-particular',
      ids.length === 0
        ? 'O atendimento não tem conta particular: abra a conta do paciente no faturamento e aceite de novo.'
        : 'O atendimento tem mais de uma conta em outra fonte pagadora: escolha a conta da diferença.',
    );
  if (!ids.includes(conta))
    throw recusa('conta-invalida', 'A conta escolhida não é uma conta particular deste atendimento.');
  await tx.alterar(T_DIFERENCA, e.diferenca, e.versao, {
    situacao: 'aceita',
    aceite_paciente: true,
    aceite_em: new Date(),
    aceite_responsavel_nome: e.responsavel,
    conta_hospitalar_id: conta,
  });
  return { id: e.diferenca, ...(await reapurar(tx, est, conta)) };
}

async function decidir(tx: TxOperacao, e: EntradaDecidirDiferenca): Promise<Gravado> {
  const est = exigirEstabelecimento(tx);
  const d = await diferencaParaAlterar(tx, est, e.diferenca, e.versao);
  const situacao = texto(d['situacao']) as SituacaoDiferenca;
  const conta = numOuNulo(d['conta_hospitalar_id']);
  let mudar: Record<string, unknown>;
  if (e.acao === 'recusar') {
    if (situacao !== 'proposta')
      throw recusa('situacao-invalida', 'Só a diferença proposta pode ser recusada.');
    mudar = { situacao: 'recusada' };
  } else if (e.acao === 'encerrar') {
    if (situacao !== 'aceita') throw recusa('situacao-invalida', 'Só a diferença aceita pode ser encerrada.');
    const fim = e.fim ?? hoje();
    const erro = validarDiferenca(comoDominio(d, { fim, situacao: 'encerrada' }));
    if (erro) throw recusa('diferenca-invalida', erro);
    mudar = { situacao: 'encerrada', fim_em: fim };
  } else {
    if (situacao !== 'proposta' && situacao !== 'aceita')
      throw recusa('situacao-invalida', 'Só a diferença proposta ou aceita pode ser cancelada.');
    mudar = { situacao: 'cancelada' };
  }
  await tx.alterar(T_DIFERENCA, e.diferenca, e.versao, mudar);
  return { id: e.diferenca, ...(await reapurar(tx, est, conta)) };
}

const TABELAS = [T_DIFERENCA, ...TABELAS_CONTA_ENTRADA];
export const opRegistrarDiferenca = definirOperacao<EntradaRegistrarDiferenca, Gravado>({
  nome: 'internacao.registrar_diferenca_acomodacao',
  tabelas: [T_DIFERENCA],
  entrada: esquemaRegistrarDiferenca,
  gravar: registrar,
  alvo: (_e, r) => ({ tabela: T_DIFERENCA, id: r.id }),
});
export const opAceitarDiferenca = definirOperacao<EntradaAceitarDiferenca, Gravado>({
  nome: 'internacao.aceitar_diferenca_acomodacao',
  tabelas: TABELAS,
  entrada: esquemaAceitarDiferenca,
  gravar: aceitar,
  alvo: (_e, r) => ({ tabela: T_DIFERENCA, id: r.id }),
});
export const opDecidirDiferenca = definirOperacao<EntradaDecidirDiferenca, Gravado>({
  nome: 'internacao.decidir_diferenca_acomodacao',
  tabelas: TABELAS,
  entrada: esquemaDecidirDiferenca,
  gravar: decidir,
  alvo: (_e, r) => ({ tabela: T_DIFERENCA, id: r.id }),
});

// ---------------------------------------------------------------- leitura (visão por paciente)

export interface Opcao {
  readonly id: number;
  readonly rotulo: string;
}
export interface DiferencaVisao {
  readonly id: number;
  readonly versao: number;
  readonly direito: Opcao;
  readonly utilizada: Opcao;
  readonly item: Opcao | null;
  readonly valorDiario: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly situacao: SituacaoDiferenca;
  readonly aceiteEm: string | null;
  readonly responsavel: string | null;
  readonly conta: string | null;
  /** Dias cobrados (lançamentos vigentes) e o total cobrado na conta particular. */
  readonly diasCobrados: number;
  readonly totalCobrado: number;
}
export interface DiferencasDoAtendimento {
  readonly atendimento: string;
  readonly internacao: number;
  readonly situacaoInternacao: string;
  readonly acomodacaoAtual: Opcao | null;
  readonly diferencas: readonly DiferencaVisao[];
  readonly contasParticulares: readonly Opcao[];
  readonly acomodacoes: readonly Opcao[];
  readonly itens: readonly Opcao[];
  readonly hoje: string;
}

export interface NucleoDiferencaAcomodacao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}
export interface ContextoDiferenca {
  readonly hospital: string;
  readonly login: string;
}
export type ContextoGravacaoDiferenca = ContextoDiferenca & {
  readonly correlacao: string;
  readonly chaveIdempotencia: string;
  readonly enderecoIp?: string;
};

export class PortaDiferencaAcomodacaoPropria {
  private readonly executor: Executor;
  constructor(
    private readonly nucleo: NucleoDiferencaAcomodacao,
    private readonly cliente: string,
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'diferenca-acomodacao' }, fn);
  }

  private async quem(l: Leitor, c: ContextoDiferenca) {
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

  /** A visão por paciente: a internação do atendimento, as diferenças com o cobrado e as opções da tela. */
  doAtendimento(c: ContextoDiferenca, numero: string): Promise<DiferencasDoAtendimento> {
    return this.ler(async (l) => {
      const { estabelecimento } = await this.quem(l, c);
      const i = await l.uma(
        `SELECT i.id, i.situacao, i.atendimento_id, a.fonte_pagadora_id, a.numero
           FROM internacao i JOIN atendimento a ON a.id = i.atendimento_id
          WHERE a.numero = ? AND i.estabelecimento_id = ? AND i.excluido_em IS NULL ORDER BY i.id DESC LIMIT 1`,
        [numero.trim(), estabelecimento],
      );
      if (!i)
        throw new ErroOperacao(
          404,
          'registro-inexistente',
          'Internação',
          'Não há internação com este atendimento.',
        );
      const atual = await l.uma(
        `SELECT ca.id, ca.descricao FROM ocupacao_leito ol LEFT JOIN acomodacao ac ON ac.id = ol.acomodacao_id
           JOIN categoria_acomodacao ca ON ca.id = COALESCE(ol.categoria_acomodacao_id, ac.categoria_acomodacao_id)
          WHERE ol.internacao_id = ? AND ol.situacao <> 'cancelada' AND ol.excluido_em IS NULL
          ORDER BY ol.data_hora_inicio DESC, ol.id DESC LIMIT 1`,
        [num(i['id'])],
      );
      const linhas = await l.consultar(
        `SELECT d.id, d.versao, d.direito_categoria_acomodacao_id AS direito, cd.descricao AS direito_nome,
                d.utilizada_categoria_acomodacao_id AS utilizada, cu.descricao AS utilizada_nome, d.item_faturavel_id,
                it.codigo AS item_codigo, it.descricao AS item_nome, d.valor_diario,
                DATE_FORMAT(d.inicio_em, '%Y-%m-%d') AS inicio, DATE_FORMAT(d.fim_em, '%Y-%m-%d') AS fim, d.situacao,
                DATE_FORMAT(d.aceite_em, '%Y-%m-%d %H:%i') AS aceite_em, d.aceite_responsavel_nome, ch.numero AS conta,
                (SELECT COUNT(*) FROM lancamento_automatico_conta la
                  WHERE la.diferenca_acomodacao_id = d.id AND la.situacao = 'lancado') AS dias,
                (SELECT COALESCE(SUM(ci.valor_total), 0) FROM lancamento_automatico_conta la
                   JOIN conta_hospitalar_item ci ON ci.id = la.conta_hospitalar_item_id
                  WHERE la.diferenca_acomodacao_id = d.id AND la.situacao = 'lancado') AS total
           FROM diferenca_acomodacao d
           JOIN categoria_acomodacao cd ON cd.id = d.direito_categoria_acomodacao_id
           JOIN categoria_acomodacao cu ON cu.id = d.utilizada_categoria_acomodacao_id
           LEFT JOIN item_faturavel it ON it.id = d.item_faturavel_id
           LEFT JOIN conta_hospitalar ch ON ch.id = d.conta_hospitalar_id
          WHERE d.internacao_id = ? AND d.excluido_em IS NULL ORDER BY d.inicio_em, d.id`,
        [num(i['id'])],
        { teto: 200 },
      );
      const contas = await l.consultar(
        `SELECT c.id, c.numero, f.nome FROM conta_hospitalar c JOIN fonte_pagadora f ON f.id = c.fonte_pagadora_id
          WHERE c.atendimento_id = ? AND c.fonte_pagadora_id <> ? AND c.situacao <> 'cancelada' AND c.excluido_em IS NULL
          ORDER BY c.id`,
        [num(i['atendimento_id']), num(i['fonte_pagadora_id'])],
        { teto: 50 },
      );
      const acomodacoes = await l.consultar(
        'SELECT id, descricao FROM categoria_acomodacao WHERE ativo = TRUE ORDER BY descricao',
        [],
        { teto: 500 },
      );
      const itens = await l.consultar(
        `SELECT id, codigo, descricao FROM item_faturavel
          WHERE tipo_item IN ('diaria','taxa') AND situacao = 'ativo' AND excluido_em IS NULL ORDER BY codigo`,
        [],
        { teto: 1000 },
      );
      return {
        atendimento: texto(i['numero']),
        internacao: num(i['id']),
        situacaoInternacao: texto(i['situacao']),
        acomodacaoAtual: atual ? { id: num(atual['id']), rotulo: texto(atual['descricao']) } : null,
        diferencas: linhas.map((x) => ({
          id: num(x['id']),
          versao: num(x['versao']),
          direito: { id: num(x['direito']), rotulo: texto(x['direito_nome']) },
          utilizada: { id: num(x['utilizada']), rotulo: texto(x['utilizada_nome']) },
          item:
            x['item_faturavel_id'] === null
              ? null
              : {
                  id: num(x['item_faturavel_id']),
                  rotulo: `${texto(x['item_codigo'])} ${texto(x['item_nome'])}`,
                },
          valorDiario: num(x['valor_diario']),
          inicio: texto(x['inicio']),
          fim: x['fim'] === null ? null : texto(x['fim']),
          situacao: texto(x['situacao']) as SituacaoDiferenca,
          aceiteEm: x['aceite_em'] === null ? null : texto(x['aceite_em']),
          responsavel: x['aceite_responsavel_nome'] === null ? null : texto(x['aceite_responsavel_nome']),
          conta: x['conta'] === null ? null : texto(x['conta']),
          diasCobrados: num(x['dias']),
          totalCobrado: num(x['total']),
        })),
        contasParticulares: contas.map((x) => ({
          id: num(x['id']),
          rotulo: `${texto(x['numero'])} ${texto(x['nome'])}`,
        })),
        acomodacoes: acomodacoes.map((x) => ({ id: num(x['id']), rotulo: texto(x['descricao']) })),
        itens: itens.map((x) => ({
          id: num(x['id']),
          rotulo: `${texto(x['codigo'])} ${texto(x['descricao'])}`,
        })),
        hoje: hoje(),
      };
    });
  }

  private async executar<E, S extends ResultadoOperacao>(
    op: Operacao<E, S>,
    c: ContextoGravacaoDiferenca,
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

  registrar(c: ContextoGravacaoDiferenca, entrada: unknown) {
    return this.executar(opRegistrarDiferenca, c, entrada, 'Registrar a diferença de acomodação');
  }
  aceitar(c: ContextoGravacaoDiferenca, entrada: unknown) {
    return this.executar(opAceitarDiferenca, c, entrada, 'Registrar o aceite da diferença');
  }
  decidir(c: ContextoGravacaoDiferenca, entrada: unknown) {
    return this.executar(opDecidirDiferenca, c, entrada, 'Recusar, encerrar ou cancelar a diferença');
  }
}
