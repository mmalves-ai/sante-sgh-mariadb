// Porta PRÓPRIA do comando `liberacao:ligar-tudo` (M61; ADR 0034) sobre o banco do cliente (MariaDB, @sgh/nucleo):
// as chaves de liberação (liberacao_chave), os lotes (liberacao_lote) e os pré-requisitos (recurso_prerequisito) de um
// estabelecimento. Leitura somente leitura; gravação só pelo Executor (trilha, idempotência e sequência do número do
// lote na mesma transação), pelo mesmo caminho da tela de chaves (apps/api config/configuracao-propria.ts): cada lote
// relê com trava as linhas da chave e os pré-requisitos do recurso e decide as mudanças sobre esse estado.
// Ator: o terminal do servidor (ATOR_TERMINAL_LIBERACAO, sem usuário no banco); a trilha leva o ator e o evento.
// Melhoria: a recusa do plano (conferências do domínio) desfaz a transação inteira e volta como foi lançada.
// Melhoria: chave de outro tipo (operação × recurso) com o mesmo nome é recusada, como na tela.
// Pendente (pedido no saida/05-13.json): a leitura da regra 1 da farmácia (unidades atendidas por local e prescrições
//   gravadas por unidade) ainda não existe sobre o modelo próprio; a chave da dispensação fica desligada com o motivo
//   do domínio ("não foi possível conferir"), que o relatório mostra como pendência.
import { randomUUID } from 'node:crypto';
import {
  ATOR_TERMINAL_LIBERACAO,
  CHAVE_PRESCRICAO_ONDA2,
  DIAS_PRESCRICAO_EM_USO,
  EVENTOS_AUDITAVEIS,
  MARCA_LIBERACAO_FULL,
} from '@sgh/contratos';
import {
  type ChavePrescricaoLida,
  chaveExigePrescricao,
  type LeituraRegraFarmacia,
  motivoLigarRegraFarmacia,
} from '@sgh/dominio-config';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  type Linha,
  recusa,
} from '@sgh/nucleo';
import { z } from 'zod';
import type {
  LinhaChaveFull,
  PedidoLoteFull,
  PortaLiberacaoFull,
  PrerequisitoLidoFull,
} from './liberacao-full.ts';

/** O que a porta usa do NucleoProprio (os testes trocam). */
export interface NucleoLiberacao {
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
  criarExecutor(): Executor;
}

const TETO_CHAVES = 5000;

const COLUNAS_CHAVE = `c.id, c.tipo, c.chave, c.escopo, c.valor, c.ligada, c.ligada_antes, c.versao, l.numero AS lote,
  l.justificativa
  FROM liberacao_chave c
  LEFT JOIN liberacao_lote l ON l.id = c.liberacao_lote_id`;

const COLUNAS_PREREQUISITO =
  'p.recurso, p.tipo, p.situacao, p.validade, p.evidencia FROM recurso_prerequisito p';

const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const boolOuNull = (v: unknown): boolean | null =>
  v === null || v === undefined ? null : v === true || Number(v) === 1;
const dia = (v: unknown): string | null =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : (txt(v)?.slice(0, 10) ?? null);

function paraChave(r: Linha): LinhaChaveFull {
  return {
    tipo: r['tipo'] === 'recurso' ? 'recurso' : 'operacao',
    chave: String(r['chave']),
    escopo: String(r['escopo']) as LinhaChaveFull['escopo'],
    valor: String(r['valor']),
    ligada: boolOuNull(r['ligada']),
    ligadaAntes: boolOuNull(r['ligada_antes']),
    lote: txt(r['lote']),
    justificativa: txt(r['justificativa']),
  };
}

function paraPrerequisito(r: Linha): PrerequisitoLidoFull {
  return {
    recurso: String(r['recurso']),
    tipo: String(r['tipo']) as PrerequisitoLidoFull['tipo'],
    situacao: String(r['situacao']) as PrerequisitoLidoFull['situacao'],
    validade: dia(r['validade']),
    evidencia: txt(r['evidencia']),
  };
}

