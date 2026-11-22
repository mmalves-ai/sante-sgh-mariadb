// Apoio comum às portas PRÓPRIAS da operadora (F2.2, lote 02-09: ANS, atendimento, autorização, cobrança e contas)
// sobre o MariaDB do cliente, pelo @sgh/nucleo:
//   - leitura sempre em transação somente leitura (lerSomente), com o cliente da porta (nunca o da tela);
//   - gravação sempre pelo Executor: a operação declara as tabelas que grava, e a trilha (com o evento e o recurso da
//     tela nos dados), o outbox e a idempotência ficam na mesma transação; o gravador de cada porta recebe a
//     transação da operação (TxOperacao) e só grava nas tabelas declaradas;
//   - operadora: operadora_saude com a pessoa jurídica, só as que atuam no estabelecimento da sessão
//     (operadora_saude_estabelecimento vigente);
//   - o que o modelo ainda não tem responde 501 `modelo-pendente` (falha fechada, com o nome do recurso), nunca um
//     contorno; o pedido de modelo fica na saída do lote.
// Melhoria: a gravação da tela é uma operação do Executor (trava otimista pela coluna `versao`, trilha e outbox na
// mesma transação), não mais uma transação avulsa com a trilha escrita à mão.
// Melhoria: cada gravação publica o evento `<porta>.gravacao` no outbox (entidade, id e evento da tela; nunca dado
// pessoal), na mesma transação.
// Melhoria: a data e a hora são as do banco do cliente (uma fonte só), no formato ISO.
// Melhoria: a gravação é idempotente pela Idempotency-Key do pedido (com a operação): o pedido repetido devolve o
// resultado guardado, sem gravar de novo; sem a chave, a porta recusa (nunca sorteia a chave).
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type Linha,
  type NucleoProprio,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import type { ContextoGravacaoOperadora } from './contexto-gravacao.js';
import type { DadosOperadora } from './dados-portas.js';

/** O mínimo do núcleo que as portas próprias usam (o dublê dos testes implementa o mesmo). */
export type NucleoOperadora = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

// ---- conversões da linha do banco para os tipos de negócio ----

export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
export const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export const txtOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
export const bool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === BigInt(1);

const dois = (n: number) => String(n).padStart(2, '0');

/** DATE do banco → AAAA-MM-DD (o driver devolve Date à meia-noite UTC ou texto). */
export function data(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return `${v.getUTCFullYear()}-${dois(v.getUTCMonth() + 1)}-${dois(v.getUTCDate())}`;
  return String(v).slice(0, 10);
}

/** DATETIME do banco → AAAA-MM-DDTHH:MM:SS. */
export function instante(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return `${data(v)}T${dois(v.getUTCHours())}:${dois(v.getUTCMinutes())}:${dois(v.getUTCSeconds())}`;
  return String(v).replace(' ', 'T').slice(0, 19);
}

/** AAAA-MM (ou AAAA-MM-DD) → o primeiro dia do mês (competência no banco). */
export function primeiroDia(competencia: string): string {
  return `${competencia.slice(0, 7)}-01`;
}

/** AAAA-MM-DD do banco → AAAA-MM (competência na tela). */
export function competenciaDe(v: unknown): string {
  return (data(v) ?? '').slice(0, 7);
}

/** 501 do recurso que o modelo do banco próprio ainda não tem (pedido registrado na saída do lote). */
export function pendente(recurso: string): never {
  throw new ErroOperacao(
    501,
    'modelo-pendente',
    'Recurso ainda não disponível',
    `${recurso}: ainda não disponível no banco próprio.`,
  );
}

/** 404 de negócio dentro da gravação. */
export function inexistente(o: string): ErroOperacao {
  return new ErroOperacao(404, 'registro-inexistente', 'Registro inexistente', `${o} não existe mais.`);
}

/** A versão relida da linha (trava otimista): diferente da vista na tela, 409 conflito-versao pelo alterar do núcleo. */
export async function versaoDe(tx: TxOperacao, tabela: string, id: number, o: string): Promise<Linha> {
  const [l] = await tx.consultarParaAtualizar(
    `SELECT * FROM ${tabela} WHERE id = ? AND excluido_em IS NULL`,
    [id],
  );
  if (!l) throw inexistente(o);
  return l;
}

const MODALIDADE: Readonly<Record<string, string>> = {
  medicina_grupo: 'medicinaGrupo',
  cooperativa_medica: 'cooperativaMedica',
  autogestao: 'autogestao',
  filantropia: 'filantropia',
  seguradora: 'seguradora',
  odontologia_grupo: 'odontologiaGrupo',
  cooperativa_odontologica: 'cooperativaOdontologica',
  administradora_beneficios: 'administradoraBeneficios',
};

