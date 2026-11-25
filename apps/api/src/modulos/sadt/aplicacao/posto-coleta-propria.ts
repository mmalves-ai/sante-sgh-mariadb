// Posto de coleta como cadastro próprio e a etiqueta da recoleta e da alíquota na fila da estação (F3.5, 05-SADT
// linha 7), no banco do cliente. O posto é incluído, alterado e inativado (nunca apagado) pelo Executor do núcleo, com a
// trilha na mesma transação; a coleta da recoleta confere o posto escolhido pela regra do domínio. A etiqueta de cada
// amostra nova (recoleta, alíquota) vai à fila da impressora da estação e a impressão fica registrada na amostra
// (`etiqueta_impressa_em`) e na passagem dela (evento "etiqueta_impressa" com a via e a estação). A regra mora em
// @sgh/dominio-sadt (amostra/recoleta.ts).
import {
  type ArmazemIdempotencia,
  type DestinoFila,
  enfileirarZpl,
  ErroZpl,
  zplEtiquetaAmostra,
} from '@sgh/dominio-documento';
import {
  type AvisoDoPosto,
  conferirCadastroDoPosto,
  conferirPostoNaColeta,
  linhaDaEtiqueta,
  RecusaAmostra,
  TIPOS_DE_POSTO,
  type TipoDeEtiqueta,
  type TipoDePosto,
  tipoDaEtiqueta,
  viaDaEtiqueta,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FUSO_PADRAO, relogioNoFuso } from '../../exames/relogio.js';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';

export const SERVICO_POSTO_COLETA = Symbol('SERVICO_POSTO_COLETA');

const id = z.number().int().positive();
const horaOpcional = z.string().trim().max(5).nullable().default(null);

export const esquemaPostoColeta = z.object({
  /** Com o id, altera o posto (a versão lida na tela evita gravar por cima de outra alteração). */
  id: id.nullable().default(null),
  versao: id.nullable().default(null),
  codigo: z.string().trim().min(1).max(30),
  descricao: z.string().trim().min(1).max(150),
  tipo: z.enum(TIPOS_DE_POSTO).default('interno'),
  setorLaboratorio: id.nullable().default(null),
  horarioInicio: horaOpcional,
  horarioFim: horaOpcional,
  funcionaFimDeSemana: z.boolean().default(false),
  telefone: z.string().trim().max(20).nullable().default(null),
});

export const esquemaSituacaoPosto = z.object({ ativo: z.boolean() });
export const esquemaImprimirEtiqueta = z.object({
  estacao: z.string().trim().max(64).nullable().default(null),
});

export interface PostoLido {
  readonly id: number;
  readonly versao: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly tipo: TipoDePosto;
  readonly setorLaboratorio: number;
  readonly setorNome: string;
  readonly horarioInicio: string | null;
  readonly horarioFim: string | null;
  readonly funcionaFimDeSemana: boolean;
  readonly telefone: string | null;
  readonly ativo: boolean;
}

/** A fila da impressora da estação (o serviço de documentos da API; nos testes, memória). */
export interface FilaDeEtiquetas {
  readonly armazem: ArmazemIdempotencia;
  readonly destino: DestinoFila;
  readonly novoId: () => string;
}

export interface PedidoDeImpressao {
  readonly rede: string;
  readonly estabelecimento: string;
  readonly estacao: string;
  /** true: via seguinte pedida na tela (a primeira via sai sozinha na coleta e na aliquotagem). */
  readonly reimpressao: boolean;
}

export interface EtiquetasImpressas {
  readonly total: number;
  readonly naFila: number;
  readonly vias: readonly { readonly amostra: number; readonly via: number; readonly tipo: TipoDeEtiqueta }[];
}

export const TABELAS_POSTO = ['ponto_coleta', 'amostra_biologica', 'amostra_biologica_evento'] as const;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const hora = (v: unknown) => (v === null || v === undefined ? null : String(v).slice(0, 5));
const sim = (v: unknown) => v === true || Number(v ?? 0) === 1;
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
/** O número de negócio (texto no banco) como o inteiro positivo que a etiqueta imprime. */
const numeroImpresso = (v: unknown) => Math.max(1, Number(texto(v).replace(/\D/g, '').slice(-9)) || 0);

function daRegra<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RecusaAmostra) throw recusa(e.codigo, e.message);
    throw e;
  }
}

const estacaoLimpa = (e: string) => e.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);

