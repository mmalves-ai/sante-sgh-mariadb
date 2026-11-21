// Porta própria da conta do paciente (M30) sobre o banco do cliente, pelo @sgh/nucleo: leituras numa transação
// somente leitura (conta_hospitalar, conta_hospitalar_item, item_faturavel, pendencia_conta, conta_hospitalar_etapa,
// auditoria_conta*, orcamento_particular*, sessao_caixa, movimento_caixa, recibo, pacote*) e gravações pelo Executor:
// as operações faturamento.* (operacoes.ts) e as gravações diretas (pendência, etapa, versão da auditoria, caixa) numa
// operação própria, com a trilha, o outbox e a idempotência na mesma transação. Toda leitura filtra o estabelecimento
// da sessão e os registros excluídos; fonte pagadora, item faturável e tipos de pendência são da rede inteira.
// Melhoria: situação da conta pela coluna do modelo (regras-conta.ts), sem marca de texto nem emissão à parte; versão
// da conta e do item pela coluna `versao` (trava otimista do núcleo), não por carimbo de data; preço pela tabela de
// preço da conta (preco_procedimento e a vigência em preco_procedimento_valor); CPF sempre mascarado.
// Melhoria: o efeito da pendência vem do tipo (controle), a tela só endurece, e a conta cancelada, enviada ou paga não
// recebe pendência; os pareceres da auditoria vivem no retrato 'depois' da auditoria em andamento (o 'antes' é gravado
// ao abri-la), sem ferir a unicidade (auditoria, momento); a forma de pagamento da tela e a espécie do caixa se
// traduzem por lista branca; a conta particular é a da fonte pagadora de tipo 'particular'.
// Pendências de modelo (pedidos do lote 02-08): a fila do lançamento após o fechamento, as regras de faturabilidade
// por convênio, o item livre do orçamento particular, o recebimento particular e o recibo, a edição de pacotes pela
// tela da conta e a nota de sala: até lá, as leituras saem vazias e as gravações recusam com "modelo-pendente".
import { randomUUID } from 'node:crypto';
import type {
  AuditoriaConta,
  CaixaLido,
  ContaDetalhe,
  ContaResumo,
  ExplicacaoLida,
  ItemConta,
  ItemSigtap,
  LancamentoTardio,
  ListaContas,
  ListaItens,
  NotaSala,
  OrcamentoParticular,
  PacoteLido,
  PagamentoLido,
  PainelLancamentos,
  ReciboLido,
  RegraLida,
  WorklistFaturamento,
} from '@sgh/contratos';
import { grupoDoItem, ROTULO_GRUPO, ROTULO_SITUACAO } from '@sgh/dominio-faturamento';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { LiberacaoGravacao, TrilhaDaGravacao } from '../exames/public-api.js';
import { civil } from '../exames/relogio.js';
import { versaoTexto } from './esquemas.js';
import { OPERACOES_CONTA, precoVigente, tabelasDePreco } from './operacoes.js';
import type {
  ContextoFaturamento,
  FiltroContas,
  FiltroPagamentos,
  GravadorSghFaturamento,
  PortaFaturamento,
} from './porta.js';
import {
  conferirFechamentoConta,
  conferirRegistroPendencia,
  ESPECIE_DA_FORMA,
  filtroDaSituacao,
  formaDaEspecie,
  marcaDeFechamento,
  naturezasDoTipoConta,
  pendenciaBloqueiaFechamento,
  situacaoInferida,
  situacaoNaTela,
  tipoContaDaNatureza,
  tipoDaTela,
  tiposDoGrupo,
  transicaoDaEtapa,
  valorDoItem,
} from './regras-conta.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoFaturamento = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1';
const r2 = (x: number) => Math.round(x * 100) / 100;
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
/** DATE/DATETIME do banco (UTC) → "AAAA-MM-DD". */
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
/** DATETIME do banco (UTC) → ISO com Z. */
const instante = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v ? new Date(`${String(v).replace(' ', 'T')}Z`).toISOString() : null;
const codigoNumerico = (v: unknown, padrao = 0): number => {
  const d = texto(v).replace(/\D/g, '');
  return d && Number.isSafeInteger(Number(d)) ? Number(d) : padrao;
};
/** CPF mascarado: só os dígitos do meio aparecem. */
export const mascararCpf = (cpf: unknown): string => {
  const c = texto(cpf).replace(/\D/g, '');
  return c.length === 11 ? `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**` : '';
};
const json = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  try {
    const o = JSON.parse(texto(v)) as unknown;
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** Pendências "abertas" no modelo (as que ainda pedem tratamento). */
const PENDENCIA_ABERTA = "('aberta','em_tratamento')";

const modeloPendente = (titulo: string, detalhe: string) =>
  new ErroOperacao(409, 'modelo-pendente', titulo, detalhe);

/**
 * Os pareceres da auditoria, na ordem: o retrato 'depois' de cada auditoria guarda a lista dos pareceres; o 'antes' é
 * o retrato ao abrir a auditoria e não é parecer. O id é a posição do parecer na conta (chave da lista na tela).
 */
function pareceresDasVersoes(versoes: readonly Linha[]): AuditoriaConta['versoes'] {
  const saida: AuditoriaConta['versoes'][number][] = [];
  for (const v of versoes) {
    const d = json(v['dados']);
    const lista = d['pareceres'];
    if (!Array.isArray(lista)) continue;
    for (const x of lista as Record<string, unknown>[])
      saida.push({
        id: saida.length + 1,
        papel: texto(x['papel']),
        parecer: texto(x['parecer']),
        usuario: texto(x['login']),
        em: texto(x['em']),
        total: n(x['total']),
        itens: n(x['itens']),
      });
  }
  return saida;
}

/** Tabelas das gravações diretas da porta. */
export const TABELAS_GRAVACAO_DIRETA = [
  'pendencia_conta',
  'conta_hospitalar',
  'conta_hospitalar_etapa',
  'auditoria_conta',
  'auditoria_conta_versao',
  'sessao_caixa',
] as const;

const SELECAO_CONTA = `
  SELECT ch.id, ch.numero, ch.competencia, ch.natureza, ch.situacao, ch.fonte_pagadora_id,
         fp.nome AS fonte_nome, fp.tipo AS fonte_tipo,
         COALESCE(NULLIF(p.nome_social, ''), pf.nome) AS paciente_nome, p.numero_prontuario,
         ch.valor_total, ch.fechada_em, ch.versao, ch.inicio_em, a.alta_medica_em, a.numero AS atendimento_numero,
         (SELECT COUNT(*) FROM pendencia_conta pc WHERE pc.conta_hospitalar_id = ch.id AND pc.excluido_em IS NULL
             AND pc.situacao IN ${PENDENCIA_ABERTA}) AS pendencias,
         EXISTS (SELECT 1 FROM lote_tiss_conta lt WHERE lt.conta_hospitalar_id = ch.id AND lt.excluido_em IS NULL)
           AS em_lote,
         (SELECT COUNT(*) FROM conta_hospitalar_pacote cp WHERE cp.conta_hospitalar_id = ch.id
             AND cp.excluido_em IS NULL) AS pacotes
    FROM conta_hospitalar ch
    JOIN fonte_pagadora fp ON fp.id = ch.fonte_pagadora_id
    JOIN paciente p ON p.id = ch.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    JOIN atendimento a ON a.id = ch.atendimento_id`;

function diasEntre(desde: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

function resumoDaConta(x: Linha, hoje: string): ContaResumo {
  const situacao = texto(x['situacao']);
  const tela = situacaoNaTela(situacao, verdadeiro(x['em_lote']));
  const inferida = situacaoInferida(situacao);
  const alta = dataIso(x['alta_medica_em']);
  const competencia = dataIso(x['competencia']) ?? '';
  return {
    id: n(x['id']),
    ano: Number(competencia.slice(0, 4)) || 0,
    mes: Number(competencia.slice(5, 7)) || 0,
    tipoConta: tipoContaDaNatureza(texto(x['natureza'])),
    codigo: codigoNumerico(x['numero'], n(x['id'])),
    paciente: texto(x['paciente_nome']),
    convenio: n(x['fonte_pagadora_id']),
    convenioNome: texto(x['fonte_nome']),
    situacao: tela,
    situacaoRotulo: ROTULO_SITUACAO[tela] + (inferida ? ' (informada pelo retorno)' : ''),
    inferida,
    fechada: marcaDeFechamento(situacao),
    emitida: false,
    alta,
    diasDesdeAlta: alta ? Math.max(0, diasEntre(alta, hoje)) : null,
    total: n(x['valor_total']),
    pacote: n(x['pacotes']) > 0 ? 'C' : 'N',
    pendencias: n(x['pendencias']),
  };
}

const SELECAO_ITEM = `
  SELECT ci.id, ci.versao, ci.conta_hospitalar_id, ci.realizado_em, ci.quantidade, ci.valor_unitario,
         ci.percentual_cobranca, ci.valor_honorario, ci.valor_custo_operacional, ci.valor_filme, ci.valor_acrescimo,
         ci.valor_desconto, ci.valor_total, ci.pertence_pacote, ci.situacao, ci.tipo_valorizacao,
         i.codigo AS item_codigo, i.descricao AS item_nome, i.tipo_item,
         ol.codigo AS origem_codigo, ol.descricao AS origem_nome,
         uc.login AS lancado_por, ua.login AS alterado_por_login
    FROM conta_hospitalar_item ci
    JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id
    JOIN item_faturavel i ON i.id = ci.item_faturavel_id
    LEFT JOIN origem_lancamento ol ON ol.id = ci.origem_lancamento_id
    LEFT JOIN usuario uc ON uc.id = ci.criado_por
    LEFT JOIN usuario ua ON ua.id = ci.alterado_por`;

function itemDaConta(x: Linha, fuso: string): ItemConta {
  const tipo = tipoDaTela(texto(x['tipo_item']));
  const quando = x['realizado_em'] instanceof Date ? civil(x['realizado_em'], fuso) : null;
  const grupo = grupoDoItem(tipo);
  const noPacote = verdadeiro(x['pertence_pacote']);
  return {
    id: n(x['id']),
    versao: versaoTexto(n(x['versao'])),
    tipo,
    grupo: grupo ? ROTULO_GRUPO[grupo] : '',
    data: quando?.data ?? '',
    hora: quando ? `${quando.hhmm.slice(0, 2)}:${quando.hhmm.slice(2, 4)}` : '',
    codigo: codigoNumerico(x['item_codigo']),
    nome: texto(x['item_nome']),
    quantidade: n(x['quantidade']),
    unitario: n(x['valor_unitario']),
    valor: n(x['valor_total']),
    ch: n(x['valor_honorario']),
    cop: n(x['valor_custo_operacional']),
    filme: n(x['valor_filme']),
    perc: n(x['percentual_cobranca']),
    veio: texto(x['origem_codigo']) || 'manual',
    origemRotulo: texto(x['origem_nome']) || 'Lançamento manual',
    origemAConfirmar: false,
    documentoOrigem: null,
    pacote: noPacote ? 'S' : 'N',
    pacoteRotulo: noPacote ? 'Incluído no pacote' : 'Fora de pacote',
    conferidoPor: texto(x['situacao']) === 'conferido' ? texto(x['alterado_por_login']) : '',
    usuario: texto(x['lancado_por']),
    sigtap: null,
  };
}

export class PortaFaturamentoPropria implements PortaFaturamento {
  readonly destino = 'banco' as const;
  private readonly executor;

  constructor(
    private readonly nucleo: NucleoFaturamento,
    private readonly cliente: string,
    executorPronto?: ReturnType<NucleoProprio['criarExecutor']>,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private contexto(c: ContextoFaturamento) {
    return { cliente: this.cliente, correlacao: (c.correlacao || 'faturamento').slice(0, 64) };
  }

  /** O estabelecimento da sessão: o id do contexto, ou o do código (o mapa da sessão ainda não leu). */
  private async estabelecimento(c: ContextoFaturamento, l: Leitor): Promise<number> {
    if (c.estabelecimento !== null) return c.estabelecimento;
    const e = await l.uma<Linha>('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
      c.hospital,
    ]);
    if (!e) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return n(e['id']);
  }

  private ler<T>(c: ContextoFaturamento, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(this.contexto(c), async (l) => fn(l, await this.estabelecimento(c, l)));
  }

  private async fuso(l: Leitor, est: number): Promise<string> {
    const e = await l.uma<Linha>('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
    return texto(e?.['fuso_horario']) || 'America/Sao_Paulo';
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(c: ContextoFaturamento, op: string): Promise<LiberacaoGravacao> {
    const operacao = OPERACOES_CONTA[op];
    if (!operacao) return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida.' };
    return this.executor.liberacao(operacao, {
      cliente: this.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: this.contexto(c).correlacao,
      chaveIdempotencia: 'consulta.liberacao',
    });
  }

  async executar(c: ContextoFaturamento, op: string, entrada: unknown, ctx: ContextoOperacao) {
    const operacao = OPERACOES_CONTA[op];
    if (!operacao) throw recusa('operacao-desconhecida', 'Operação desconhecida na conta do paciente.');
    const est = ctx.estabelecimento ?? (await this.ler(c, async (_l, e) => e));
    const r = await this.executor.executar(operacao, this.cliente, entrada, { ...ctx, estabelecimento: est });
    return { resultado: r.resultado, repetida: r.repetida, trilha: r.trilha };
  }

  async gravarSgh<T>(
    c: ContextoFaturamento,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorSghFaturamento) => Promise<T>,
  ): Promise<T> {
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const est = c.estabelecimento ?? (await this.ler(c, async (_l, e) => e));
    const op = definirOperacao({
      nome: 'faturamento.gravacao-direta',
      tabelas: TABELAS_GRAVACAO_DIRETA,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorSobre(tx, est)) };
        return {} as ResultadoOperacao;
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'conta_hospitalar', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = `direta:${randomUUID()}`;
    await this.executor.executar(op, this.cliente, { chave }, {
      cliente: this.cliente,
      estabelecimento: est,
      usuario: c.usuario,
      correlacao: this.contexto(c).correlacao,
      chaveIdempotencia: chave,
    });
    if (!saida) throw new Error('Gravação direta sem resultado.');
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────

  /** O dia de hoje no fuso do estabelecimento. */
  hoje(c: ContextoFaturamento): Promise<string> {
    return this.ler(c, async (l, est) => civil(new Date(), await this.fuso(l, est)).data);
  }

  /** Fontes pagadoras ativas (cadastro da rede inteira, sem estabelecimento). */
  convenios(c: ContextoFaturamento): Promise<{ codigo: number; nome: string }[]> {
    return this.ler(c, async (l) => {
      const r = await l.consultar<Linha>(
        "SELECT id, nome FROM fonte_pagadora WHERE excluido_em IS NULL AND situacao = 'ativa' ORDER BY nome",
        [],
        { teto: 5_000 },
      );
      return r.map((x) => ({ codigo: n(x['id']), nome: texto(x['nome']) }));
    });
  }

  contas(c: ContextoFaturamento, f: FiltroContas, hoje: string): Promise<ListaContas> {
    return this.ler(c, async (l, est) => {
      const onde: string[] = ['ch.estabelecimento_id = ?', 'ch.excluido_em IS NULL', "ch.situacao <> 'cancelada'"];
      const p: unknown[] = [est];
      if (f.convenios !== null) {
        if (f.convenios.length === 0) return { contas: [], total: 0, pagina: f.pagina, porPagina: f.porPagina, regua: 'competencia' };
        onde.push(`ch.fonte_pagadora_id IN (${lista(f.convenios.length)})`);
        p.push(...f.convenios);
      }
      if (f.situacao) {
        const s = filtroDaSituacao(f.situacao);
        if (!s) return { contas: [], total: 0, pagina: f.pagina, porPagina: f.porPagina, regua: 'competencia' };
        onde.push(`ch.situacao IN (${lista(s.situacoes.length)})`);
        p.push(...s.situacoes);
        if (s.emLote !== null)
          onde.push(
            `${s.emLote ? '' : 'NOT '}(ch.situacao = 'faturada' OR EXISTS (SELECT 1 FROM lote_tiss_conta lt
              WHERE lt.conta_hospitalar_id = ch.id AND lt.excluido_em IS NULL))`,
          );
      }
      if (f.ano) {
        if (f.mes) {
          onde.push('ch.competencia = ?');
          p.push(`${f.ano}-${String(f.mes).padStart(2, '0')}-01`);
        } else {
          onde.push('ch.competencia BETWEEN ? AND ?');
          p.push(`${f.ano}-01-01`, `${f.ano}-12-01`);
        }
      }
      if (f.tipoConta) {
        const nat = naturezasDoTipoConta(f.tipoConta);
        onde.push(`ch.natureza IN (${lista(nat.length)})`);
        p.push(...nat);
      }
      if (f.sus) onde.push("fp.tipo = 'publico'");
      if (f.altaAte) {
        onde.push('a.alta_medica_em IS NOT NULL AND a.alta_medica_em < DATE_ADD(?, INTERVAL 1 DAY)');
        p.push(f.altaAte);
      }
      const termo = f.termo.trim();
      if (termo) {
        onde.push('(pf.nome LIKE ? OR ch.numero = ? OR p.numero_prontuario = ?)');
        p.push(`%${termo.replace(/[\\%_]/g, (m) => `\\${m}`)}%`, termo, /^\d+$/.test(termo) ? Number(termo) : -1);
      }
      const where = onde.join(' AND ');
      const total = await l.uma<Linha>(
        `SELECT COUNT(*) AS n FROM conta_hospitalar ch JOIN fonte_pagadora fp ON fp.id = ch.fonte_pagadora_id
           JOIN paciente p ON p.id = ch.paciente_id JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           JOIN atendimento a ON a.id = ch.atendimento_id WHERE ${where}`,
        p,
      );
      const linhas = await l.consultar<Linha>(
        `${SELECAO_CONTA} WHERE ${where} ORDER BY ch.competencia DESC, ch.id DESC LIMIT ? OFFSET ?`,
        [...p, f.porPagina, f.pagina * f.porPagina],
        { teto: f.porPagina },
      );
      return {
        contas: linhas.map((x) => resumoDaConta(x, hoje)),
        total: n(total?.['n']),
        pagina: f.pagina,
        porPagina: f.porPagina,
        regua: 'competencia',
      };
    });
  }

  conta(c: ContextoFaturamento, id: number, hoje: string): Promise<ContaDetalhe | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma<Linha>(
        `${SELECAO_CONTA.replace(
          'ch.inicio_em,',
          `ch.inicio_em, ch.senha_autorizacao, uf.login AS fechada_por, g.numero_guia_operadora, g.numero AS guia_numero,
           cob.numero_carteira, cob.validade AS validade_carteira, pfp.descricao AS plano_nome, pf.cpf,`,
        ).replace(
          'JOIN atendimento a ON a.id = ch.atendimento_id',
          `JOIN atendimento a ON a.id = ch.atendimento_id
           LEFT JOIN usuario uf ON uf.id = ch.fechada_por_usuario_id
           LEFT JOIN guia_fonte_pagadora g ON g.id = ch.guia_fonte_pagadora_id
           LEFT JOIN cobertura_paciente cob ON cob.id = ch.cobertura_paciente_id
           LEFT JOIN plano_fonte_pagadora pfp ON pfp.id = ch.plano_fonte_pagadora_id`,
        )} WHERE ch.id = ? AND ch.estabelecimento_id = ? AND ch.excluido_em IS NULL`,
        [id, est],
      );
      if (!x) return null;
      const resumo = resumoDaConta(x, hoje);
      const soma = await l.uma<Linha>(
        `SELECT COUNT(*) AS itens, COALESCE(SUM(valor_total), 0) AS soma FROM conta_hospitalar_item
          WHERE conta_hospitalar_id = ? AND excluido_em IS NULL AND situacao <> 'estornado'`,
        [id],
      );
      const lotes = await l.uma<Linha>(
        'SELECT COUNT(*) AS n FROM lote_tiss_conta WHERE conta_hospitalar_id = ? AND excluido_em IS NULL',
        [id],
      );
      const guias = await l.consultar<Linha>(
        `SELECT tipo_guia, numero, numero_guia_operadora, senha FROM guia_fonte_pagadora
          WHERE conta_hospitalar_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL ORDER BY id`,
        [id, est],
        { teto: 200 },
      );
      const pend = await this.pendenciasDa(l, est, id);
      const etapas = await this.etapasDa(l, id);
      const bloqueantes = pend.filter((p) => p.aberta && p.bloqueante).length;
      const aud = await l.uma<Linha>(
        `SELECT COUNT(*) AS n FROM auditoria_conta WHERE conta_hospitalar_id = ? AND estabelecimento_id = ?
            AND excluido_em IS NULL AND situacao = 'em_andamento' AND bloqueia_conta = 1`,
        [id, est],
      );
      const situacao = texto(x['situacao']);
      const preVoo = conferirFechamentoConta({
        situacao,
        itens: n(soma?.['itens']),
        pendenciasBloqueantes: bloqueantes,
        auditoriaBloqueante: n(aud?.['n']) > 0,
      });
      return {
        ...resumo,
        versao: versaoTexto(n(x['versao'])),
        remessa: 0,
        dataEmissao: null,
        dataFechamento: dataIso(x['fechada_em']),
        usuarioFechamento: texto(x['fechada_por']),
        indEmi: '',
        pacoteRotulo: n(x['pacotes']) > 0 ? 'Conta por pacote' : 'Conta aberta (item a item)',
        pacoteAConfirmar: false,
        tipoNota: null,
        guia: texto(x['numero_guia_operadora']) || texto(x['guia_numero']),
        senha: texto(x['senha_autorizacao']),
        registroAtendimento: codigoNumerico(x['atendimento_numero']),
        somaItens: n(soma?.['soma']),
        itens: n(soma?.['itens']),
        lotesTiss: n(lotes?.['n']),
        beneficiario: {
          matricula: texto(x['numero_carteira']),
          validadeCarteira: dataIso(x['validade_carteira']),
          cpfMascarado: mascararCpf(x['cpf']),
          plano: texto(x['plano_nome']),
        },
        guias: guias.map((g) => ({
          tipo: texto(g['tipo_guia']),
          principal: texto(g['numero_guia_operadora']) || texto(g['numero']),
          secundaria: '',
          senha: texto(g['senha']),
          sequencia: null,
        })),
        parciais: [],
        pendenciasLista: pend.map((p) => ({ ...p, origem: 'novo' as const })),
        etapas,
        avisos: [],
        preVooFechamento:
          preVoo && (situacao === 'aberta' || situacao === 'em_conferencia' || situacao === 'em_auditoria')
            ? { codigo: preVoo.codigo, mensagem: preVoo.mensagem }
            : null,
      };
    });
  }

  private async pendenciasDa(l: Leitor, est: number, conta: number) {
    const r = await l.consultar<Linha>(
      `SELECT pc.id, pc.tipo_pendencia_conta_id, t.descricao AS tipo_nome, pc.descricao, pc.bloqueia_fechamento,
              pc.situacao, pc.inicio_em, pc.resolucao, u.login
         FROM pendencia_conta pc JOIN tipo_pendencia_conta t ON t.id = pc.tipo_pendencia_conta_id
         LEFT JOIN usuario u ON u.id = pc.criado_por
        WHERE pc.conta_hospitalar_id = ? AND pc.estabelecimento_id = ? AND pc.excluido_em IS NULL ORDER BY pc.id`,
      [conta, est],
      { teto: 1_000 },
    );
    return r.map((p) => ({
      id: n(p['id']),
      tipo: n(p['tipo_pendencia_conta_id']),
      tipoNome: texto(p['tipo_nome']),
      descricao: texto(p['descricao']),
      bloqueante: verdadeiro(p['bloqueia_fechamento']),
      aberta: texto(p['situacao']) === 'aberta' || texto(p['situacao']) === 'em_tratamento',
      registradaPor: texto(p['login']),
      registradaEm: instante(p['inicio_em']) ?? '',
      resolucao: p['resolucao'] === null || p['resolucao'] === undefined ? null : texto(p['resolucao']),
    }));
  }

  private async etapasDa(l: Leitor, conta: number): Promise<ContaDetalhe['etapas']> {
    const r = await l.consultar<Linha>(
      `SELECT e.id, e.dados, e.motivo, e.ocorrido_em, u.login FROM conta_hospitalar_etapa e
         LEFT JOIN usuario u ON u.id = e.usuario_id WHERE e.conta_hospitalar_id = ? ORDER BY e.id`,
      [conta],
      { teto: 1_000 },
    );
    const etapas = ['conferencia', 'auditoria', 'conferencia-item', 'reabertura', 'fechamento'] as const;
    const situacoes = ['em-andamento', 'concluida', 'registrada'] as const;
    return r.flatMap((e) => {
      const d = json(e['dados']);
      const etapa = etapas.find((x) => x === d['etapa']);
      const situacao = situacoes.find((x) => x === d['situacao']) ?? 'registrada';
      if (!etapa) return [];
      return [
        {
          id: n(e['id']),
          etapa,
          situacao,
          usuario: texto(e['login']),
          inicio: instante(e['ocorrido_em']) ?? '',
          fim: null,
          observacao: texto(e['motivo']),
        },
      ];
    });
  }

  itens(
    c: ContextoFaturamento,
    conta: number,
    o: {
      pagina: number;
      porPagina: number;
      tipo?: number | null;
      naoConferidos?: boolean;
      regua?: 'competencia' | 'data-item';
      mes?: string | null;
    },
  ): Promise<ListaItens> {
    return this.ler(c, async (l, est) => {
      const onde = ['ci.conta_hospitalar_id = ?', 'ch.estabelecimento_id = ?', 'ci.excluido_em IS NULL'];
      const p: unknown[] = [conta, est];
      if (o.tipo === 1 || o.tipo === 2 || o.tipo === 3 || o.tipo === 4) {
        const t = tiposDoGrupo(o.tipo);
        onde.push(`i.tipo_item IN (${lista(t.length)})`);
        p.push(...t);
      }
      if (o.naoConferidos) onde.push("ci.situacao = 'lancado'");
      const regua = o.regua ?? 'competencia';
      if (regua === 'data-item' && o.mes && /^\d{4}-\d{2}$/.test(o.mes)) {
        onde.push('ci.realizado_em >= ? AND ci.realizado_em < DATE_ADD(?, INTERVAL 1 MONTH)');
        p.push(`${o.mes}-01`, `${o.mes}-01`);
      }
      const where = onde.join(' AND ');
      const total = await l.uma<Linha>(
        `SELECT COUNT(*) AS n FROM conta_hospitalar_item ci JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id
           JOIN item_faturavel i ON i.id = ci.item_faturavel_id WHERE ${where}`,
        p,
      );
      const linhas = await l.consultar<Linha>(
        `${SELECAO_ITEM} WHERE ${where} ORDER BY ci.realizado_em, ci.sequencia, ci.id LIMIT ? OFFSET ?`,
        [...p, o.porPagina, o.pagina * o.porPagina],
        { teto: o.porPagina },
      );
      const fuso = await this.fuso(l, est);
      const itens = linhas.map((x) => itemDaConta(x, fuso));
      return {
        itens,
        total: n(total?.['n']),
        pagina: o.pagina,
        porPagina: o.porPagina,
        somaPagina: r2(itens.reduce((s, i) => s + i.valor, 0)),
        regua,
      };
    });
  }

  explicar(c: ContextoFaturamento, item: number): Promise<ExplicacaoLida | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma<Linha>(
        `${SELECAO_ITEM} WHERE ci.id = ? AND ch.estabelecimento_id = ? AND ci.excluido_em IS NULL`,
        [item, est],
      );
      if (!x) return null;
      const unitario = n(x['valor_unitario']);
      const quantidade = n(x['quantidade']);
      const perc = n(x['percentual_cobranca']);
      const acrescimo = n(x['valor_acrescimo']);
      const desconto = n(x['valor_desconto']);
      const calculado = r2(valorDoItem(unitario, quantidade, perc) + acrescimo - desconto);
      const gravado = n(x['valor_total']);
      const diferenca = r2(gravado - calculado);
      const confere = Math.abs(diferenca) < 0.01;
      return {
        item,
        modelo: texto(x['tipo_valorizacao']),
        passos: [
          { ordem: 1, etapa: 'unitario', texto: 'Valor unitário do item', valor: unitario },
          { ordem: 2, etapa: 'quantidade', texto: `Quantidade ${quantidade}`, valor: quantidade },
          { ordem: 3, etapa: 'percentual', texto: `Percentual de cobrança ${perc}%`, valor: perc },
          { ordem: 4, etapa: 'acrescimo', texto: 'Acréscimo', valor: acrescimo },
          { ordem: 5, etapa: 'desconto', texto: 'Desconto', valor: desconto },
        ],
        calculado,
        gravado,
        confere,
        diferenca,
        conclusao: confere
          ? 'O valor gravado confere com unitário × quantidade × percentual, mais acréscimo e menos desconto.'
          : 'O valor gravado não confere com o cálculo do item.',
        causa: confere ? '' : 'O item foi alterado depois do cálculo ou tem componente fora do valor unitário.',
      };
    });
  }

  contaDaPendencia(c: ContextoFaturamento, id: number): Promise<number | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma<Linha>(
        'SELECT conta_hospitalar_id FROM pendencia_conta WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [id, est],
      );
      return x ? n(x['conta_hospitalar_id']) : null;
    });
  }

  convenioDaConta(c: ContextoFaturamento, conta: number): Promise<number | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma<Linha>(
        'SELECT fonte_pagadora_id FROM conta_hospitalar WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [conta, est],
      );
      return x ? n(x['fonte_pagadora_id']) : null;
    });
  }

  contaParticular(c: ContextoFaturamento, conta: number): Promise<boolean | null> {
    return this.ler(c, async (l, est) => {
      // fonte_pagadora é cadastro da rede inteira; a conta filtra o estabelecimento da sessão.
      const x = await l.uma<Linha>(
        `SELECT fp.tipo FROM conta_hospitalar ch JOIN fonte_pagadora fp ON fp.id = ch.fonte_pagadora_id
          WHERE ch.id = ? AND ch.estabelecimento_id = ? AND ch.excluido_em IS NULL`,
        [conta, est],
      );
      return x ? texto(x['tipo']) === 'particular' : null;
    });
  }

  convenioDoItem(c: ContextoFaturamento, item: number): Promise<number | null> {
    return this.ler(c, async (l, est) => {
      const x = await l.uma<Linha>(
        `SELECT ch.fonte_pagadora_id FROM conta_hospitalar_item ci JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id
          WHERE ci.id = ? AND ch.estabelecimento_id = ? AND ci.excluido_em IS NULL AND ch.excluido_em IS NULL`,
        [item, est],
      );
      return x ? n(x['fonte_pagadora_id']) : null;
    });
  }

  /** Os itens da conta com o procedimento SIGTAP equivalente (pela equivalência do catálogo, quando houver). */
  sigtap(c: ContextoFaturamento, conta: number): Promise<ItemSigtap[]> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar<Linha>(
        `SELECT ci.id, i.codigo, i.descricao FROM conta_hospitalar_item ci
           JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id JOIN item_faturavel i ON i.id = ci.item_faturavel_id
          WHERE ci.conta_hospitalar_id = ? AND ch.estabelecimento_id = ? AND ci.excluido_em IS NULL ORDER BY ci.id`,
        [conta, est],
        { teto: 5_000 },
      );
      return r.map((x) => ({
        item: n(x['id']),
        codigo: codigoNumerico(x['codigo']),
        nome: texto(x['descricao']),
        sigtap: null,
        sigtapCodigo: null,
      }));
    });
  }

  painelLancamentos(
    c: ContextoFaturamento,
    o: { ano: number; mes: number; desde: string; convenios: readonly number[] | null },
  ): Promise<PainelLancamentos> {
    return this.ler(c, async (l, est) => {
      if (o.convenios !== null && o.convenios.length === 0)
        return { porOrigem: [], tardios: [], totalTardios: 0, pendentesDecisao: 0 };
      const p: unknown[] = [est, `${o.ano}-${String(o.mes).padStart(2, '0')}-01`];
      let conv = '';
      if (o.convenios !== null) {
        conv = ` AND ch.fonte_pagadora_id IN (${lista(o.convenios.length)})`;
        p.push(...o.convenios);
      }
      const r = await l.consultar<Linha>(
        `SELECT COALESCE(ol.codigo, 'manual') AS veio, COALESCE(ol.descricao, 'Lançamento manual') AS rotulo,
                COUNT(*) AS itens, COALESCE(SUM(ci.valor_total), 0) AS valor
           FROM conta_hospitalar_item ci JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id
           LEFT JOIN origem_lancamento ol ON ol.id = ci.origem_lancamento_id
          WHERE ch.estabelecimento_id = ? AND ch.competencia = ? AND ch.excluido_em IS NULL
            AND ci.excluido_em IS NULL${conv}
          GROUP BY veio, rotulo ORDER BY veio`,
        p,
        { teto: 500 },
      );
      return {
        porOrigem: r.map((x) => ({
          veio: texto(x['veio']),
          rotulo: texto(x['rotulo']),
          aConfirmar: false,
          itens: n(x['itens']),
          valor: n(x['valor']),
        })),
        tardios: [],
        totalTardios: 0,
        pendentesDecisao: 0,
      };
    });
  }

  /** A fila do lançamento após o fechamento aguarda o modelo (pedido de DDL): vazia. */
  async tardios(): Promise<{ itens: LancamentoTardio[]; total: number }> {
    return { itens: [], total: 0 };
  }

  auditoria(c: ContextoFaturamento, conta: number): Promise<AuditoriaConta> {
    return this.ler(c, async (l, est) => {
      const diferencas = await l.consultar<Linha>(
        `SELECT i.codigo, i.descricao, ai.valor_original, ai.valor_aceito, ai.quantidade_original, ai.quantidade_aceita
           FROM auditoria_conta_item ai JOIN auditoria_conta ac ON ac.id = ai.auditoria_conta_id
           JOIN conta_hospitalar_item ci ON ci.id = ai.conta_hospitalar_item_id
           JOIN item_faturavel i ON i.id = ci.item_faturavel_id
          WHERE ac.conta_hospitalar_id = ? AND ac.estabelecimento_id = ? AND ac.excluido_em IS NULL
            AND ai.excluido_em IS NULL ORDER BY ai.id`,
        [conta, est],
        { teto: 5_000 },
      );
      const versoes = await l.consultar<Linha>(
        `SELECT v.id, v.dados, v.valor_total_conta, v.ocorrido_em, u.login
           FROM auditoria_conta_versao v JOIN auditoria_conta ac ON ac.id = v.auditoria_conta_id
           LEFT JOIN usuario u ON u.id = v.usuario_id
          WHERE v.conta_hospitalar_id = ? AND ac.estabelecimento_id = ? ORDER BY v.id`,
        [conta, est],
        { teto: 1_000 },
      );
      const pend = await this.pendenciasDa(l, est, conta);
      return {
        conta,
        retratoLegado: null,
        diferencas: diferencas.map((d) => ({
          codigo: codigoNumerico(d['codigo']),
          nome: texto(d['descricao']),
          antes: n(d['valor_original']),
          depois: n(d['valor_aceito']),
          quantidadeAntes: n(d['quantidade_original']),
          quantidadeDepois: n(d['quantidade_aceita']),
        })),
        versoes: pareceresDasVersoes(versoes),
        irregularidades: pend.map((p) => ({
          id: p.id,
          tipo: p.tipo,
          nome: p.tipoNome,
          descricao: p.descricao,
          aberta: p.aberta,
          registradaEm: p.registradaEm,
        })),
      };
    });
  }

  /** Tipos de pendência ativos (cadastro da rede inteira) e os módulos em que valem. */
  tiposPendencia(c: ContextoFaturamento): Promise<{ id: number; nome: string; modulos: number[] }[]> {
    return this.ler(c, async (l) => {
      const r = await l.consultar<Linha>(
        `SELECT t.id, t.descricao, GROUP_CONCAT(m.modulo_sistema_id ORDER BY m.modulo_sistema_id) AS modulos
           FROM tipo_pendencia_conta t
           LEFT JOIN tipo_pendencia_conta_modulo m ON m.tipo_pendencia_conta_id = t.id AND m.excluido_em IS NULL
          WHERE t.ativo = 1 GROUP BY t.id, t.descricao ORDER BY t.descricao`,
        [],
        { teto: 2_000 },
      );
      return r.map((x) => ({
        id: n(x['id']),
        nome: texto(x['descricao']),
        modulos: texto(x['modulos'])
          .split(',')
          .filter(Boolean)
          .map(Number),
      }));
    });
  }

  /** O apoio da tela de pacotes: o controle sim/não; o orçamento padrão aguarda o modelo (pedido). */
  async apoioPacotes() {
    return {
      controles: [
        { id: 1, nome: 'Sim' },
        { id: 2, nome: 'Não' },
      ],
      orcamentosPadrao: [],
      orcamentoAntigo: 0,
    };
  }

  /** As regras de faturabilidade por convênio aguardam o modelo (pedido de DDL): vazia. */
  async regras(): Promise<RegraLida[]> {
    return [];
  }

  /** Pacotes do estabelecimento (ou da rede inteira) com o valor por fonte pagadora. */
  pacotes(c: ContextoFaturamento): Promise<PacoteLido[]> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar<Linha>(
        `SELECT pc.id AS contrato_id, p.id, pc.fonte_pagadora_id, p.codigo, p.descricao,
                COALESCE(pc.valor, p.valor, 0) AS valor, pc.vigencia_inicio, pc.vigencia_fim, p.situacao
           FROM pacote_contrato pc JOIN pacote p ON p.id = pc.pacote_id
          WHERE (p.estabelecimento_id = ? OR p.estabelecimento_id IS NULL)
            AND p.excluido_em IS NULL AND pc.excluido_em IS NULL
          ORDER BY p.descricao, pc.id`,
        [est],
        { teto: 5_000 },
      );
      const ids = [...new Set(r.map((x) => n(x['id'])))];
      const itens = ids.length
        ? await l.consultar<Linha>(
            `SELECT pi.pacote_id, i.codigo, pi.quantidade_limite FROM pacote_item_incluso pi
               JOIN item_faturavel i ON i.id = pi.item_faturavel_id
              WHERE pi.pacote_id IN (${lista(ids.length)}) AND pi.excluido_em IS NULL ORDER BY pi.sequencia`,
            ids,
            { teto: 50_000 },
          )
        : [];
      return r.map((x) => ({
        id: n(x['contrato_id']),
        convenio: n(x['fonte_pagadora_id']),
        codigo: codigoNumerico(x['codigo'], n(x['id'])),
        nome: texto(x['descricao']),
        valor: n(x['valor']),
        inicio: dataIso(x['vigencia_inicio']) ?? '',
        fim: dataIso(x['vigencia_fim']),
        ativo: texto(x['situacao']) === 'ativo',
        itens: itens
          .filter((i) => n(i['pacote_id']) === n(x['id']))
          .map((i) => ({ codigo: codigoNumerico(i['codigo']), quantidade: n(i['quantidade_limite']) || 1 })),
      }));
    });
  }

  /** A nota de sala é do centro cirúrgico (pedido de leitura ao lote do centro cirúrgico): nula. */
  async notaSala(): Promise<NotaSala | null> {
    return null;
  }

  async cirurgias(): Promise<{ id: number; data: string | null; sala: number; conta: number | null }[]> {
    return [];
  }

  orcamentos(c: ContextoFaturamento, hoje: string): Promise<OrcamentoParticular[]> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar<Linha>(
        `SELECT o.id, o.situacao, o.validade_ate, o.valor_total, o.valor_desconto, o.criado_em, o.nome_interessado,
                p.numero_prontuario, COALESCE(NULLIF(p.nome_social, ''), pf.nome) AS paciente_nome, u.login
           FROM orcamento_particular o
           LEFT JOIN paciente p ON p.id = o.paciente_id
           LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN usuario u ON u.id = o.criado_por
          WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL ORDER BY o.id DESC`,
        [est],
        { teto: 2_000 },
      );
      const ids = r.map((x) => n(x['id']));
      const itens = ids.length
        ? await l.consultar<Linha>(
            `SELECT oi.orcamento_particular_id, COALESCE(i.descricao, g.descricao, oi.tipo_item) AS descricao,
                    oi.quantidade, oi.valor_unitario
               FROM orcamento_particular_item oi
               LEFT JOIN item_faturavel i ON i.id = oi.item_faturavel_id
               LEFT JOIN grupo_faturamento g ON g.id = oi.grupo_faturamento_id
              WHERE oi.orcamento_particular_id IN (${lista(ids.length)}) AND oi.excluido_em IS NULL
              ORDER BY oi.sequencia`,
            ids,
            { teto: 50_000 },
          )
        : [];
      return r.map((x) => {
        const sit = texto(x['situacao']);
        const validade = dataIso(x['validade_ate']) ?? '';
        const situacao: OrcamentoParticular['situacao'] =
          sit === 'realizado'
            ? 'pago'
            : sit === 'cancelado' || sit === 'recusado'
              ? 'cancelado'
              : sit === 'expirado' || validade < hoje
                ? 'vencido'
                : 'aberto';
        return {
          id: n(x['id']),
          prontuario: n(x['numero_prontuario']),
          nome: texto(x['paciente_nome']) || texto(x['nome_interessado']),
          total: n(x['valor_total']),
          desconto: n(x['valor_desconto']),
          validoAte: validade,
          urgencia: false,
          situacao,
          pago: 0,
          itens: itens
            .filter((i) => n(i['orcamento_particular_id']) === n(x['id']))
            .map((i) => ({
              descricao: texto(i['descricao']),
              quantidade: n(i['quantidade']),
              unitario: n(i['valor_unitario']),
            })),
          criadoPor: texto(x['login']),
          criadoEm: instante(x['criado_em']) ?? '',
        };
      });
    });
  }

  caixas(c: ContextoFaturamento, operador: string | null): Promise<CaixaLido[]> {
    return this.ler(c, async (l, est) => {
      const p: unknown[] = [est];
      let filtro = '';
      if (operador) {
        filtro = ' AND u.login = ?';
        p.push(operador);
      }
      const r = await l.consultar<Linha>(
        `SELECT s.id, u.login, s.aberta_em, s.fechada_em, s.fundo_troco, s.total_dinheiro, s.total_cartao_debito,
                s.total_cartao_credito, s.total_pix, s.total_cheque, s.total_outras_formas, s.saldo_final_informado,
                s.diferenca
           FROM sessao_caixa s JOIN usuario u ON u.id = s.operador_usuario_id
          WHERE s.estabelecimento_id = ? AND s.excluido_em IS NULL${filtro} ORDER BY s.id DESC`,
        p,
        { teto: 1_000 },
      );
      return r.map((x) => {
        // Chaves pelas formas da tela (as mesmas da memória); cheque e as demais espécies somam em 'outras'.
        const totais: Record<string, number> = {
          dinheiro: n(x['total_dinheiro']),
          'cartao-debito': n(x['total_cartao_debito']),
          'cartao-credito': n(x['total_cartao_credito']),
          pix: n(x['total_pix']),
          outras: r2(n(x['total_cheque']) + n(x['total_outras_formas'])),
        };
        const porForma: Record<string, number> = {};
        for (const [k, v] of Object.entries(totais)) if (v !== 0) porForma[k] = v;
        return {
          id: n(x['id']),
          operador: texto(x['login']),
          abertoEm: instante(x['aberta_em']) ?? '',
          fechadoEm: instante(x['fechada_em']),
          saldoInicial: n(x['fundo_troco']),
          recebido: r2(Object.values(porForma).reduce((s, v) => s + v, 0)),
          contado: nn(x['saldo_final_informado']),
          diferenca: nn(x['diferenca']),
          porForma,
        };
      });
    });
  }

  pagamentos(c: ContextoFaturamento, f: FiltroPagamentos): Promise<PagamentoLido[]> {
    return this.ler(c, async (l, est) => {
      const porPagina = Math.min(300, Math.max(1, f.porPagina ?? 300));
      const pagina = Math.max(0, f.pagina ?? 0);
      const onde = ["m.estabelecimento_id = ?", "m.natureza = 'entrada'", 'm.excluido_em IS NULL'];
      const p: unknown[] = [est];
      if (f.caixa) {
        onde.push('m.sessao_caixa_id = ?');
        p.push(f.caixa);
      }
      if (f.forma) {
        // Lista branca forma da tela → espécie do caixa; forma desconhecida não acha nada.
        const especie = (ESPECIE_DA_FORMA as Readonly<Record<string, string>>)[f.forma];
        if (!especie) return [];
        onde.push('m.especie = ?');
        p.push(especie);
      }
      if (f.situacao === 'estornado') onde.push("m.situacao <> 'ativo'");
      else if (f.situacao === 'aprovado') onde.push("m.situacao = 'ativo'");
      else if (f.situacao) return [];
      if (f.desde) {
        onde.push('m.ocorrido_em >= ?');
        p.push(f.desde);
      }
      if (f.ate) {
        onde.push('m.ocorrido_em < DATE_ADD(?, INTERVAL 1 DAY)');
        p.push(f.ate);
      }
      const r = await l.consultar<Linha>(
        `SELECT m.id, m.sessao_caixa_id, m.especie, m.valor, m.situacao, m.numero_documento, m.ocorrido_em,
                (SELECT MIN(rc.id) FROM recibo rc WHERE rc.recebimento_id = m.recebimento_id
                    AND m.recebimento_id IS NOT NULL AND rc.excluido_em IS NULL) AS recibo
           FROM movimento_caixa m WHERE ${onde.join(' AND ')} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
        [...p, porPagina, pagina * porPagina],
        { teto: porPagina },
      );
      return r.map((x) => ({
        id: n(x['id']),
        caixa: n(x['sessao_caixa_id']),
        orcamento: null,
        conta: null,
        forma: formaDaEspecie(texto(x['especie'])),
        valor: n(x['valor']),
        parcelas: 1,
        situacao: texto(x['situacao']) === 'ativo' ? ('aprovado' as const) : ('estornado' as const),
        comprovante: texto(x['numero_documento']),
        conector: 'manual',
        recibo: nn(x['recibo']),
        em: instante(x['ocorrido_em']) ?? '',
      }));
    });
  }

  /** Recibos emitidos no estabelecimento (o modelo próprio não tem recibos "antigos" à parte). */
  recibos(c: ContextoFaturamento, antigos: boolean): Promise<ReciboLido[]> {
    void antigos;
    return this.ler(c, async (l, est) => {
      const r = await l.consultar<Linha>(
        `SELECT rc.id, rc.numero, rc.pagador_nome, rc.referente, rc.valor, rc.emitido_em, u.login
           FROM recibo rc LEFT JOIN usuario u ON u.id = rc.criado_por
          WHERE rc.estabelecimento_id = ? AND rc.excluido_em IS NULL ORDER BY rc.id DESC`,
        [est],
        { teto: 2_000 },
      );
      return r.map((x) => ({
        id: n(x['id']),
        numero: codigoNumerico(x['numero'], n(x['id'])),
        pagamento: null,
        pagador: texto(x['pagador_nome']),
        referente: texto(x['referente']),
        valor: n(x['valor']),
        em: instante(x['emitido_em']) ?? '',
        emitidoPor: texto(x['login']),
        origem: 'novo' as const,
      }));
    });
  }

  worklist(
    c: ContextoFaturamento,
    o: { convenios: readonly number[] | null; hoje: string; prazoDias: number; desde: string },
  ): Promise<WorklistFaturamento> {
    return this.ler(c, async (l, est) => {
      const vazio = { porSituacao: [], porPrazo: [], comPendencia: 0, tardiosPendentes: 0, emAuditoria: 0 };
      if (o.convenios !== null && o.convenios.length === 0) return vazio;
      const p: unknown[] = [est];
      let conv = '';
      if (o.convenios !== null) {
        conv = ` AND ch.fonte_pagadora_id IN (${lista(o.convenios.length)})`;
        p.push(...o.convenios);
      }
      const base = `FROM conta_hospitalar ch WHERE ch.estabelecimento_id = ? AND ch.excluido_em IS NULL
        AND ch.situacao IN ('aberta','em_conferencia','em_auditoria','fechada')${conv}`;
      const grupos = await l.consultar<Linha>(
        `SELECT ch.situacao, EXISTS (SELECT 1 FROM lote_tiss_conta lt WHERE lt.conta_hospitalar_id = ch.id
                AND lt.excluido_em IS NULL) AS em_lote, COUNT(*) AS contas, COALESCE(SUM(ch.valor_total), 0) AS valor
           ${base} GROUP BY ch.situacao, em_lote`,
        p,
        { teto: 100 },
      );
      const por = new Map<string, { rotulo: string; contas: number; valor: number }>();
      for (const g of grupos) {
        const s = situacaoNaTela(texto(g['situacao']), verdadeiro(g['em_lote']));
        const v = por.get(s) ?? { rotulo: ROTULO_SITUACAO[s], contas: 0, valor: 0 };
        v.contas += n(g['contas']);
        v.valor = r2(v.valor + n(g['valor']));
        por.set(s, v);
      }
      const prazo = await l.uma<Linha>(
        `SELECT COUNT(*) AS n FROM conta_hospitalar ch JOIN atendimento a ON a.id = ch.atendimento_id
          WHERE ch.estabelecimento_id = ? AND ch.excluido_em IS NULL
            AND ch.situacao IN ('aberta','em_conferencia','em_auditoria')${conv}
            AND (a.alta_medica_em IS NULL OR a.alta_medica_em >= DATE_SUB(?, INTERVAL ? DAY))`,
        [...p, o.hoje, o.prazoDias],
      );
      const pend = await l.uma<Linha>(
        `SELECT COUNT(DISTINCT pc.conta_hospitalar_id) AS n FROM pendencia_conta pc
           JOIN conta_hospitalar ch ON ch.id = pc.conta_hospitalar_id
          WHERE pc.estabelecimento_id = ? AND pc.excluido_em IS NULL AND pc.situacao IN ${PENDENCIA_ABERTA}${conv}`,
        p,
      );
      return {
        porSituacao: [...por.entries()].map(([situacao, v]) => ({ situacao, ...v })),
        porPrazo: [{ faixa: `Até ${o.prazoDias} dias da alta`, contas: n(prazo?.['n']) }],
        comPendencia: n(pend?.['n']),
        tardiosPendentes: 0,
        emAuditoria: por.get('em-auditoria')?.contas ?? 0,
      };
    });
  }

  /** Simulador: o preço vigente do item na tabela de preço da fonte pagadora, na data. */
  simular(
    c: ContextoFaturamento,
    s: { convenio: number; tipoConta: 'E' | 'I'; tipo: 1 | 2 | 3 | 4; codigo: number; quantidade: number; data: string },
  ) {
    return this.ler(c, async (l, est) => {
      const tipos = tiposDoGrupo(s.tipo);
      const item = await l.uma<Linha>(
        `SELECT id, descricao FROM item_faturavel WHERE codigo = ? AND tipo_item IN (${lista(tipos.length)})
            AND excluido_em IS NULL AND situacao = 'ativo'`,
        [String(s.codigo), ...tipos],
      );
      if (!item) return { encontrado: false, nome: '', preco: null, vigencia: null };
      const tabelas = await tabelasDePreco(l, est, s.convenio, null);
      const v = await precoVigente(l, tabelas, n(item['id']), s.data);
      if (!v) return { encontrado: true, nome: texto(item['descricao']), preco: null, vigencia: null };
      return {
        encontrado: true,
        nome: texto(item['descricao']),
        preco: {
          modelo: v.modelo,
          unitario: v.unitario,
          ch: v.honorario,
          cop: v.custoOperacional,
          filme: v.filme,
          valor: valorDoItem(v.unitario, s.quantidade),
        },
        vigencia: v.vigencia,
      };
    });
  }
}

/** O gravador das gravações diretas sobre a transação da operação (estabelecimento e usuário do contexto). */
function gravadorSobre(tx: TxOperacao, est: number): GravadorSghFaturamento {
  const usuario = tx.contexto.usuario;
  const exigirUsuario = (): number => {
    if (usuario === null) throw recusa('sem-usuario', 'A gravação exige o usuário da sessão.');
    return usuario;
  };
  const agora = () => new Date();
  const contaTravada = async (id: number) => {
    const [x] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao, situacao, valor_total FROM conta_hospitalar
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [id, est],
      { teto: 1 },
    );
    if (!x) throw new ErroOperacao(404, 'registro-inexistente', 'Conta inexistente', 'A conta não existe.');
    return { id: n(x['id']), versao: n(x['versao']), situacao: texto(x['situacao']), total: n(x['valor_total']) };
  };
  const etapa = (
    conta: { id: number; situacao: string; total: number },
    nova: string,
    dados: { etapa: string; situacao: string },
    motivo: string | null,
    pendencia: number | null = null,
  ) =>
    tx.incluir('conta_hospitalar_etapa', {
      conta_hospitalar_id: conta.id,
      situacao_anterior: conta.situacao,
      situacao_nova: nova,
      responsavel_usuario_id: usuario,
      pendencia_conta_id: pendencia,
      motivo: motivo || null,
      valor_total_conta: conta.total,
      operacao: 'inclusao',
      dados: JSON.stringify(dados),
      ocorrido_em: agora(),
      usuario_id: usuario,
    });
  const naoLiberada = (titulo: string, detalhe: string) => Promise.reject(modeloPendente(titulo, detalhe));
  return {
    async registrarPendencia(p) {
      const conta = await contaTravada(p.conta);
      const naConta = conferirRegistroPendencia(conta.situacao);
      if (naConta) throw recusa(naConta.codigo, naConta.mensagem, naConta.campos ? { campos: naConta.campos } : {});
      // Tipo de pendência: cadastro da rede inteira.
      const tipo = await tx.uma<Linha>('SELECT id, controle FROM tipo_pendencia_conta WHERE id = ? AND ativo = 1', [
        p.tipo,
      ]);
      if (!tipo) throw recusa('tipo-pendencia-inexistente', 'O tipo de pendência não existe ou está inativo.', { campos: ['tipo'] });
      return tx.incluir('pendencia_conta', {
        estabelecimento_id: est,
        conta_hospitalar_id: conta.id,
        tipo_pendencia_conta_id: p.tipo,
        descricao: p.descricao,
        bloqueia_fechamento: pendenciaBloqueiaFechamento(texto(tipo['controle']), p.bloqueante) ? 1 : 0,
        inicio_em: agora(),
        // Quem resolve ainda não é conhecido: quem registra fica na trilha (criado_por).
        responsavel_usuario_id: null,
        situacao: 'aberta',
      });
    },
    async resolverPendencia(r) {
      const [x] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao, situacao, conta_hospitalar_id FROM pendencia_conta
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [r.id, est],
        { teto: 1 },
      );
      if (!x) throw new ErroOperacao(404, 'registro-inexistente', 'Pendência inexistente', 'A pendência não existe.');
      const sit = texto(x['situacao']);
      if (sit !== 'aberta' && sit !== 'em_tratamento')
        throw recusa('pendencia-encerrada', 'A pendência já foi resolvida ou cancelada.');
      await tx.alterar('pendencia_conta', r.id, n(x['versao']), {
        situacao: 'resolvida',
        resolvido_em: agora(),
        resolvido_por_usuario_id: exigirUsuario(),
        resolucao: r.resolucao,
      });
      return { conta: n(x['conta_hospitalar_id']) };
    },
    async registrarEtapa(x) {
      const conta = await contaTravada(x.conta);
      const t = transicaoDaEtapa(conta.situacao, x.etapa, x.acao);
      if (!('nova' in t)) throw recusa(t.codigo, t.mensagem, t.campos ? { campos: t.campos } : {});
      await tx.alterar('conta_hospitalar', conta.id, conta.versao, { situacao: t.nova });
      return etapa(
        conta,
        t.nova,
        { etapa: x.etapa, situacao: x.acao === 'iniciar' ? 'em-andamento' : 'concluida' },
        x.observacao,
      );
    },
    decidirLancamentoTardio: () =>
      naoLiberada(
        'Fila do lançamento após o fechamento indisponível',
        'A decisão sobre o lançamento depois do fechamento aguarda a tabela no modelo do banco.',
      ),
    editarRegra: () =>
      naoLiberada(
        'Regras de faturabilidade indisponíveis',
        'As regras de faturabilidade por convênio aguardam a tabela no modelo do banco.',
      ),
    editarPacote: () =>
      naoLiberada(
        'Edição de pacote indisponível nesta tela',
        'O pacote e o valor por fonte pagadora são cadastrados nos contratos (pacote e pacote_contrato).',
      ),
    async registrarVersaoAuditoria(v) {
      const auditor = exigirUsuario();
      const conta = await contaTravada(v.conta);
      const itens = await tx.uma<Linha>(
        `SELECT COUNT(*) AS n FROM conta_hospitalar_item WHERE conta_hospitalar_id = ? AND excluido_em IS NULL
            AND situacao <> 'estornado'`,
        [conta.id],
      );
      const [aud] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id FROM auditoria_conta WHERE conta_hospitalar_id = ? AND estabelecimento_id = ?
            AND situacao = 'em_andamento' AND excluido_em IS NULL ORDER BY id DESC`,
        [conta.id, est],
        { teto: 1 },
      );
      let auditoria = aud ? n(aud['id']) : 0;
      const retrato = { itens: n(itens?.['n']), total: conta.total };
      if (!aud) {
        const tipo = await tx.uma<Linha>("SELECT id FROM tipo_auditoria WHERE ativo = 1 ORDER BY externa, id", []);
        if (!tipo)
          throw recusa(
            'tipo-auditoria-inexistente',
            'Cadastre um tipo de auditoria ativo antes de registrar o parecer.',
          );
        auditoria = await tx.incluir('auditoria_conta', {
          estabelecimento_id: est,
          conta_hospitalar_id: conta.id,
          tipo_auditoria_id: n(tipo['id']),
          modalidade: 'interna',
          auditor_usuario_id: auditor,
          solicitante_usuario_id: auditor,
          iniciada_em: agora(),
          situacao: 'em_andamento',
          valor_original: conta.total,
        });
      }
      // Um retrato 'antes' (ao abrir a auditoria) e um 'depois' (o mais recente) por auditoria, pela unicidade
      // (auditoria, momento); cada parecer entra na lista do 'depois', que avança a versão a cada parecer.
      const momentos = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, momento, versao, dados FROM auditoria_conta_versao WHERE auditoria_conta_id = ?',
        [auditoria],
        { teto: 2 },
      );
      if (!momentos.some((m) => texto(m['momento']) === 'antes'))
        await tx.incluir('auditoria_conta_versao', {
          auditoria_conta_id: auditoria,
          conta_hospitalar_id: conta.id,
          momento: 'antes',
          valor_total_conta: conta.total,
          operacao: 'inclusao',
          dados: JSON.stringify({ retrato }),
          ocorrido_em: agora(),
          usuario_id: auditor,
        });
      const login = await tx.uma<Linha>('SELECT login FROM usuario WHERE id = ?', [auditor]);
      const parecer = {
        papel: v.papel,
        parecer: v.parecer,
        usuario: auditor,
        login: texto(login?.['login']),
        em: agora().toISOString(),
        total: conta.total,
        itens: retrato.itens,
      };
      const depois = momentos.find((m) => texto(m['momento']) === 'depois');
      if (!depois)
        return tx.incluir('auditoria_conta_versao', {
          auditoria_conta_id: auditoria,
          conta_hospitalar_id: conta.id,
          momento: 'depois',
          valor_total_conta: conta.total,
          operacao: 'inclusao',
          dados: JSON.stringify({ retrato, pareceres: [parecer] }),
          ocorrido_em: agora(),
          usuario_id: auditor,
        });
      const anteriores = json(depois['dados'])['pareceres'];
      await tx.alterar('auditoria_conta_versao', n(depois['id']), n(depois['versao']), {
        valor_total_conta: conta.total,
        operacao: 'alteracao',
        dados: JSON.stringify({ retrato, pareceres: [...(Array.isArray(anteriores) ? anteriores : []), parecer] }),
        ocorrido_em: agora(),
        usuario_id: auditor,
      });
      return n(depois['id']);
    },
    registrarOrcamento: () =>
      naoLiberada(
        'Orçamento particular indisponível',
        'O item livre do orçamento (descrição digitada) e a urgência aguardam colunas no modelo do banco.',
      ),
    async abrirCaixa(c) {
      const operador = exigirUsuario();
      const aberta = await tx.uma<Linha>(
        `SELECT id FROM sessao_caixa WHERE estabelecimento_id = ? AND operador_usuario_id = ?
            AND situacao IN ('aberta','reaberta') AND excluido_em IS NULL`,
        [est, operador],
      );
      if (aberta) throw recusa('caixa-ja-aberto', 'Você já tem um caixa aberto: feche-o antes de abrir outro.');
      const caixa = await tx.uma<Linha>(
        `SELECT cx.id FROM operador_caixa oc JOIN caixa cx ON cx.id = oc.caixa_id
          WHERE oc.usuario_id = ? AND cx.estabelecimento_id = ? AND cx.ativo = 1 AND cx.permite_recebimento = 1
            AND oc.excluido_em IS NULL AND cx.excluido_em IS NULL AND oc.data_ativacao <= CURRENT_DATE
            AND (oc.data_desativacao IS NULL OR oc.data_desativacao >= CURRENT_DATE)
          ORDER BY cx.id`,
        [operador, est],
      );
      if (!caixa)
        throw recusa('sem-caixa', 'Você não é operador de nenhum caixa de recebimento ativo neste estabelecimento.');
      const numero = await tx.proximoNumero('sessao_caixa');
      return tx.incluir('sessao_caixa', {
        estabelecimento_id: est,
        caixa_id: n(caixa['id']),
        numero: numero.valor,
        operador_usuario_id: operador,
        situacao: 'aberta',
        aberta_em: agora(),
        fundo_troco: c.saldoInicial,
      });
    },
    async fecharCaixa(c) {
      const [s] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, versao, situacao, operador_usuario_id, fundo_troco, total_dinheiro, total_sangria, total_suprimento
           FROM sessao_caixa WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [c.id, est],
        { teto: 1 },
      );
      if (!s) throw new ErroOperacao(404, 'registro-inexistente', 'Caixa inexistente', 'O caixa não existe.');
      const sit = texto(s['situacao']);
      if (sit !== 'aberta' && sit !== 'reaberta') throw recusa('caixa-fechado', 'O caixa já está fechado.');
      if (n(s['operador_usuario_id']) !== exigirUsuario())
        throw recusa('caixa-de-outro-operador', 'Só o operador do caixa o fecha.');
      // O esperado em dinheiro na gaveta: fundo de troco + recebido em dinheiro + suprimento − sangria.
      const esperado = r2(
        n(s['fundo_troco']) + n(s['total_dinheiro']) + n(s['total_suprimento']) - n(s['total_sangria']),
      );
      await tx.alterar('sessao_caixa', c.id, n(s['versao']), {
        situacao: 'fechada',
        fechada_em: agora(),
        fechamento_usuario_id: usuario,
        saldo_final_calculado: esperado,
        saldo_final_informado: c.contado,
        diferenca: r2(c.contado - esperado),
      });
      return { esperado };
    },
    receberParticular: () =>
      naoLiberada(
        'Recebimento particular indisponível',
        'O recebimento do orçamento particular pelo caixa aguarda o vínculo do orçamento no modelo do banco.',
      ),
    emitirRecibo: () =>
      naoLiberada(
        'Recibo indisponível',
        'O recibo do recebimento particular depende do recebimento, que aguarda o modelo do banco.',
      ),
  };
}
