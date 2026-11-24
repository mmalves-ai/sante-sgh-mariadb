// Leituras PRÓPRIAS do portal do paciente (modulos-proprios-2, família portal-leituras): os 19 métodos de leitura da
// PortaPortalPaciente que a porta própria recusava com 503 `recurso-sem-modelo`, sobre o MariaDB do cliente pelo
// `nucleo.lerSomente`. O contrato é o da porta de memória (porta-memoria.ts): os mesmos filtros, a mesma ordem, a
// mesma página e a versão da linha (o serviço confere a versão na gravação).
//   - Conta, troca do e-mail e vínculo: conta_portal_paciente, troca_email_conta_portal, vinculo_responsavel_portal
//     (colunas da migração 17_INTG/91), sempre do ESTABELECIMENTO da sessão, como a gravação própria.
//   - Consentimento: consentimento_titular (o domínio numérico do contrato pelos mapas da gravação própria).
//   - Pedido do titular e cópia do prontuário: pedido_titular, solicitacao_copia_prontuario e ato_copia_prontuario.
//   - Documentos do portal: o envelope documento_assinado do paciente (os tipos do portal), 100 por página.
//   - Relatório de acessos do titular: a trilha única (trilha_auditoria), pelo evento e pelo paciente dos dados.
// Nada é gravado aqui. Nenhum valor sai em log.
// Melhoria: a página da fila de vínculos e a dos documentos são cortadas no banco (LIMIT do teto + 1), não na memória.
// Melhoria: o situação "expirada" da troca do e-mail (o modelo próprio a tem) chega ao domínio como cancelada.
import type { Leitor, Linha } from '@sgh/nucleo';
import type { ContextoPortal, DominiosConsentimento } from './porta.js';
import {
  DOMINIOS_CONSENTIMENTO_PROPRIO,
  SIGNATARIO_DO_BANCO,
  SITUACAO_CONSENTIMENTO_DO_BANCO,
  SITUACAO_CONTA_DO_BANCO,
  SITUACAO_PEDIDO_DO_BANCO,
} from './porta-propria-gravacao.js';
import {
  type AtoCopia,
  type AtoCopiaPortal,
  type ConsentimentoPortal,
  type ContaPortal,
  type CopiaNaFila,
  type DocumentoPortal,
  type EnvioTrocaEmailPortal,
  type FiltroFilaVinculosPortal,
  type LeituraTitular,
  type OrigemTrocaEmailPortal,
  type PedidoPortal,
  type SituacaoTrocaEmailPortal,
  type SituacaoVinculoPortal,
  TETO_FILA_VINCULOS,
  type TipoContaPortal,
  type TrocaEmailPortal,
  type VinculoPortal,
} from './tipos.js';

/** O que as leituras usam da porta própria: o leitor do cliente e o id do estabelecimento da sessão. */
export interface FonteLeituraPortal {
  ler<T>(c: ContextoPortal, fn: (l: Leitor) => Promise<T>): Promise<T>;
  estabelecimento(c: ContextoPortal): Promise<number>;
}

