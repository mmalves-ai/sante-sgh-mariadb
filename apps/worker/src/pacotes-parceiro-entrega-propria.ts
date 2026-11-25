// Porta própria do agendador das entregas aos parceiros (F3.9, linha 08-INTG L134) sobre o banco do cliente, pelo
// @sgh/nucleo. O pacote é do cliente inteiro (não de um estabelecimento); o fuso da agenda é o do primeiro
// estabelecimento ativo, o mesmo da referência do executor.
// Leitura (somente leitura): os pacotes agendados, ativos, de parceiro ativo e com a minimização revisada e em dia
// (pacote_parceiro, parceiro_dados), os campos vigentes (pacote_parceiro_campo), o fim da última entrega válida e o
// endereço do ponto de integração; as linhas da visão do pacote no período, SÓ com as colunas que o pacote leva (a
// leitura de cada campo do catálogo está aqui, conferida em teste contra o catálogo do domínio).
// Gravação (Executor, trilha e idempotência): a entrega gerada com o arquivo, o período, o volume e o hash, sob a trava
// do pacote e com a regra relida (revisão em dia, período ainda devido); depois a situação pelo transporte.
import { randomUUID } from 'node:crypto';
import {
  entregaDevida,
  fusoEmMinutos,
  type PeriodicidadePacote,
  podeMudarEntrega,
  revisaoEmDia,
  type SituacaoEntrega,
} from '@sgh/dominio-integracao';
import { type ArmazemArquivos, definirOperacao, type Executor, type Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import { type AlvoEstabelecimento, estabelecimentosAtivos, type NucleoWorker } from './servico-worker.js';

/** A leitura de cada campo do catálogo, por visão (expressão SQL sobre os apelidos da consulta da visão). */
export const LEITURA_DOS_CAMPOS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  atendimento: {
    numero: 'a.numero',
    estabelecimento: 'e.codigo',
    prontuario: 'p.numero_prontuario',
    nascimento: 'pf.data_nascimento',
    entrada: 'a.entrada_em',
    saida: 'a.saida_em',
    situacao: 'a.situacao',
    desfecho: 'a.desfecho',
    cid_principal: 't.codigo_termo',
  },
  internacao: {
    numero: 'i.numero',
    estabelecimento: 'e.codigo',
    prontuario: 'p.numero_prontuario',
    nome: 'pf.nome',
    nascimento: 'pf.data_nascimento',
    entrada: 'i.data_hora_entrada',
    saida: 'i.data_hora_alta',
    leito: 'l.codigo',
    situacao: 'i.situacao',
    diarias_previstas: 'i.diarias_previstas',
    cid_principal: 't.codigo_termo',
  },
};

/** Teto de linhas de uma entrega (acima, a entrega é recusada e o log conta: o pacote precisa de janela menor). */
export const TETO_LINHAS_ENTREGA = 100_000;

export interface CampoAgendado {
  readonly sequencia: number;
  readonly entidade: string;
  readonly campo: string;
  readonly rotuloSaida: string;
  readonly tratamento: 'original' | 'pseudonimizado' | 'mascarado' | 'generalizado' | 'agregado';
  readonly dadoSensivel: boolean;
}

export interface PacoteAgendado {
  readonly id: number;
  readonly codigo: string;
  readonly parceiro: string;
  readonly formato: 'csv' | 'json' | 'xml' | 'fhir' | 'parquet' | 'pdf';
  readonly periodicidade: PeriodicidadePacote;
  readonly meioEntrega: 'api' | 'webhook' | 'sftp' | 'arquivo_seguro' | 'email_seguro';
  readonly anonimizacao: 'nenhuma' | 'pseudonimizada' | 'anonimizada' | 'agregada';
  readonly endereco: string | null;
  readonly campos: readonly CampoAgendado[];
  /** O período devido agora (regra do domínio, no fuso da referência). */
  readonly devida: { readonly inicio: Date; readonly fim: Date };
}

export interface ArquivoDaEntrega {
  readonly conteudo: string;
  readonly tipoMime: string;
  readonly extensao: string;
  readonly quantidadeRegistros: number;
  readonly tamanhoBytes: number;
  readonly hashSha256: string;
}