const esquemaLotes = z.object({
  pedidos: z
    .array(
      z.object({
        tipo: z.enum(['operacao', 'recurso']),
        chave: z.string().min(1).max(120),
        justificativa: z.string().trim().min(10).max(500),
        referencia: z.string().max(200).nullable(),
      }),
    )
    .min(1)
    .max(2000),
});

const esquemaPrerequisito = z.object({
  recurso: z.string().min(1).max(120),
  tipo: z.enum(['certificado', 'credenciamento', 'contrato', 'aprovacao']),
  situacao: z.enum(['pendente', 'cumprido', 'dispensado']),
  validade: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  evidencia: z.string().max(200).nullable(),
});

export class PortaLiberacaoPropria implements PortaLiberacaoFull {
  private readonly executor: Executor;
  private readonly ids = new Map<string, number>();
  private readonly nucleo: NucleoLiberacao;
  /** Código do cliente na plataforma (o banco é cliente_<codigo>). */
  readonly cliente: string;
  readonly correlacao: string;

  constructor(nucleo: NucleoLiberacao, cliente: string, correlacao: string, executor?: Executor) {
    this.nucleo = nucleo;
    this.cliente = cliente;
    this.correlacao = correlacao;
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: this.correlacao.slice(0, 64) }, fn);
  }

  /** Os estabelecimentos ativos do cliente (códigos). */
  estabelecimentos(): Promise<string[]> {
    return this.ler(async (l) =>
      (
        await l.consultar(
          'SELECT codigo FROM estabelecimento WHERE excluido_em IS NULL ORDER BY codigo',
          [],
          { teto: 500 },
        )
      ).map((r) => String(r['codigo'])),
    );
  }

  private async estabelecimento(hospital: string): Promise<number> {
    const ja = this.ids.get(hospital);
    if (ja !== undefined) return ja;
    const r = await this.ler((l) =>
      l.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        hospital,
      ]),
    );
    if (!r) throw recusa('estabelecimento-desconhecido', 'Estabelecimento não cadastrado neste cliente.');
    const id = Number(r.id);
    this.ids.set(hospital, id);
    return id;
  }

  private async contexto(hospital: string): Promise<ContextoOperacao> {
    return {
      cliente: this.cliente,
      estabelecimento: await this.estabelecimento(hospital),
      usuario: null,
      correlacao: this.correlacao.slice(0, 64),
      chaveIdempotencia: randomUUID(),
    };
  }

  async contarLinhas(hospital: string): Promise<{ readonly decidem: number; readonly todas: number }> {
    const est = await this.estabelecimento(hospital);
    const r = await this.ler((l) =>
      l.uma<{ todas: unknown; decidem: unknown }>(
        'SELECT COUNT(*) AS todas, COALESCE(SUM(ligada IS NOT NULL), 0) AS decidem FROM liberacao_chave WHERE estabelecimento_id = ?',
        [est],
      ),
    );
    return { decidem: Number(r?.decidem ?? 0), todas: Number(r?.todas ?? 0) };
  }

  async chaves(hospital: string): Promise<readonly LinhaChaveFull[]> {
    const est = await this.estabelecimento(hospital);
    return this.ler(async (l) =>
      (
        await l.consultar(
          `SELECT ${COLUNAS_CHAVE} WHERE c.estabelecimento_id = ? AND c.ligada IS NOT NULL
            ORDER BY c.chave, c.escopo, c.valor LIMIT ${TETO_CHAVES}`,
          [est],
          { teto: TETO_CHAVES },
        )
      ).map(paraChave),
    );
  }

  async prerequisitos(hospital: string): Promise<readonly PrerequisitoLidoFull[]> {
    const est = await this.estabelecimento(hospital);
    return this.ler(async (l) =>
      (
        await l.consultar(
          `SELECT ${COLUNAS_PREREQUISITO} WHERE p.estabelecimento_id = ? ORDER BY p.recurso, p.tipo LIMIT 2000`,
          [est],
          {
            teto: 2000,
          },
        )
      ).map(paraPrerequisito),
    );
  }

  async lotesMarcados(hospital: string): Promise<readonly LinhaChaveFull[]> {
    const est = await this.estabelecimento(hospital);
    return this.ler(async (l) =>
      (
        await l.consultar(
          `SELECT ${COLUNAS_CHAVE} WHERE c.estabelecimento_id = ? AND l.estabelecimento_id = ? AND l.justificativa LIKE ?
            ORDER BY l.numero, c.chave, c.escopo, c.valor LIMIT ${TETO_CHAVES}`,
          [est, est, `%${MARCA_LIBERACAO_FULL}%`],
          { teto: TETO_CHAVES },
        )
      ).map(paraChave),
    );
  }

  async aplicarLotes(
    hospital: string,
    pedidos: readonly PedidoLoteFull[],
    evento: 'alterada' | 'revertida',
  ): Promise<readonly { readonly lote: string; readonly alteradas: number }[]> {
    if (pedidos.length === 0) return [];
    const ctx = await this.contexto(hospital);
    let recusaDoPlano: unknown = null;
    const codigoEvento =
      evento === 'alterada'
        ? EVENTOS_AUDITAVEIS.liberacaoAlterada.codigo
        : EVENTOS_AUDITAVEIS.liberacaoRevertida.codigo;
    const op = definirOperacao({
      nome: evento === 'alterada' ? 'config.liberacao.ligar-tudo' : 'config.liberacao.reverter-ligar-tudo',
      tabelas: ['liberacao_chave', 'liberacao_lote', 'sequencia_negocio'],
      entrada: esquemaLotes,
      async gravar(tx, e, c) {
        const est = Number(c.estabelecimento);
        const r: string[] = [];
        for (const [i, pe] of e.pedidos.entries()) {
          const pedido = pedidos[i]!;
          const todas = (
            await tx.consultarParaAtualizar(
              `SELECT ${COLUNAS_CHAVE} WHERE c.estabelecimento_id = ? AND c.chave = ?`,
              [est, pe.chave],
              {
                teto: 1000,
              },
            )
          ).map((x) => ({ linha: paraChave(x), id: Number(x['id']), versao: Number(x['versao']) }));
          if (todas.some((x) => x.linha.tipo !== pe.tipo))
            throw recusa(
              'chave-de-outro-tipo',
              'Já existe uma chave com este nome de outro tipo (operação × recurso).',
            );
          const prerequisitos =
            pe.tipo === 'recurso'
              ? (
                  await tx.consultarParaAtualizar(
                    `SELECT ${COLUNAS_PREREQUISITO} WHERE p.estabelecimento_id = ? AND p.recurso = ?`,
                    [est, pe.chave],
                    {
                      teto: 100,
                    },
                  )
                ).map(paraPrerequisito)
              : [];
          let mudancas;
          try {
            mudancas = pedido.planejar({ chaves: todas.map((x) => x.linha), prerequisitos });
          } catch (erro) {
            recusaDoPlano = erro;
            throw recusa('lote-recusado', 'O lote foi recusado pelas conferências da liberação.');
          }
          if (mudancas.length === 0) {
            r.push(':0');
            continue;
          }
          await garantirSequencia(
            tx,
            { tipo: 'liberacao_lote', estabelecimento: est },
            { usuario: null, agora: new Date() },
          );
          const numero = await tx.proximoNumero('liberacao_lote');
          const loteId = await tx.incluir('liberacao_lote', {
            estabelecimento_id: est,
            numero: numero.valor,
            tipo: pe.tipo,
            chave: pe.chave,
            justificativa: pe.justificativa,
            referencia_autorizacao: pe.referencia,
            alteradas: mudancas.length,
          });
          for (const m of mudancas) {
            const atual = todas.find((x) => x.linha.escopo === m.escopo && x.linha.valor === m.valor);
            const valores = { ligada: m.ligada, ligada_antes: m.antes, liberacao_lote_id: loteId };
            if (atual) await tx.alterar('liberacao_chave', atual.id, atual.versao, valores);
            else
              await tx.incluir('liberacao_chave', {
                estabelecimento_id: est,
                tipo: pe.tipo,
                chave: pe.chave,
                escopo: m.escopo,
                valor: m.valor,
                ...valores,
              });
          }
          r.push(`${numero.valor}:${mudancas.length}`);
        }
        return { lotes: r.join(',') };
      },
      alvo: () => ({ tabela: 'liberacao_lote', id: null }),
      trilha: (e, res) => ({
        motivo: e.pedidos[0]?.justificativa ?? null,
        dados: {
          evento: codigoEvento,
          ator: ATOR_TERMINAL_LIBERACAO,
          chaves: e.pedidos.map((p) => `${p.tipo}:${p.chave}`),
          lotes: res.lotes,
        },
      }),
    });
    try {
      const s = await this.executor.executar(
        op,
        this.cliente,
        {
          pedidos: pedidos.map((p) => ({
            tipo: p.tipo,
            chave: p.chave,
            justificativa: p.justificativa,
            referencia: p.referencia,
          })),
        },
        ctx,
      );
      return String(s.resultado.lotes)
        .split(',')
        .map((x) => {
          const [lote = '', alteradas = '0'] = x.split(':');
          return { lote, alteradas: Number(alteradas) };
        });
    } catch (erro) {
      if (recusaDoPlano && erro instanceof ErroOperacao) throw recusaDoPlano;
      throw erro;
    }
  }

  async gravarPrerequisito(
    hospital: string,
    p: Parameters<PortaLiberacaoFull['gravarPrerequisito']>[1],
  ): Promise<void> {
    const ctx = await this.contexto(hospital);
    const op = definirOperacao({
      nome: 'config.liberacao.prerequisito',
      tabelas: ['recurso_prerequisito'],
      entrada: esquemaPrerequisito,
      async gravar(tx, e, c) {
        const atual = (
          await tx.consultarParaAtualizar(
            'SELECT id, versao FROM recurso_prerequisito WHERE estabelecimento_id = ? AND recurso = ? AND tipo = ?',
            [c.estabelecimento, e.recurso, e.tipo],
            { teto: 1 },
          )
        )[0];
        const valores = { situacao: e.situacao, validade: e.validade, evidencia: e.evidencia };
        const id = atual
          ? (await tx.alterar('recurso_prerequisito', Number(atual['id']), Number(atual['versao']), valores),
            Number(atual['id']))
          : await tx.incluir('recurso_prerequisito', {
              estabelecimento_id: c.estabelecimento,
              recurso: e.recurso,
              tipo: e.tipo,
              ...valores,
            });
        return { id };
      },
      alvo: (_e, r) => ({ tabela: 'recurso_prerequisito', id: Number(r.id) }),
      trilha: (e) => ({
        dados: {
          evento: EVENTOS_AUDITAVEIS.prerequisitoRegistrado.codigo,
          ator: ATOR_TERMINAL_LIBERACAO,
          recurso: e.recurso,
          tipo: e.tipo,
          situacao: e.situacao,
        },
      }),
    });
    await this.executor.executar(
      op,
      this.cliente,
      {
        recurso: p.recurso,
        tipo: p.tipo,
        situacao: p.situacao,
        validade: p.validade,
        evidencia: p.evidencia,
      },
      ctx,
    );
  }

  /**
   * M41, regra 1: a leitura do banco próprio (lerRegraFarmacia) e a decisão do domínio (motivoLigarRegraFarmacia), a mesma
   * regra da tela de chaves. A chave que não é da regra 1 não lê nada.
   */
  async regraFarmacia(
    hospital: string,
    _tipo: 'recurso' | 'operacao',
    chave: string,
  ): Promise<string | null> {
    if (!chaveExigePrescricao(chave)) return null;
    const est = await this.estabelecimento(hospital);
    const { leitura, chaves } = await this.ler((l) => lerRegraFarmacia(l, est, new Date()));
    return motivoLigarRegraFarmacia(chave, leitura, chaves);
  }
}