/** Documentos do portal por página (o mesmo corte da porta de memória). */
export const DOCUMENTOS_POR_PAGINA = 100;
/** Teto das leituras de lista do titular (consentimentos, pedidos, vínculos, cópias, atos). */
const TETO = 500;
/** Teto das leituras do relatório de acessos (o serviço pagina em grupos; `haMais` avisa o corte). */
const TETO_LEITURAS = 5_000;
/** Teto das contas abertas (a rotina de manutenção lê todas; passar do teto é erro, nunca corte calado). */
const TETO_CONTAS = 200_000;
/** Página interna da leitura dos vínculos ativos (cursor por id; a rotina de vigência recebe todos, sem teto). */
const PAGINA_VINCULOS_ATIVOS = 1_000;
/** Janela dos pedidos de cópia já decididos na fila sem filtro (os mais recentes); os pendentes vêm todos. */
export const JANELA_COPIAS_DECIDIDAS = 2_000;
/** O login com que a conta do portal aparece na trilha e nos atos (o mesmo `quemDaConta` do serviço). */
const PREFIXO_CONTA = 'SGH.PORTAL.C';

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const textoOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
function instante(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  return v instanceof Date ? v : new Date(String(v));
}
const instanteIso = (v: unknown): string | null => instante(v)?.toISOString() ?? null;
function dataIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}
function lista(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  try {
    const x: unknown = JSON.parse(texto(v));
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
}
const quemDaConta = (conta: unknown) => `${PREFIXO_CONTA}${num(conta)}`.slice(0, 31);
const marcas = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** Situação do consentimento no banco → id do contrato (o inverso de SITUACAO_CONSENTIMENTO_DO_BANCO). */
const SITUACAO_CONSENTIMENTO_DO_DOMINIO: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(SITUACAO_CONSENTIMENTO_DO_BANCO).map(([id, s]) => [s, Number(id)]),
);
const SIGNATARIO_DO_DOMINIO: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(SIGNATARIO_DO_BANCO).map(([id, s]) => [s, Number(id)]),
);
/** Tipo do pedido no modelo → contrato do portal (o inverso do mapa da gravação própria). */
const TIPO_PEDIDO_DO_BANCO: Readonly<Record<string, string>> = {
  informacao_compartilhamento: 'compartilhamento',
  revogacao_consentimento: 'revogacao-consentimento',
  revisao_decisao_automatizada: 'revisao-decisao-automatizada',
};
const tipoPedido = (t: string) => TIPO_PEDIDO_DO_BANCO[t] ?? t.replace(/_/g, '-');
const situacaoPedido = (s: string) => SITUACAO_PEDIDO_DO_BANCO[s] ?? s;
/** As situações do pedido que ainda pedem trabalho (o "aberto" e o "identidade-verificada" do domínio). */
const PEDIDO_PENDENTE = ['recebido', 'em_analise', 'aguardando_titular'] as const;
/** Situação da troca do e-mail no banco → domínio. */
const TROCA_DO_BANCO: Readonly<Record<string, SituacaoTrocaEmailPortal>> = {
  pendente: 'pendente',
  confirmada: 'confirmada',
  cancelada: 'cancelada',
  expirada: 'cancelada',
};
const ENVIO_DO_DOMINIO: Readonly<Record<string, EnvioTrocaEmailPortal>> = {
  simulador: 'simulador',
  plataforma: 'halai',
};
/** Situação do envelope do documento → eventos que o domínio lê (documentoVisivelNoPortal). */
const EVENTOS_DO_DOCUMENTO: Readonly<Record<string, readonly string[]>> = {
  assinado: ['assinado'],
  cancelado: ['suspenso', 'cancelado'],
  invalidado: ['suspenso', 'invalidado'],
};

// ------------------------------------------------------------------------------------------------ SQL

const SQL_CONTA = `SELECT c.id, c.tipo, c.paciente_id, p.numero_prontuario, c.nome_responsavel, c.nascimento_responsavel,
    c.situacao, c.email, c.email_resumo, c.senha_resumo, c.segundo_fator_envelope, c.segundo_fator_em, c.termo_aceito_em,
    c.convite_resumo, c.convite_valido_ate, c.convite_usado_em, c.convite_erradas, c.convite_origem, c.convidado_por,
    c.tentativas_falhas, c.bloqueada_ate, c.motivo_bloqueio, c.motivo_encerramento, c.ativada_em, c.ultimo_acesso_em,
    c.encerrada_em, c.criado_em, c.versao
  FROM conta_portal_paciente c LEFT JOIN paciente p ON p.id = c.paciente_id
 WHERE c.estabelecimento_id = ? AND c.excluido_em IS NULL`;

const SQL_TROCA = `SELECT t.id, t.conta_portal_paciente_id, t.email_novo, t.email_novo_resumo, t.valido_ate, t.canal_pedido,
    t.motivo, u.login AS pedido_por, t.envio, t.situacao, t.criado_em, t.decidido_em
  FROM troca_email_conta_portal t
  JOIN conta_portal_paciente c ON c.id = t.conta_portal_paciente_id AND c.estabelecimento_id = ?
  LEFT JOIN usuario u ON u.id = t.pedido_por_usuario_id
 WHERE t.excluido_em IS NULL`;

const SQL_VINCULO = `SELECT v.id, v.conta_portal_paciente_id, v.paciente_id, p.numero_prontuario, v.tipo_vinculo, v.prova,
    v.prova_arquivo_chave, v.prova_resumo, v.validade, v.escopos, v.situacao, v.canal, v.pedido_em, v.pedido_por,
    COALESCE(v.decidido_por, u.login) AS decidido_por, v.decidido_em, v.motivo_recusa, v.motivo_fim, v.encerrado_em,
    v.versao
  FROM vinculo_responsavel_portal v
  JOIN paciente p ON p.id = v.paciente_id
  LEFT JOIN usuario u ON u.id = v.decidido_por_usuario_id
 WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL`;