export interface PortaEntregasAgendadas {
  /** O estabelecimento de referência (fuso da agenda e contexto do executor); null sem estabelecimento ativo. */
  referencia(agora: Date): Promise<AlvoEstabelecimento | null>;
  devidos(ref: AlvoEstabelecimento, agora: Date): Promise<PacoteAgendado[]>;
  linhas(
    ref: AlvoEstabelecimento,
    p: PacoteAgendado,
  ): Promise<{ linhas: Record<string, unknown>[]; acimaDoTeto: boolean }>;
  /** Guarda o arquivo e registra a entrega gerada; null quando o período já foi entregue (outra volta chegou antes). */
  registrar(
    ref: AlvoEstabelecimento,
    p: PacoteAgendado,
    a: ArquivoDaEntrega,
    agora: Date,
  ): Promise<{ entrega: number; arquivo: number } | null>;
  /** Muda a situação da entrega pela regra do domínio (só para a frente); as situações passadas em ordem. */
  situacao(
    ref: AlvoEstabelecimento,
    entrega: number,
    passos: readonly SituacaoEntrega[],
    x: { protocolo?: string | null; mensagem?: string | null },
    agora: Date,
  ): Promise<SituacaoEntrega>;
}

const n = (v: unknown) => Number(v ?? 0);
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
const dia = (d: Date) => d.toISOString().slice(0, 10);