/**
 * Confere, dentro da transação da coleta, o posto escolhido: do estabelecimento, ativo, e devolve os avisos (fora do
 * horário, fim de semana) que a coleta grava na passagem da amostra. Sem posto informado, nada a conferir.
 */
export async function conferirPostoDaColeta(
  l: Leitor,
  est: number,
  posto: number | null,
): Promise<readonly AvisoDoPosto[]> {
  if (posto === null) return [];
  const p = await l.uma(
    `SELECT ativo, horario_inicio, horario_fim, funciona_fim_semana FROM ponto_coleta
      WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
    [posto, est],
  );
  const f = await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  const rel = relogioNoFuso(texto(f?.['fuso_horario']) || FUSO_PADRAO);
  return daRegra(() =>
    conferirPostoNaColeta(
      p
        ? {
            ativo: sim(p['ativo']),
            horarioInicio: hora(p['horario_inicio']),
            horarioFim: hora(p['horario_fim']),
            funcionaFimDeSemana: sim(p['funciona_fim_semana']),
          }
        : null,
      true,
      { diaSemana: new Date(`${rel.hoje}T12:00:00Z`).getUTCDay(), hora: rel.hora },
    ),
  );
}

export class ServicoPostoColeta {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSadt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ctxNucleo(c: ContextoSadt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || 'sadt').slice(0, 64),
    };
  }

  private est(c: ContextoSadt): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  private ler<T>(c: ContextoSadt, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), (l) => fn(l, est));
  }

  private async gravar<T extends { readonly id: number }>(
    c: ContextoSadt,
    nome: string,
    tabela: string,
    chaveDaTela: string | null,
    fn: (tx: TxOperacao, est: number) => Promise<T>,
  ): Promise<T> {
    const est = this.est(c);
    let saida: { valor: T } | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS_POSTO,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(tx, est) };
        return { valor: JSON.stringify(saida.valor) };
      },
      alvo: () => ({ tabela, id: saida ? saida.valor.id : null }),
      trilha: () => ({ dados: { evento: nome }, motivo: null }),
    });
    const chave = `sadt:${chaveDaTela ?? randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    if (saida) return (saida as { valor: T }).valor;
    const v = r.resultado['valor'];
    return (typeof v === 'string' ? JSON.parse(v) : null) as T;
  }

  // ── Posto de coleta ───────────────────────────────────────────────────────────────────────────────────────

  /** Os postos do estabelecimento (por padrão só os ativos, que é o que a coleta oferece). */
  postos(c: ContextoSadt, o: { readonly ativos: boolean } = { ativos: true }): Promise<PostoLido[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT p.id, p.versao, p.codigo, p.descricao, p.tipo, p.setor_diagnostico_id, sd.nome AS setor_nome,
                  p.horario_inicio, p.horario_fim, p.funciona_fim_semana, p.telefone, p.ativo
             FROM ponto_coleta p JOIN setor_diagnostico sd ON sd.id = p.setor_diagnostico_id
            WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL ${o.ativos ? 'AND p.ativo = TRUE' : ''}
            ORDER BY p.ativo DESC, p.descricao LIMIT 500`,
          [est],
        )
      ).map((p): PostoLido => ({
        id: n(p['id']),
        versao: n(p['versao']),
        codigo: texto(p['codigo']),
        descricao: texto(p['descricao']),
        tipo: texto(p['tipo']) as TipoDePosto,
        setorLaboratorio: n(p['setor_diagnostico_id']),
        setorNome: texto(p['setor_nome']),
        horarioInicio: hora(p['horario_inicio']),
        horarioFim: hora(p['horario_fim']),
        funcionaFimDeSemana: sim(p['funciona_fim_semana']),
        telefone: p['telefone'] === null ? null : texto(p['telefone']),
        ativo: sim(p['ativo']),
      })),
    );
  }

  /** Inclui o posto, ou altera o que já existe (com o id); o código não se repete no estabelecimento. */
  salvarPosto(c: ContextoSadt, entrada: unknown): Promise<{ id: number; versao: number }> {
    const p = esquemaPostoColeta.parse(entrada);
    return this.gravar(
      c,
      'sadt.posto-coleta.salvo',
      'ponto_coleta',
      c.chaveIdempotencia ?? null,
      async (tx, est) => {
        const outros = await tx.consultar(
          'SELECT codigo FROM ponto_coleta WHERE estabelecimento_id = ? AND id <> ?',
          [est, p.id ?? 0],
        );
        const d = daRegra(() =>
          conferirCadastroDoPosto(
            p,
            outros.map((o) => texto(o['codigo'])),
          ),
        );
        const setor = await tx.uma(
          'SELECT id FROM setor_diagnostico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [d.setorLaboratorio, est],
        );
        if (!setor)
          throw recusa('setor-inexistente', 'O setor de laboratório não existe neste estabelecimento.');
        const valores = {
          codigo: d.codigo,
          descricao: d.descricao,
          tipo: d.tipo,
          setor_diagnostico_id: d.setorLaboratorio,
          horario_inicio: d.horarioInicio ? `${d.horarioInicio}:00` : null,
          horario_fim: d.horarioFim ? `${d.horarioFim}:00` : null,
          funciona_fim_semana: d.funcionaFimDeSemana,
          telefone: p.telefone || null,
        };
        if (p.id === null) {
          const novo = await tx.incluir('ponto_coleta', {
            estabelecimento_id: est,
            ...valores,
            ativo: true,
            origem: 'sistema',
          });
          return { id: novo, versao: 1 };
        }
        const [atual] = await tx.consultarParaAtualizar(
          'SELECT id, versao FROM ponto_coleta WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [p.id, est],
          { teto: 1 },
        );
        if (!atual) throw recusa('posto-inexistente', 'O posto de coleta não existe neste estabelecimento.');
        const versao = await tx.alterar('ponto_coleta', p.id, p.versao ?? n(atual['versao']), valores);
        return { id: p.id, versao };
      },
    );
  }

  /** Inativa ou reativa o posto: o posto nunca é apagado (as amostras colhidas nele continuam ligadas). */
  situarPosto(c: ContextoSadt, posto: number, entrada: unknown): Promise<{ id: number; ativo: boolean }> {
    const p = esquemaSituacaoPosto.parse(entrada);
    return this.gravar(
      c,
      'sadt.posto-coleta.situacao',
      'ponto_coleta',
      c.chaveIdempotencia ?? null,
      async (tx, est) => {
        const [atual] = await tx.consultarParaAtualizar(
          'SELECT id, versao, ativo FROM ponto_coleta WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [posto, est],
          { teto: 1 },
        );
        if (!atual) throw recusa('posto-inexistente', 'O posto de coleta não existe neste estabelecimento.');
        if (sim(atual['ativo']) !== p.ativo)
          await tx.alterar('ponto_coleta', posto, n(atual['versao']), { ativo: p.ativo });
        return { id: posto, ativo: p.ativo };
      },
    );
  }

  // ── Etiqueta da recoleta e da alíquota ────────────────────────────────────────────────────────────────────

  /**
   * Manda à fila da estação a etiqueta de cada amostra (a da recoleta marcada como recoleta; a da alíquota com "qual de
   * quantas") e registra a impressão na amostra e na passagem dela. A primeira via é idempotente pela chave da amostra;
   * a reimpressão é uma via numerada. Sem a fila (serviço de documentos desligado) nada é registrado como impresso.
   */
  async imprimirEtiquetas(
    c: ContextoSadt,
    amostras: readonly number[],
    fila: FilaDeEtiquetas | null,
    o: PedidoDeImpressao,
  ): Promise<EtiquetasImpressas> {
    const ids = [...new Set(amostras)];
    if (ids.length === 0) return { total: 0, naFila: 0, vias: [] };
    const dados = await this.ler(c, async (l, est) => {
      const linhas = await l.consultar(
        `SELECT am.id, am.codigo_barras, am.situacao, am.amostra_pai_id, am.repeticao,
                pf.nome, pf.nome_social, pf.usa_nome_social, pf.data_nascimento, pa.numero_prontuario, a.numero,
                (SELECT COUNT(*) FROM amostra_biologica_evento ev
                  WHERE ev.amostra_biologica_id = am.id AND ev.evento = 'etiqueta_impressa') AS vias,
                (SELECT COUNT(*) FROM amostra_biologica ir
                  WHERE ir.amostra_pai_id = am.amostra_pai_id AND ir.excluido_em IS NULL) AS total_irmas,
                (SELECT COUNT(*) FROM amostra_biologica ir
                  WHERE ir.amostra_pai_id = am.amostra_pai_id AND ir.excluido_em IS NULL AND ir.id <= am.id) AS indice
           FROM amostra_biologica am JOIN requisicao_exame r ON r.id = am.requisicao_exame_id
           JOIN atendimento a ON a.id = r.atendimento_id JOIN paciente pa ON pa.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
          WHERE am.estabelecimento_id = ? AND am.excluido_em IS NULL AND am.id IN (${lista(ids.length)})`,
        [est, ...ids],
      );
      const exames = await l.consultar(
        `SELECT abe.amostra_biologica_id, e.codigo FROM amostra_biologica_exame abe
           JOIN exame_item ei ON ei.id = abe.exame_item_id JOIN exame e ON e.id = ei.exame_id
          WHERE abe.excluido_em IS NULL AND ei.situacao <> 'cancelado' AND abe.amostra_biologica_id IN (${lista(ids.length)})
          ORDER BY abe.amostra_biologica_id, e.codigo`,
        ids,
      );
      return { linhas, exames };
    });
    if (dados.linhas.length !== ids.length)
      throw recusa('amostra-inexistente', 'A amostra não existe neste estabelecimento.');
    const impressas: { amostra: number; via: number; tipo: TipoDeEtiqueta }[] = [];
    for (const a of dados.linhas as Linha[]) {
      const codigo = texto(a['codigo_barras']);
      const { via, chave } = daRegra(() =>
        viaDaEtiqueta(codigo, texto(a['situacao']), n(a['vias']), o.reimpressao),
      );
      if (!fila) continue;
      const tipo = tipoDaEtiqueta({
        ehAliquota: a['amostra_pai_id'] !== null,
        repeticao: sim(a['repeticao']),
      });
      const nasc = a['data_nascimento'];
      let zpl: string;
      try {
        zpl = zplEtiquetaAmostra({
          nomeCompleto:
            (sim(a['usa_nome_social']) && a['nome_social'] ? texto(a['nome_social']) : texto(a['nome'])) ||
            'PACIENTE',
          nascimento: nasc instanceof Date ? nasc.toISOString().slice(0, 10) : texto(nasc).slice(0, 10),
          prontuario: numeroImpresso(a['numero_prontuario']),
          atendimento: numeroImpresso(a['numero']),
          amostra: codigo,
          exame: linhaDaEtiqueta({
            tipo,
            exames: dados.exames
              .filter((e) => n(e['amostra_biologica_id']) === n(a['id']))
              .map((e) => texto(e['codigo'])),
            indice: n(a['indice']),
            total: n(a['total_irmas']),
          }),
        });
      } catch (x) {
        // Sem o segundo identificador do paciente (nascimento) a etiqueta não sai: a tela avisa e oferece reimprimir.
        if (x instanceof ErroZpl) continue;
        throw x;
      }
      try {
        const r = await enfileirarZpl(
          {
            chaveIdempotencia: chave,
            rede: o.rede || 'rede',
            estabelecimento: o.estabelecimento,
            estacao: estacaoLimpa(o.estacao),
            modelo: 'etiqueta-amostra',
            zpl,
          },
          fila.armazem,
          fila.destino,
          fila.novoId,
        );
        // Chave repetida (clique dobrado, nova tentativa da rede): a etiqueta já estava na fila e já foi registrada.
        if (r.novo) impressas.push({ amostra: n(a['id']), via, tipo });
      } catch {
        // A fila fora do ar não desfaz a coleta: a etiqueta fica por imprimir (reimpressão pela tela).
      }
    }
    if (impressas.length > 0) {
      const estacao = estacaoLimpa(o.estacao);
      await this.gravar(c, 'sadt.amostra.etiqueta', 'amostra_biologica', null, async (tx, est) => {
        const agora = new Date();
        for (const i of impressas) {
          const [am] = await tx.consultarParaAtualizar(
            'SELECT id, versao FROM amostra_biologica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [i.amostra, est],
            { teto: 1 },
          );
          if (!am) continue;
          await tx.alterar('amostra_biologica', i.amostra, n(am['versao']), { etiqueta_impressa_em: agora });
          await tx.incluir('amostra_biologica_evento', {
            amostra_biologica_id: i.amostra,
            operacao: 'alteracao',
            evento: 'etiqueta_impressa',
            ocorrido_em: agora,
            usuario_id: tx.contexto.usuario,
            dados: JSON.stringify({ via: i.via, tipo: i.tipo, estacao, reimpressao: o.reimpressao }),
          });
        }
        return { id: impressas[0]!.amostra };
      });
    }
    return { total: ids.length, naFila: impressas.length, vias: impressas };
  }
}