// ------------------------------------------------------------------------------------------------ linhas

export function contaDaLinha(x: Linha, hospital: string): ContaPortal {
  return {
    id: num(x['id']),
    hospital,
    tipo: texto(x['tipo']) as TipoContaPortal,
    paciente: numOuNull(x['paciente_id']),
    prontuario: numOuNull(x['numero_prontuario']),
    nome: textoOuNull(x['nome_responsavel']),
    nascimento: dataIso(x['nascimento_responsavel']),
    situacao: SITUACAO_CONTA_DO_BANCO[texto(x['situacao'])] ?? 'encerrada',
    email: textoOuNull(x['email']),
    emailResumo: textoOuNull(x['email_resumo']),
    senhaResumo: textoOuNull(x['senha_resumo']),
    segundoFator: textoOuNull(x['segundo_fator_envelope']),
    segundoFatorEm: instante(x['segundo_fator_em']),
    termosEm: instante(x['termo_aceito_em']),
    conviteResumo: textoOuNull(x['convite_resumo']),
    conviteValidoAte: instante(x['convite_valido_ate']),
    conviteUsadoEm: instante(x['convite_usado_em']),
    conviteErradas: num(x['convite_erradas'] ?? 0),
    conviteOrigem: texto(x['convite_origem']),
    convidadoPor: texto(x['convidado_por']),
    tentativas: num(x['tentativas_falhas'] ?? 0),
    bloqueadoAte: instante(x['bloqueada_ate']),
    motivoBloqueio: textoOuNull(x['motivo_bloqueio']),
    motivoEncerramento: textoOuNull(x['motivo_encerramento']),
    ativadaEm: instante(x['ativada_em']),
    ultimoAcessoEm: instante(x['ultimo_acesso_em']),
    encerradaEm: instante(x['encerrada_em']),
    criadaEm: instante(x['criado_em']) ?? new Date(0),
    versao: num(x['versao']),
  };
}

export function trocaDaLinha(x: Linha): TrocaEmailPortal {
  const conta = num(x['conta_portal_paciente_id']);
  const origem = texto(x['canal_pedido']) as OrigemTrocaEmailPortal;
  return {
    id: num(x['id']),
    conta,
    emailNovo: texto(x['email_novo']),
    emailNovoResumo: texto(x['email_novo_resumo']),
    validoAte: instante(x['valido_ate']) ?? new Date(0),
    origem,
    motivo: texto(x['motivo']),
    // O balcão guarda o usuário do hospital; o pedido do portal é da própria conta.
    pedidoPor: textoOuNull(x['pedido_por']) ?? quemDaConta(conta),
    envio: ENVIO_DO_DOMINIO[texto(x['envio'])] ?? 'simulador',
    situacao: TROCA_DO_BANCO[texto(x['situacao'])] ?? 'cancelada',
    criadoEm: instanteIso(x['criado_em']),
    decididoEm: instanteIso(x['decidido_em']),
  };
}

export function vinculoDaLinha(x: Linha, hospital: string): VinculoPortal {
  return {
    id: num(x['id']),
    hospital,
    conta: num(x['conta_portal_paciente_id']),
    titular: num(x['paciente_id']),
    prontuarioTitular: num(x['numero_prontuario']),
    tipo: texto(x['tipo_vinculo']),
    prova: texto(x['prova']),
    arquivoChave: textoOuNull(x['prova_arquivo_chave']),
    arquivoHash: textoOuNull(x['prova_resumo']),
    validade: dataIso(x['validade']),
    escopos: lista(x['escopos']),
    situacao: texto(x['situacao']) as SituacaoVinculoPortal,
    canal: texto(x['canal']) === 'balcao' ? 'balcao' : 'portal',
    pedidoEm: instante(x['pedido_em']) ?? new Date(0),
    pedidoPor: texto(x['pedido_por']),
    decididoPor: textoOuNull(x['decidido_por']),
    decididoEm: instante(x['decidido_em']),
    motivoRecusa: textoOuNull(x['motivo_recusa']),
    motivoFim: textoOuNull(x['motivo_fim']),
    encerradoEm: instante(x['encerrado_em']),
    versao: num(x['versao']),
  };
}