const ENTRADA_REGISTRO = z.object({
  pacote: z.number().int().positive(),
  arquivo: z.number().int().positive(),
  inicio: z.string(),
  fim: z.string(),
  quantidade: z.number().int().min(0),
  tamanho: z.number().int().min(0),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  formato: z.string(),
  campos: z.number().int().min(1),
  retencao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const SQL_REGRA_PACOTE = `SELECT p.id, p.ativo, p.proxima_revisao_em, d.ativo AS parceiro_ativo
     FROM pacote_parceiro p JOIN parceiro_dados d ON d.id = p.parceiro_dados_id
    WHERE p.id = ? AND d.excluido_em IS NULL`;
const SQL_FIM_ENTREGUE = `SELECT MAX(periodo_fim) AS fim FROM entrega_pacote_parceiro
    WHERE pacote_parceiro_id = ? AND situacao NOT IN ('rejeitada','falhou')`;

const diaDoBanco = (v: unknown) => (v instanceof Date ? dia(v) : String(v).slice(0, 10));

/** A regra da entrega relida: pacote e parceiro ativos, revisão em dia e o período ainda não entregue. */
function regraDaEntregaVale(
  pacote: readonly Record<string, unknown>[],
  ultimo: readonly Record<string, unknown>[],
  fim: string,
  agora: Date,
): boolean {
  const x = pacote[0];
  if (!x || !Number(x['ativo']) || !Number(x['parceiro_ativo'])) return false;
  const prox = x['proxima_revisao_em'];
  if (!revisaoEmDia(prox ? diaDoBanco(prox) : null, dia(agora))) return false;
  const u = ultimo[0]?.['fim'];
  return !(u && new Date(u as string).getTime() >= new Date(fim).getTime());
}

const ENTRADA_SITUACAO = z.object({
  entrega: z.number().int().positive(),
  passos: z.array(z.enum(['gerada', 'enviada', 'confirmada', 'rejeitada', 'falhou'])).min(1),
  protocolo: z.string().max(100).nullable(),
  mensagem: z.string().max(1000).nullable(),
});

export class PortaEntregasAgendadasPropria implements PortaEntregasAgendadas {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoWorker,
    private readonly cliente: string,
    private readonly armazem: ArmazemArquivos,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(est: number | null, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, estabelecimento: est, correlacao: 'pacotes-entrega' },
      fn,
    );
  }

  async referencia(agora: Date): Promise<AlvoEstabelecimento | null> {
    return (await this.ler(null, (l) => estabelecimentosAtivos(l, this.cliente, agora)))[0] ?? null;
  }

  devidos(ref: AlvoEstabelecimento, agora: Date): Promise<PacoteAgendado[]> {
    const fuso = fusoEmMinutos(ref.fuso, agora);
    return this.ler(ref.id, async (l) => {
      const ps = await l.consultar(
        `SELECT p.id, p.codigo, p.formato, p.meio_entrega, p.periodicidade, p.agenda, p.janela_dias, p.anonimizacao,
                p.proxima_revisao_em, d.codigo AS parceiro, pi.endereco
           FROM pacote_parceiro p JOIN parceiro_dados d ON d.id = p.parceiro_dados_id
           LEFT JOIN ponto_integracao pi ON pi.id = p.ponto_integracao_id AND pi.excluido_em IS NULL AND pi.ativo = TRUE
          WHERE p.ativo = TRUE AND d.ativo = TRUE AND d.excluido_em IS NULL AND p.periodicidade <> 'sob_demanda'
            AND p.proxima_revisao_em IS NOT NULL AND p.proxima_revisao_em >= ?
          ORDER BY p.id`,
        [dia(agora)],
        { teto: 1000 },
      );
      const out: PacoteAgendado[] = [];
      for (const x of ps) {
        const id = n(x['id']);
        const u = await l.uma(
          `SELECT MAX(periodo_fim) AS fim FROM entrega_pacote_parceiro
            WHERE pacote_parceiro_id = ? AND situacao NOT IN ('rejeitada','falhou')`,
          [id],
        );
        const devida = entregaDevida({
          periodicidade: String(x['periodicidade']) as never,
          agenda: txt(x['agenda']),
          janelaDias: x['janela_dias'] === null ? null : n(x['janela_dias']),
          ultimoFim: u?.['fim'] ? new Date(u['fim'] as string) : null,
          agora,
          fusoMinutos: fuso,
        });
        if (!devida) continue;
        const campos = await l.consultar(
          `SELECT sequencia, entidade, campo, rotulo_saida, tratamento, dado_sensivel FROM pacote_parceiro_campo
            WHERE pacote_parceiro_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
          [id],
          { teto: 200 },
        );
        out.push({
          id,
          codigo: String(x['codigo']),
          parceiro: String(x['parceiro']),
          formato: String(x['formato']) as PacoteAgendado['formato'],
          periodicidade: String(x['periodicidade']) as PeriodicidadePacote,
          meioEntrega: String(x['meio_entrega']) as PacoteAgendado['meioEntrega'],
          anonimizacao: String(x['anonimizacao']) as PacoteAgendado['anonimizacao'],
          endereco: txt(x['endereco']),
          campos: campos.map((k) => ({
            sequencia: n(k['sequencia']),
            entidade: String(k['entidade']),
            campo: String(k['campo']),
            rotuloSaida: String(k['rotulo_saida']),
            tratamento: String(k['tratamento']) as CampoAgendado['tratamento'],
            dadoSensivel: Boolean(Number(k['dado_sensivel'])),
          })),
          devida,
        });
      }
      return out;
    });
  }

  linhas(
    ref: AlvoEstabelecimento,
    p: PacoteAgendado,
  ): Promise<{ linhas: Record<string, unknown>[]; acimaDoTeto: boolean }> {
    const entidade = p.campos[0]?.entidade ?? '';
    const leitura = LEITURA_DOS_CAMPOS[entidade];
    if (!leitura) return Promise.resolve({ linhas: [], acimaDoTeto: false });
    // Só as colunas que o pacote leva (minimização também na leitura); o campo fora do catálogo não é lido.
    const colunas = p.campos
      .filter((k) => k.entidade === entidade && leitura[k.campo])
      .map((k) => `${leitura[k.campo]} AS ${k.campo}`)
      .join(', ');
    if (!colunas) return Promise.resolve({ linhas: [], acimaDoTeto: false });
    const periodo = [p.devida.inicio, p.devida.fim];
    const teto = { teto: TETO_LINHAS_ENTREGA + 1 };
    return this.ler(ref.id, async (l) => {
      const linhas =
        entidade === 'atendimento'
          ? await l.consultar(
              `SELECT ${colunas}
                 FROM atendimento a JOIN estabelecimento e ON e.id = a.estabelecimento_id
                 JOIN paciente p ON p.id = a.paciente_id
                 LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
                 LEFT JOIN termo_terminologia t ON t.id = a.cid_principal_termo_terminologia_id
                WHERE a.excluido_em IS NULL AND a.entrada_em >= ? AND a.entrada_em < ? ORDER BY a.id`,
              periodo,
              teto,
            )
          : await l.consultar(
              `SELECT ${colunas}
                 FROM internacao i JOIN estabelecimento e ON e.id = i.estabelecimento_id
                 JOIN paciente p ON p.id = i.paciente_id
                 LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
                 LEFT JOIN leito_hospitalar l ON l.id = i.leito_hospitalar_id
                 LEFT JOIN termo_terminologia t ON t.id = i.cid_principal_termo_terminologia_id
                WHERE i.excluido_em IS NULL AND i.data_hora_entrada >= ? AND i.data_hora_entrada < ? ORDER BY i.id`,
              periodo,
              teto,
            );
      return {
        linhas: linhas.slice(0, TETO_LINHAS_ENTREGA) as Record<string, unknown>[],
        acimaDoTeto: linhas.length > TETO_LINHAS_ENTREGA,
      };
    });
  }

  async registrar(
    ref: AlvoEstabelecimento,
    p: PacoteAgendado,
    a: ArquivoDaEntrega,
    agora: Date,
  ): Promise<{ entrega: number; arquivo: number } | null> {
    const ctx = (chave: string) => ({
      cliente: this.cliente,
      estabelecimento: ref.id,
      usuario: null,
      correlacao: `pacote-${p.id}`,
      chaveIdempotencia: `worker.pacote.${p.id}.${chave}.${randomUUID()}`.slice(0, 80),
    });
    const fim = p.devida.fim.toISOString();
    // Minimização (LGPD art. 6 III): a regra é relida ANTES de guardar o arquivo; sem entrega devida, nada é guardado.
    const vale = await this.ler(ref.id, async (l) =>
      regraDaEntregaVale(
        await l.consultar(SQL_REGRA_PACOTE, [p.id], { teto: 1 }),
        await l.consultar(SQL_FIM_ENTREGUE, [p.id], { teto: 1 }),
        fim,
        agora,
      ),
    );
    if (!vale) return null;
    // O arquivo vai à porta de arquivos SEM guarda legal; a guarda de 5 anos só entra na mesma transação que registra
    // a entrega. Se a entrega não vier (outra volta, pacote inativado no meio) ou der erro, o arquivo é descartado:
    // nenhuma exportação de dado pessoal fica guardada sem entrega que aponte para ela.
    const retencao = new Date(agora);
    retencao.setUTCFullYear(retencao.getUTCFullYear() + 5);
    const arq = await this.armazem.guardar(
      {
        conteudo: new TextEncoder().encode(a.conteudo),
        nomeOriginal: `${p.codigo}-${dia(p.devida.fim)}.${a.extensao}`.replace(/[^A-Za-z0-9_.-]/g, '-'),
        tipoMime: a.tipoMime,
        finalidade: 'pacote_parceiro',
        entidade: 'pacote_parceiro',
        entidadeId: p.id,
        retencaoAte: null,
        origem: 'integracao',
      },
      ctx('arquivo'),
    );
    const op = definirOperacao<z.infer<typeof ENTRADA_REGISTRO>, { entrega: number | null }>({
      nome: 'integracao.parceiro.entrega_agendada',
      tabelas: ['entrega_pacote_parceiro', 'arquivo'],
      entrada: ENTRADA_REGISTRO,
      gravar: async (tx, e) => {
        // A trava do pacote serializa duas voltas; a regra é relida dentro dela.
        const x = await tx.consultarParaAtualizar(SQL_REGRA_PACOTE, [e.pacote], { teto: 1 });
        const u = await tx.consultar(SQL_FIM_ENTREGUE, [e.pacote], { teto: 1 });
        if (!regraDaEntregaVale(x, u, e.fim, agora)) return { entrega: null };
        const entrega = await tx.incluir('entrega_pacote_parceiro', {
          pacote_parceiro_id: e.pacote,
          operacao: 'inclusao',
          dados: JSON.stringify({ origem: 'agendador', formato: e.formato, campos: e.campos }),
          ocorrido_em: agora,
          usuario_id: null,
          arquivo_id: e.arquivo,
          periodo_inicio: new Date(e.inicio),
          periodo_fim: new Date(e.fim),
          quantidade_registros: e.quantidade,
          tamanho_bytes: e.tamanho,
          hash_sha256: e.hash,
          situacao: 'gerada',
        });
        // A guarda legal do arquivo, agora que uma entrega aponta para ele (só aumenta).
        const [f] = await tx.consultarParaAtualizar(
          'SELECT id, retencao_ate, versao FROM arquivo WHERE id = ?',
          [e.arquivo],
          { teto: 1 },
        );
        const atual = f?.['retencao_ate'] ? diaDoBanco(f['retencao_ate']) : null;
        if (f && (atual === null || atual < e.retencao))
          await tx.alterar('arquivo', e.arquivo, n(f['versao']), { retencao_ate: e.retencao });
        return { entrega };
      },
      alvo: (e) => ({ tabela: 'pacote_parceiro', id: e.pacote }),
    });
    let entrega: number | null;
    try {
      const r = await this.executor.executar(
        op,
        this.cliente,
        {
          pacote: p.id,
          arquivo: arq.id,
          inicio: p.devida.inicio.toISOString(),
          fim,
          quantidade: a.quantidadeRegistros,
          tamanho: a.tamanhoBytes,
          hash: a.hashSha256,
          formato: p.formato,
          campos: p.campos.length,
          retencao: dia(retencao),
        },
        ctx('entrega'),
      );
      entrega = r.resultado?.entrega ?? null;
    } catch (e) {
      await this.descartar(arq, ctx('descarte'));
      throw e;
    }
    if (entrega === null) {
      await this.descartar(arq, ctx('descarte'));
      return null;
    }
    return { entrega, arquivo: arq.id };
  }

  /** Descarta o arquivo guardado sem entrega (o reaproveitado é de outra entrega e fica). */
  private async descartar(
    arq: { readonly id: number; readonly reaproveitado: boolean },
    ctx: {
      cliente: string;
      estabelecimento: number;
      usuario: null;
      correlacao: string;
      chaveIdempotencia: string;
    },
  ): Promise<void> {
    if (arq.reaproveitado) return;
    const m = await this.armazem.metadado(ctx, arq.id);
    if (!m || m.retencaoAte !== null) return;
    await this.armazem.excluir(arq.id, m.versao, ctx);
  }

  async situacao(
    ref: AlvoEstabelecimento,
    entrega: number,
    passos: readonly SituacaoEntrega[],
    x: { protocolo?: string | null; mensagem?: string | null },
    agora: Date,
  ): Promise<SituacaoEntrega> {
    const op = definirOperacao<z.infer<typeof ENTRADA_SITUACAO>, { situacao: SituacaoEntrega }>({
      nome: 'integracao.parceiro.envio_entrega',
      tabelas: ['entrega_pacote_parceiro'],
      entrada: ENTRADA_SITUACAO,
      gravar: async (tx, e) => {
        const [l] = await tx.consultarParaAtualizar(
          'SELECT id, situacao, versao FROM entrega_pacote_parceiro WHERE id = ?',
          [e.entrega],
          { teto: 1 },
        );
        let atual = String(l?.['situacao'] ?? 'falhou') as SituacaoEntrega;
        if (!l) return { situacao: atual };
        const campos: Record<string, unknown> = {};
        // Cada passo pela regra do domínio (só para a frente); o que não pode andar para ali.
        for (const s of e.passos) {
          if (!podeMudarEntrega(atual, s)) break;
          atual = s;
          if (s === 'enviada') campos['enviado_em'] = agora;
          if (s === 'confirmada') {
            campos['confirmado_em'] = agora;
            campos['protocolo_confirmacao'] = e.protocolo;
          }
        }
        if (atual === String(l['situacao'])) return { situacao: atual };
        if (e.mensagem) campos['mensagem_retorno'] = e.mensagem;
        await tx.alterar('entrega_pacote_parceiro', e.entrega, n(l['versao']), {
          situacao: atual,
          ...campos,
        });
        return { situacao: atual };
      },
      alvo: (e) => ({ tabela: 'entrega_pacote_parceiro', id: e.entrega }),
    });
    const r = await this.executor.executar(
      op,
      this.cliente,
      { entrega, passos: [...passos], protocolo: x.protocolo ?? null, mensagem: x.mensagem ?? null },
      {
        cliente: this.cliente,
        estabelecimento: ref.id,
        usuario: null,
        correlacao: `entrega-${entrega}`,
        chaveIdempotencia: `worker.entrega.${entrega}.${randomUUID()}`.slice(0, 80),
      },
    );
    return r.resultado.situacao;
  }
}