/** As operadoras que atuam no estabelecimento da sessão (vínculo vigente), com a pessoa jurídica. */
export async function operadorasDoEstabelecimento(
  l: Leitor,
  estabelecimento: number | null,
): Promise<DadosOperadora[]> {
  const linhas = await l.consultar(
    `SELECT o.id, o.versao, o.registro_ans, o.modalidade, o.ativo, COALESCE(o.alterado_em, o.criado_em) AS alterado_em,
            pj.cnpj, pj.razao_social, pj.nome_fantasia
       FROM operadora_saude o
       JOIN pessoa_juridica pj ON pj.id = o.pessoa_juridica_id
      WHERE o.excluido_em IS NULL
        AND EXISTS (SELECT 1 FROM operadora_saude_estabelecimento oe
                     WHERE oe.operadora_saude_id = o.id AND oe.estabelecimento_id = ? AND oe.excluido_em IS NULL
                       AND oe.vigencia_inicio <= CURRENT_DATE
                       AND (oe.vigencia_fim IS NULL OR oe.vigencia_fim >= CURRENT_DATE))
      ORDER BY o.nome, o.id`,
    [estabelecimento ?? 0],
  );
  return linhas.map((o) => ({
    id: num(o['id']),
    versao: num(o['versao']),
    alteradoEm: instante(o['alterado_em']) ?? '',
    registroAns: txt(o['registro_ans']),
    cnpj: txt(o['cnpj']),
    razaoSocial: txt(o['razao_social']),
    nomeFantasia: txtOuNulo(o['nome_fantasia']),
    modalidade: MODALIDADE[txt(o['modalidade'])] ?? txt(o['modalidade']),
    situacao: bool(o['ativo']) ? 'ativa' : 'inativa',
  }));
}

/** A operadora atua no estabelecimento da sessão? (toda gravação confere antes; recusa 404, sem revelar outra.) */
export async function exigirOperadora(
  l: Leitor,
  estabelecimento: number | null,
  operadora: number,
): Promise<void> {
  const r = await l.uma(
    `SELECT 1 AS ok FROM operadora_saude_estabelecimento
      WHERE operadora_saude_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL
        AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`,
    [operadora, estabelecimento ?? 0],
  );
  if (!r) throw inexistente('A operadora');
}

/** Base das portas próprias: leitura, relógio, operadoras e a gravação pelo Executor com o gravador da porta. */
export abstract class BasePortaOperadoraPropria<G> {
  readonly destino = 'banco' as const;
  protected readonly executor: Executor;

  constructor(
    protected readonly nucleo: NucleoOperadora,
    protected readonly cliente: string,
    /** Nome da porta nas operações do Executor (ex.: `operadora.ans`). */
    private readonly prefixo: string,
    /** As tabelas que o gravador da porta pode gravar (declaradas na operação). */
    private readonly tabelas: readonly string[],
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  /** O gravador da porta sobre a transação da operação. */
  protected abstract gravador(tx: TxOperacao): G;

  protected ler<T>(c: ContextoPorta, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: c.correlacao || this.prefixo }, fn);
  }

  async relogio(c: ContextoPorta): Promise<{ hoje: string; agora: string }> {
    const r = await this.ler(c, (l) =>
      l.uma<{ hoje: unknown; agora: unknown }>('SELECT CURRENT_DATE AS hoje, NOW() AS agora'),
    );
    return { hoje: data(r?.hoje) ?? '', agora: instante(r?.agora) ?? '' };
  }

  async hoje(c: ContextoPorta): Promise<string> {
    return (await this.relogio(c)).hoje;
  }

  operadoras(c: ContextoPorta): Promise<DadosOperadora[]> {
    return this.ler(c, (l) => operadorasDoEstabelecimento(l, c.estabelecimento));
  }

  /**
   * A gravação da tela: uma operação do Executor com as tabelas da porta, o gravador sobre a transação e a linha da
   * trilha da tela nos dados (evento, recurso, estação). A chave de idempotência vem do pedido (Idempotency-Key com a
   * operação, montada pelo controller); sem ela, recusa (400). O resultado fica guardado com a chave: o mesmo pedido
   * repetido (rede, clique duplo) devolve o resultado da primeira gravação sem gravar de novo.
   */
  async gravar<T>(
    c: ContextoGravacaoOperadora,
    trilha: RegistroTrilhaTela | ((r: T) => RegistroTrilhaTela),
    fn: (g: G) => Promise<T>,
  ): Promise<T> {
    if (!c.chaveIdempotencia)
      throw new ErroOperacao(
        400,
        'entrada-invalida',
        'Pedido incompleto',
        'Falta a Idempotency-Key do pedido de gravação.',
      );
    const linha = (r: T) => (typeof trilha === 'function' ? trilha(r) : trilha);
    let resultado: T | undefined;
    const op = definirOperacao({
      nome: `${this.prefixo}.gravacao-tela`,
      tabelas: this.tabelas,
      entrada: z.object({ chave: z.string() }),
      gravar: async (tx) => {
        resultado = await fn(this.gravador(tx));
        return { resultado: JSON.stringify(resultado ?? null) };
      },
      alvo: () => {
        const l = linha(resultado as T);
        return { tabela: l.entidade, id: l.entidadeId };
      },
      eventos: () => {
        const l = linha(resultado as T);
        const d = (l.dadosDepois ?? {}) as Record<string, unknown>;
        return [
          {
            tipo: `${this.prefixo}.gravacao`,
            carga: {
              entidade: l.entidade,
              id: l.entidadeId,
              evento: typeof d['evento'] === 'string' ? d['evento'] : null,
            },
          },
        ];
      },
      trilha: () => {
        const l = linha(resultado as T);
        return { acao: l.acao, dados: l.dadosDepois, ...(l.motivo ? { motivo: l.motivo } : {}) };
      },
    });
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || this.prefixo).slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia,
    };
    const saida = await this.executor.executar(op, this.cliente, { chave: c.chaveIdempotencia }, ctx);
    if (saida.repetida) return JSON.parse(String(saida.resultado['resultado'] ?? 'null')) as T;
    return resultado as T;
  }
}