export function consentimentoDaLinha(x: Linha): ConsentimentoPortal {
  // O revogado guarda a situação que tinha antes (o contrato do portal mostra a revogação pela data).
  const s = texto(x['situacao']) === 'revogado' ? texto(x['situacao_anterior']) : texto(x['situacao']);
  return {
    id: num(x['id']),
    finalidade: texto(x['finalidade']),
    versao: texto(x['versao_termo']),
    situacao: SITUACAO_CONSENTIMENTO_DO_DOMINIO[s] ?? SITUACAO_CONSENTIMENTO_DO_DOMINIO['emitido'] ?? 1,
    signatario: SIGNATARIO_DO_DOMINIO[texto(x['tipo_signatario'])] ?? 1,
    registradoEm: instanteIso(x['emitido_em']) ?? '',
    revogadoEm: instanteIso(x['revogado_em']),
    canal: textoOuNull(x['canal_registro']),
  };
}

export function pedidoDaLinha(x: Linha): PedidoPortal {
  return {
    id: String(num(x['id'])),
    protocolo: texto(x['numero']),
    tipo: tipoPedido(texto(x['tipo'])),
    situacao: situacaoPedido(texto(x['situacao'])),
    abertoEm: instanteIso(x['recebido_em']) ?? '',
    prazo: instanteIso(x['prazo_em']) ?? '',
    decididoEm: instanteIso(x['respondido_em']) ?? instanteIso(x['cancelado_em']),
    fundamento: textoOuNull(x['fundamento_decisao']),
    resposta: textoOuNull(x['resposta']) ?? textoOuNull(x['motivo_indeferimento']),
    motivoCancelamento: textoOuNull(x['motivo_cancelamento']),
  };
}

export function atoDaLinha(x: Linha): AtoCopia {
  return {
    id: String(num(x['id'])),
    ato: texto(x['ato']) as AtoCopiaPortal,
    solicitante: textoOuNull(x['solicitante']),
    vinculo: textoOuNull(x['vinculo']),
    prova: textoOuNull(x['prova']),
    hash: textoOuNull(x['hash_conteudo']),
    paginas: numOuNull(x['paginas']),
    meio: textoOuNull(x['meio']),
    recebedor: textoOuNull(x['recebedor']),
    usuario: (
      textoOuNull(x['login']) ??
      (x['conta_portal_paciente_id'] == null ? '' : quemDaConta(x['conta_portal_paciente_id']))
    ).slice(0, 31),
    em: instante(x['ocorrido_em']) ?? new Date(0),
  };
}

export function documentoDaLinha(x: Linha): DocumentoPortal {
  const situacao = texto(x['situacao']);
  const nivel = texto(x['nivel_exigido']);
  return {
    id: num(x['id']),
    tipo: texto(x['tipo_documento']),
    paciente: num(x['paciente_id']),
    criadoEm: instanteIso(x['gerado_em']) ?? '',
    usuario: texto(x['login']),
    nivelAssinatura: nivel,
    eventos: [...(EVENTOS_DO_DOCUMENTO[situacao] ?? [])],
    assinaturaIcp: nivel === 'icp-brasil' && situacao === 'assinado' ? num(x['id']) : null,
    codigoVerificacao: situacao === 'assinado' ? textoOuNull(x['codigo_verificacao']) : null,
  };
}

// ------------------------------------------------------------------------------------------------ leituras

/** As 19 leituras próprias do portal (a porta própria delega cada método a esta classe). */
export class LeiturasPortalProprias {
  constructor(private readonly fonte: FonteLeituraPortal) {}

  private async comEst<T>(c: ContextoPortal, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = await this.fonte.estabelecimento(c);
    return this.fonte.ler(c, (l) => fn(l, est));
  }

  private umaConta(c: ContextoPortal, filtro: string, p: readonly unknown[]): Promise<ContaPortal | null> {
    return this.comEst(c, async (l, est) => {
      const x = await l.uma(`${SQL_CONTA} AND ${filtro} ORDER BY c.id DESC LIMIT 1`, [est, ...p]);
      return x ? contaDaLinha(x, c.hospital) : null;
    });
  }

  conta(c: ContextoPortal, id: number): Promise<ContaPortal | null> {
    return this.umaConta(c, 'c.id = ?', [id]);
  }

  /** A conta pelo resumo do e-mail confirmado (a conta sem e-mail nunca casa). */
  contaPorEmail(c: ContextoPortal, emailResumo: string): Promise<ContaPortal | null> {
    return this.umaConta(c, 'c.email_resumo = ? AND c.email IS NOT NULL', [emailResumo]);
  }