/** Primeiro dia do mês anterior ao de `agora` (a janela das unidades atendidas: o mês e o anterior). */
export function inicioMesAnterior(agora: Date): Date {
  return new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
}

/**
 * Leitura da regra 1 da farmácia sobre o modelo próprio, no estabelecimento dado (a unidade é o código do setor
 * funcional, o mesmo valor da chave de liberação por setor):
 *   - unidades atendidas por local: as dispensações não canceladas do mês e do anterior (local_estoque_id ×
 *     setor_funcional_id), mais os setores roteados ao mesmo local por local_estoque_setor (vigente), contados com ao
 *     menos uma dispensação: setor ligado a um local que dispensa também precisa da prescrição em uso (falha fechada);
 *   - prescrições gravadas aqui (origem "sistema", não a migrada) e liberadas nos últimos DIAS_PRESCRICAO_EM_USO dias,
 *     por setor;
 *   - as chaves da prescrição eletrônica (CHAVE_PRESCRICAO_ONDA2) do estabelecimento.
 * Melhoria: o setor roteado ao local entra mesmo sem dispensação na janela (antes só a dispensação contava).
 */
export async function lerRegraFarmacia(
  l: Leitor,
  estabelecimento: number,
  agora: Date,
): Promise<{ leitura: LeituraRegraFarmacia; chaves: ChavePrescricaoLida[] }> {
  const desde = inicioMesAnterior(agora);
  const dispensadas = await l.consultar(
    `SELECT d.local_estoque_id AS local, s.codigo AS unidade, COUNT(*) AS n
       FROM dispensacao d JOIN setor_funcional s ON s.id = d.setor_funcional_id
      WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao <> 'cancelada' AND d.dispensado_em >= ?
      GROUP BY d.local_estoque_id, s.codigo`,
    [estabelecimento, desde],
    { teto: 20_000 },
  );
  const roteadas = await l.consultar(
    `SELECT ls.local_estoque_id AS local, s.codigo AS unidade
       FROM local_estoque_setor ls
       JOIN local_estoque le ON le.id = ls.local_estoque_id
       JOIN setor_funcional s ON s.id = ls.setor_funcional_id
      WHERE le.estabelecimento_id = ? AND le.excluido_em IS NULL AND ls.excluido_em IS NULL AND s.excluido_em IS NULL
        AND (ls.vigencia_inicio IS NULL OR ls.vigencia_inicio <= ?) AND (ls.vigencia_fim IS NULL OR ls.vigencia_fim >= ?)
        AND ls.local_estoque_id IN (
          SELECT d.local_estoque_id FROM dispensacao d
           WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao <> 'cancelada' AND d.dispensado_em >= ?)`,
    [estabelecimento, agora, agora, estabelecimento, desde],
    { teto: 20_000 },
  );
  const porPar = new Map<string, { local: number; unidade: string; dispensacoes: number }>();
  for (const r of dispensadas) {
    const a = {
      local: Number(r['local']),
      unidade: String(r['unidade']).trim(),
      dispensacoes: Number(r['n']),
    };
    porPar.set(`${a.local}|${a.unidade}`, a);
  }
  for (const r of roteadas) {
    const k = `${Number(r['local'])}|${String(r['unidade']).trim()}`;
    if (!porPar.has(k))
      porPar.set(k, { local: Number(r['local']), unidade: String(r['unidade']).trim(), dispensacoes: 1 });
  }
  const limite = new Date(agora.getTime() - DIAS_PRESCRICAO_EM_USO * 86_400_000);
  const prescricoes = await l.consultar(
    `SELECT s.codigo AS unidade, COUNT(*) AS n
       FROM prescricao p JOIN setor_funcional s ON s.id = p.setor_funcional_id
      WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL AND p.origem = 'sistema'
        AND p.situacao NOT IN ('rascunho', 'cancelada') AND p.liberada_em IS NOT NULL AND p.liberada_em >= ?
      GROUP BY s.codigo`,
    [estabelecimento, limite],
    { teto: 20_000 },
  );
  const chaves = await l.consultar(
    'SELECT escopo, valor, ligada FROM liberacao_chave WHERE estabelecimento_id = ? AND chave = ?',
    [estabelecimento, CHAVE_PRESCRICAO_ONDA2],
    { teto: TETO_CHAVES },
  );
  return {
    leitura: {
      atendidas: [...porPar.values()],
      prescricoes: prescricoes.map((r) => ({ unidade: String(r['unidade']).trim(), n: Number(r['n']) })),
    },
    chaves: chaves.map((r) => ({
      escopo: String(r['escopo']),
      valor: String(r['valor']),
      ligada: boolOuNull(r['ligada']),
    })),
  };
}