  contaPorConvite(c: ContextoPortal, conviteResumo: string): Promise<ContaPortal | null> {
    return this.umaConta(c, 'c.convite_resumo = ?', [conviteResumo]);
  }

  /** A conta vigente do paciente; sem vigente, a última encerrada (como na memória). */
  contaDoPaciente(c: ContextoPortal, paciente: number): Promise<ContaPortal | null> {
    return this.comEst(c, async (l, est) => {
      const x = await l.uma(
        `${SQL_CONTA} AND c.paciente_id = ? ORDER BY c.situacao <> 'encerrada' DESC, c.id DESC LIMIT 1`,
        [est, paciente],
      );
      return x ? contaDaLinha(x, c.hospital) : null;
    });
  }

  contasAbertas(c: ContextoPortal): Promise<{ conta: number; paciente: number; versao: number }[]> {
    return this.comEst(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT id, paciente_id, versao FROM conta_portal_paciente
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND tipo = 'paciente' AND situacao <> 'encerrada'
              AND paciente_id IS NOT NULL
            ORDER BY id`,
          [est],
          { teto: TETO_CONTAS },
        )
      ).map((x) => ({ conta: num(x['id']), paciente: num(x['paciente_id']), versao: num(x['versao']) })),
    );
  }

  trocaEmailPorToken(c: ContextoPortal, tokenResumo: string): Promise<TrocaEmailPortal | null> {
    return this.comEst(c, async (l, est) => {
      const x = await l.uma(`${SQL_TROCA} AND t.codigo_resumo = ?`, [est, tokenResumo]);
      return x ? trocaDaLinha(x) : null;
    });
  }

  trocaEmailPendente(c: ContextoPortal, conta: number): Promise<TrocaEmailPortal | null> {
    return this.comEst(c, async (l, est) => {
      const x = await l.uma(
        `${SQL_TROCA} AND t.conta_portal_paciente_id = ? AND t.situacao = 'pendente' ORDER BY t.id DESC LIMIT 1`,
        [est, conta],
      );
      return x ? trocaDaLinha(x) : null;
    });
  }

  private vinculos(c: ContextoPortal, filtro: string, p: readonly unknown[], ordem: string) {
    return this.comEst(c, async (l, est) =>
      (await l.consultar(`${SQL_VINCULO}${filtro} ORDER BY ${ordem}`, [est, ...p], { teto: TETO })).map((x) =>
        vinculoDaLinha(x, c.hospital),
      ),
    );
  }

  vinculosDaConta(c: ContextoPortal, conta: number): Promise<VinculoPortal[]> {
    return this.vinculos(c, ' AND v.conta_portal_paciente_id = ?', [conta], 'v.id DESC');
  }

  vinculosDoTitular(c: ContextoPortal, paciente: number): Promise<VinculoPortal[]> {
    return this.vinculos(c, ' AND v.paciente_id = ?', [paciente], 'v.id DESC');
  }

  vinculo(c: ContextoPortal, id: number): Promise<VinculoPortal | null> {
    return this.comEst(c, async (l, est) => {
      const x = await l.uma(`${SQL_VINCULO} AND v.id = ?`, [est, id]);
      return x ? vinculoDaLinha(x, c.hospital) : null;
    });
  }

  /** Uma página da fila da conferência: ordem de chegada (id), titulares, cursor e TETO_FILA_VINCULOS. */
  async filaVinculos(
    c: ContextoPortal,
    f: FiltroFilaVinculosPortal,
  ): Promise<{ itens: VinculoPortal[]; haMais: boolean }> {
    if (f.titulares && f.titulares.length === 0) return { itens: [], haMais: false };
    let filtro = '';
    const p: unknown[] = [];
    if (f.situacao !== null) {
      filtro += ' AND v.situacao = ?';
      p.push(f.situacao);
    }
    if (f.titulares) {
      filtro += ` AND v.paciente_id IN (${marcas(f.titulares.length)})`;
      p.push(...f.titulares);
    }
    if (f.depoisDe !== null && f.depoisDe !== undefined) {
      filtro += ' AND v.id > ?';
      p.push(f.depoisDe);
    }
    const r = await this.comEst(c, async (l, est) =>
      (
        await l.consultar(`${SQL_VINCULO}${filtro} ORDER BY v.id LIMIT ${TETO_FILA_VINCULOS + 1}`, [est, ...p], {
          teto: TETO_FILA_VINCULOS + 1,
        })
      ).map((x) => vinculoDaLinha(x, c.hospital)),
    );
    return { itens: r.slice(0, TETO_FILA_VINCULOS), haMais: r.length > TETO_FILA_VINCULOS };
  }

  /** Todos os vínculos ativos (a rotina de vigência), lidos em páginas por cursor de id: nunca esbarra no teto. */
  async vinculosAtivos(c: ContextoPortal): Promise<VinculoPortal[]> {
    const todos: VinculoPortal[] = [];
    let depoisDe = 0;
    for (;;) {
      const pagina = await this.comEst(c, async (l, est) =>
        (
          await l.consultar(
            `${SQL_VINCULO} AND v.situacao = 'ativo' AND v.id > ? ORDER BY v.id LIMIT ${PAGINA_VINCULOS_ATIVOS}`,
            [est, depoisDe],
            { teto: PAGINA_VINCULOS_ATIVOS },
          )
        ).map((x) => vinculoDaLinha(x, c.hospital)),
      );
      todos.push(...pagina);
      if (pagina.length < PAGINA_VINCULOS_ATIVOS) return todos;
      depoisDe = pagina[pagina.length - 1]!.id;
    }
  }

  /** Os domínios do consentimento do modelo próprio (os mesmos da gravação própria). */
  dominiosConsentimento(): Promise<DominiosConsentimento> {
    return Promise.resolve(DOMINIOS_CONSENTIMENTO_PROPRIO);
  }

  /** Os consentimentos do paciente no estabelecimento (o revogado continua na lista, com a data). */
  consentimentos(c: ContextoPortal, paciente: number): Promise<ConsentimentoPortal[]> {
    return this.comEst(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT k.id, k.finalidade, k.versao_termo, k.situacao, k.tipo_signatario, k.emitido_em, k.revogado_em,
                  k.canal_registro,
                  (SELECT h.situacao_anterior FROM consentimento_titular_historico h
                    WHERE h.consentimento_titular_id = k.id AND h.situacao_nova = 'revogado'
                    ORDER BY h.id DESC LIMIT 1) AS situacao_anterior
             FROM consentimento_titular k
            WHERE k.estabelecimento_id = ? AND k.paciente_id = ? AND k.excluido_em IS NULL
            ORDER BY k.id`,
          [est, paciente],
          { teto: TETO },
        )
      ).map(consentimentoDaLinha),
    );
  }

  /** Os pedidos do titular abertos por esta conta para este paciente (em ordem de abertura). */
  pedidos(c: ContextoPortal, conta: number, paciente: number): Promise<PedidoPortal[]> {
    return this.comEst(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT id, numero, tipo, situacao, recebido_em, prazo_em, respondido_em, cancelado_em, fundamento_decisao,
                  resposta, motivo_indeferimento, motivo_cancelamento
             FROM pedido_titular
            WHERE estabelecimento_id = ? AND conta_portal_paciente_id = ? AND paciente_id = ? AND excluido_em IS NULL
            ORDER BY id`,
          [est, conta, paciente],
          { teto: TETO },
        )
      ).map(pedidoDaLinha),
    );
  }

  /**
   * A fila da cópia do prontuário: os pendentes primeiro, por prazo. Com `protocolo`, só aquele pedido (a ação da
   * equipe sobre uma cópia busca pelo protocolo no banco). Sem paciente nem protocolo, a fila completa traz todos os
   * pendentes e só a janela dos JANELA_COPIAS_DECIDIDAS decididos mais recentes: o histórico só cresce e a leitura
   * nunca esbarra no teto (divergência intencional da memória, que não tem volume).
   */
  filaCopias(
    c: ContextoPortal,
    f: { readonly pendentes: boolean; readonly idPaciente?: number; readonly protocolo?: string },
  ): Promise<CopiaNaFila[]> {
    let filtro = '';
    const p: unknown[] = [];
    if (f.pendentes) {
      filtro += ` AND t.situacao IN (${marcas(PEDIDO_PENDENTE.length)})`;
      p.push(...PEDIDO_PENDENTE);
    }
    if (f.idPaciente !== undefined) {
      filtro += ' AND t.paciente_id = ?';
      p.push(f.idPaciente);
    }
    if (f.protocolo !== undefined) {
      filtro += ' AND t.numero = ?';
      p.push(f.protocolo);
    }
    const janela = !f.pendentes && f.idPaciente === undefined && f.protocolo === undefined;
    return this.comEst(c, async (l, est) => {
      if (janela) {
        filtro += ` AND (t.situacao IN (${marcas(PEDIDO_PENDENTE.length)}) OR t.id IN (
            SELECT j.id FROM (
              SELECT t2.id FROM pedido_titular t2
                JOIN solicitacao_copia_prontuario s2 ON s2.pedido_titular_id = t2.id
                     AND s2.estabelecimento_id = t2.estabelecimento_id AND s2.excluido_em IS NULL
               WHERE t2.estabelecimento_id = ? AND t2.excluido_em IS NULL
                 AND t2.situacao NOT IN (${marcas(PEDIDO_PENDENTE.length)})
               ORDER BY t2.id DESC LIMIT ${JANELA_COPIAS_DECIDIDAS}) j))`;
        p.push(...PEDIDO_PENDENTE, est, ...PEDIDO_PENDENTE);
      }
      const linhas = await l.consultar(
        `SELECT t.id, t.numero, t.situacao, t.canal_recebimento, t.paciente_id, pa.numero_prontuario, t.recebido_em,
                t.prazo_em, sol.solicitante, sol.vinculo,
                EXISTS (SELECT 1 FROM ato_copia_prontuario a WHERE a.solicitacao_copia_prontuario_id = s.id
                          AND a.ato = 'legitimidade' AND a.excluido_em IS NULL) AS legitimidade,
                (SELECT COUNT(*) FROM ato_copia_prontuario a WHERE a.solicitacao_copia_prontuario_id = s.id
                    AND a.ato = 'geracao' AND a.excluido_em IS NULL) AS geracoes,
                EXISTS (SELECT 1 FROM ato_copia_prontuario a WHERE a.solicitacao_copia_prontuario_id = s.id
                          AND a.ato = 'entrega' AND a.excluido_em IS NULL) AS entregue
           FROM pedido_titular t
           JOIN solicitacao_copia_prontuario s ON s.pedido_titular_id = t.id AND s.estabelecimento_id = t.estabelecimento_id
                AND s.excluido_em IS NULL
           JOIN ato_copia_prontuario sol ON sol.solicitacao_copia_prontuario_id = s.id AND sol.ato = 'solicitacao'
                AND sol.excluido_em IS NULL
           LEFT JOIN paciente pa ON pa.id = t.paciente_id
          WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL${filtro}
          ORDER BY t.situacao IN (${marcas(PEDIDO_PENDENTE.length)}) DESC, t.prazo_em, t.id`,
        [est, ...p, ...PEDIDO_PENDENTE],
        { teto: TETO_CONTAS },
      );
      return linhas.map(
        (x): CopiaNaFila => ({
          idPedido: String(num(x['id'])),
          protocolo: texto(x['numero']),
          situacao: situacaoPedido(texto(x['situacao'])),
          canal: texto(x['canal_recebimento']) === 'presencial' ? 'balcao' : texto(x['canal_recebimento']),
          idPaciente: num(x['paciente_id']),
          prontuario: numOuNull(x['numero_prontuario']),
          abertoEm: instante(x['recebido_em']) ?? new Date(0),
          prazo: instante(x['prazo_em']) ?? new Date(0),
          solicitante: textoOuNull(x['solicitante']) ?? 'titular',
          vinculo: textoOuNull(x['vinculo']),
          legitimidade: num(x['legitimidade']) > 0,
          geracoes: num(x['geracoes']),
          entregue: num(x['entregue']) > 0,
        }),
      );
    });
  }

  /** Os atos de uma cópia, em ordem (o pedido de outro estabelecimento não tem atos aqui). */
  atosCopia(c: ContextoPortal, idPedido: string): Promise<AtoCopia[]> {
    const id = Number(idPedido);
    if (!Number.isSafeInteger(id) || id <= 0) return Promise.resolve([]);
    return this.comEst(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT a.id, a.ato, a.solicitante, a.vinculo, a.prova, a.hash_conteudo, a.paginas, a.meio, a.recebedor,
                  u.login, a.conta_portal_paciente_id, a.ocorrido_em
             FROM ato_copia_prontuario a
             JOIN solicitacao_copia_prontuario s ON s.id = a.solicitacao_copia_prontuario_id
             LEFT JOIN usuario u ON u.id = a.usuario_id
            WHERE s.pedido_titular_id = ? AND s.estabelecimento_id = ? AND a.excluido_em IS NULL
            ORDER BY a.ocorrido_em, a.id`,
          [id, est],
          { teto: TETO },
        )
      ).map(atoDaLinha),
    );
  }

  /** Os documentos assinados do paciente nos tipos pedidos (os mais recentes primeiro), 100 por página. */
  async documentos(
    c: ContextoPortal,
    paciente: number,
    tipos: readonly string[],
    pagina: number,
    apenas: number | null = null,
  ): Promise<{ itens: DocumentoPortal[]; haMais: boolean }> {
    if (tipos.length === 0) return { itens: [], haMais: false };
    const de = (Math.max(1, Math.trunc(pagina)) - 1) * DOCUMENTOS_POR_PAGINA;
    const r = await this.comEst(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT d.id, d.tipo_documento, d.paciente_id, d.gerado_em, u.login, d.nivel_exigido, d.situacao,
                  d.codigo_verificacao
             FROM documento_assinado d LEFT JOIN usuario u ON u.id = d.criado_por
            WHERE d.estabelecimento_id = ? AND d.paciente_id = ? AND d.excluido_em IS NULL
              AND d.tipo_documento IN (${marcas(tipos.length)})${apenas === null ? '' : ' AND d.id = ?'}
            ORDER BY d.gerado_em DESC, d.id DESC
            LIMIT ${DOCUMENTOS_POR_PAGINA + 1} OFFSET ${de}`,
          [est, paciente, ...tipos, ...(apenas === null ? [] : [apenas])],
          { teto: DOCUMENTOS_POR_PAGINA + 1 },
        )
      ).map(documentoDaLinha),
    );
    return { itens: r.slice(0, DOCUMENTOS_POR_PAGINA), haMais: r.length > DOCUMENTOS_POR_PAGINA };
  }

  /**
   * As leituras do prontuário do titular registradas na trilha única no período (dias inclusivos): o evento e o
   * paciente vêm dos dados da trilha (no topo, como a trilha do prontuário grava, ou em `dados`, como a operação do
   * portal grava); quem leu é o usuário da linha ou, na leitura pelo portal, o usuário informado nos dados.
   */
  async leituras(
    c: ContextoPortal,
    paciente: number,
    eventos: readonly string[],
    de: string,
    ate: string,
  ): Promise<{ itens: LeituraTitular[]; haMais: boolean }> {
    if (eventos.length === 0) return { itens: [], haMais: false };
    const evento = "COALESCE(JSON_VALUE(t.dados_depois, '$.evento'), JSON_VALUE(t.dados_depois, '$.dados.evento'))";
    const pac = "COALESCE(JSON_VALUE(t.dados_depois, '$.paciente'), JSON_VALUE(t.dados_depois, '$.dados.paciente'))";
    const r = await this.comEst(c, (l, est) =>
      l.consultar(
        `SELECT t.ocorrido_em, ${evento} AS evento,
                COALESCE(u.login, JSON_VALUE(t.dados_depois, '$.dados.usuario'), JSON_VALUE(t.dados_depois, '$.usuario'))
                  AS usuario,
                COALESCE(JSON_VALUE(t.dados_depois, '$.dados.idAlvo'), JSON_VALUE(t.dados_depois, '$.idAlvo'),
                         CAST(t.entidade_id AS CHAR)) AS id_alvo
           FROM trilha_auditoria t LEFT JOIN usuario u ON u.id = t.usuario_id
          WHERE t.estabelecimento_id = ? AND t.ocorrido_em >= ? AND t.ocorrido_em < ? + INTERVAL 1 DAY
            AND ${evento} IN (${marcas(eventos.length)}) AND ${pac} = ?
          ORDER BY t.ocorrido_em, t.id
          LIMIT ${TETO_LEITURAS + 1}`,
        [est, de.slice(0, 10), ate.slice(0, 10), ...eventos, String(paciente)],
        { teto: TETO_LEITURAS + 1 },
      ),
    );
    const itens = r.slice(0, TETO_LEITURAS).map(
      (x): LeituraTitular => ({
        em: instanteIso(x['ocorrido_em']) ?? '',
        usuario: texto(x['usuario']),
        evento: texto(x['evento']),
        idAlvo: textoOuNull(x['id_alvo']),
      }),
    );
    return { itens, haMais: r.length > TETO_LEITURAS };
  }
}
