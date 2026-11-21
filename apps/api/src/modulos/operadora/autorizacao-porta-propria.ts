// Porta PRÓPRIA da autorização prévia da operadora (F2.2, lote 02-09) sobre o MariaDB do cliente, pelo @sgh/nucleo:
//   - pedido = pedido_autorizacao_plano (beneficiário, solicitante, executante, caráter TISS, prazo regulatório,
//     situação, senha), com os itens em pedido_autorizacao_plano_item (item faturável pelo código) e cada mudança em
//     pedido_autorizacao_plano_historico (registro, complemento, junta, decisão, cancelamento, troca de responsável);
//   - junta = junta_divergencia_tecnica (assistente, desempatador, parecer);
//   - auditor = auditor_plano (profissional do cadastro, usuário, categoria e vigência);
//   - domínios pelo id do registro (tipo_guia_plano, origem_guia_plano, motivo_decisao_autorizacao,
//     situacao_guia_plano): o código que a tela devolve é o id, sem código do sistema de origem;
//   - beneficiário (elegibilidade) e prestadores vêm das portas da F1 e da rede.
// Números de negócio: `protocolo_autorizacao` e `senha_autorizacao` (por estabelecimento) e `junta` (número da junta).
// Dado da rede inteira: os domínios da autorização. Pedidos, juntas e auditores filtram pelo estabelecimento da
// sessão (o auditor, pela operadora que atua nele).
// Melhoria: a autorizada ou parcial exige a senha (CHECK); o item negado exige o motivo (CHECK); o cancelamento exige o
// motivo do cadastro (CHECK); o prazo não vem antes da solicitação (CHECK); cada mudança de situação fica no histórico
// com quem e quando (mede o prazo regulatório).
// Melhoria: o encerramento do auditor com pedidos em análise redistribui na mesma transação, com a troca no histórico.
// Os procedimentos TUSS e o CID-10 vêm do catálogo oficial (termo_terminologia); sem a carga, nenhum termo.
// Pendente (pedido ao orquestrador): anexos da resposta do prestador pelo portal
// (armazenamento de arquivos) e alteração do auditor (o nome e o conselho são do cadastro do profissional) respondem
// 501 `modelo-pendente`.
import { type Leitor, type Linha, recusa, type TxOperacao } from '@sgh/nucleo';
import {
  BasePortaOperadoraPropria,
  bool,
  data,
  exigirOperadora,
  inexistente,
  instante,
  type NucleoOperadora,
  num,
  numOuNulo,
  pendente,
  txt,
  txtOuNulo,
  versaoDe,
} from './apoio-porta-propria.js';
import { recusaAuditorComPedidos } from './aplicacao/regras-portas.js';
import type { ContextoAutorizacao, GravadorAutorizacao, PortaAutorizacaoOperadora } from './autorizacao-porta.js';
import {
  type DadosAnexoComplemento,
  type DadosAuditor,
  type DadosAutorizacao,
  type DadosAutorizacaoDaSenha,
  type DadosAutorizacaoResumo,
  type DadosElegibilidadeBeneficiario,
  type DadosEventoAutorizacao,
  type DadosItemAutorizacao,
  type DadosItemDominioAutorizacao,
  type DadosPrestadorParaAutorizacao,
  type DadosProcedimentoTuss,
  type DominioAutorizacao,
  type EntradaRegistroAutorizacao,
  type FiltroAutorizacoesPorta,
  LIMITE_BUSCA_TUSS,
  LIMITE_PAGINA_AUTORIZACOES,
  type SituacaoAutorizacaoPorta,
  type TotaisAutorizacoes,
} from './dados-portas.js';
import type { PortaOperadora } from './porta.js';
import type { PortaRedeOperadora, Prestador } from './rede-porta.js';

export const TABELAS_AUTORIZACAO = [
  'pedido_autorizacao_plano',
  'pedido_autorizacao_plano_item',
  'pedido_autorizacao_plano_historico',
  'junta_divergencia_tecnica',
  'auditor_plano',
] as const;

const SITUACAO_DO_BANCO = (s: string): SituacaoAutorizacaoPorta => s.replace('_', '-') as SituacaoAutorizacaoPorta;
const SITUACAO = (s: SituacaoAutorizacaoPorta): string => s.replace('-', '_');
/** Tipo de internação na tela (código TISS) ↔ no banco. */
const TIPO_INTERNACAO: Readonly<Record<number, string>> = {
  1: 'clinica',
  2: 'cirurgica',
  3: 'obstetrica',
  4: 'pediatrica',
  5: 'psiquiatrica',
};
const TIPO_INTERNACAO_DO_BANCO: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(TIPO_INTERNACAO).map(([k, v]) => [v, Number(k)]),
);
/** Caráter na tela (eletivo ou urgência) ↔ código TISS do caráter do atendimento. */
const CARATER_TISS = { E: '1', U: '2' } as const;

const DOMINIOS: Readonly<Record<DominioAutorizacao, string>> = {
  tipoGuia: 'tipo_guia_plano',
  origem: 'origem_guia_plano',
  critica: 'motivo_decisao_autorizacao',
  situacaoGuia: 'situacao_guia_plano',
};

const SELECT_PEDIDO = `
  SELECT pa.*, pf.nome AS beneficiario_nome, pf.data_nascimento AS beneficiario_nascimento,
         sx.codigo AS beneficiario_sexo, pr.nome AS prestador_nome, ex.nome AS executante_nome,
         gp.protocolo AS guia_principal_protocolo, cat.urgencia, pp.nome AS produto_nome,
         au.nome AS auditor_nome, ud.login AS decidida_login, scc.sigla AS solicitante_conselho,
         suf.sigla AS solicitante_uf
    FROM pedido_autorizacao_plano pa
    JOIN beneficiario_plano b ON b.id = pa.beneficiario_plano_id
    JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
    LEFT JOIN sexo sx ON sx.id = pf.sexo_id
    JOIN contrato_plano k ON k.id = b.contrato_plano_id
    LEFT JOIN produto_plano pp ON pp.id = k.produto_plano_id
    LEFT JOIN prestador_rede pr ON pr.id = pa.solicitante_prestador_rede_id
    LEFT JOIN prestador_rede ex ON ex.id = pa.executante_prestador_rede_id
    LEFT JOIN pedido_autorizacao_plano gp ON gp.id = pa.guia_principal_pedido_autorizacao_plano_id
    LEFT JOIN carater_atendimento_tiss cat ON cat.id = pa.carater_atendimento_tiss_id
    LEFT JOIN auditor_plano ap ON ap.id = pa.auditor_plano_id
    LEFT JOIN profissional apr ON apr.id = ap.profissional_id
    LEFT JOIN pessoa_fisica au ON au.id = apr.pessoa_fisica_id
    LEFT JOIN usuario ud ON ud.id = pa.decidida_por_usuario_id
    LEFT JOIN conselho_classe scc ON scc.id = pa.solicitante_conselho_classe_id
    LEFT JOIN unidade_federativa suf ON suf.id = pa.solicitante_unidade_federativa_id`;

function resumoDe(p: Linha, agora: Date): DadosAutorizacaoResumo {
  const situacao = SITUACAO_DO_BANCO(txt(p['situacao']));
  const prazo = p['prazo_em'] instanceof Date ? p['prazo_em'] : new Date(String(p['prazo_em']));
  return {
    id: num(p['id']),
    operadora: num(p['operadora_saude_id']),
    protocolo: txt(p['protocolo']),
    beneficiario: num(p['beneficiario_plano_id']),
    beneficiarioNome: txt(p['beneficiario_nome']),
    carteirinha: txt(p['numero_carteira']),
    prestador: num(p['solicitante_prestador_rede_id']),
    prestadorNome: txt(p['prestador_nome']),
    tipoGuia: num(p['tipo_guia_plano_id']),
    carater: bool(p['urgencia']) ? 'U' : 'E',
    situacao,
    solicitadaEm: instante(p['solicitada_em']) ?? '',
    prazoEm: instante(p['prazo_em']) ?? '',
    vencida: ['em-analise', 'pendente', 'em-junta'].includes(situacao) && prazo.getTime() < agora.getTime(),
    senha: txtOuNulo(p['senha']),
    versao: num(p['versao']),
  };
}

/** Procedimentos da TUSS: os termos da terminologia da tabela 22 da TISS. */
const SELECT_TUSS = `
  SELECT t.codigo_termo, t.descricao, t.ativo, t.vigencia_inicio, t.vigencia_fim,
         (t.ativo = TRUE AND (t.vigencia_inicio IS NULL OR t.vigencia_inicio <= CURRENT_DATE)
           AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= CURRENT_DATE)) AS vigente
    FROM termo_terminologia t
    JOIN terminologia g ON g.id = t.terminologia_id
   WHERE g.numero_tabela_tiss = '22'`;
const VIGENTE_TUSS =
  't.ativo = TRUE AND (t.vigencia_inicio IS NULL OR t.vigencia_inicio <= CURRENT_DATE) AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= CURRENT_DATE)';

const procedimentoTuss = (t: Linha): DadosProcedimentoTuss => ({
  codigo: txt(t['codigo_termo']),
  nome: txt(t['descricao']),
  vigente: bool(t['vigente']),
});

export class PortaAutorizacaoOperadoraPropria
  extends BasePortaOperadoraPropria<GravadorAutorizacao>
  implements PortaAutorizacaoOperadora
{
  constructor(
    nucleo: NucleoOperadora,
    cliente: string,
    private readonly f1: Pick<PortaOperadora, 'elegibilidade'>,
    private readonly rede: Pick<PortaRedeOperadora, 'prestador' | 'prestadores'>,
  ) {
    super(nucleo, cliente, 'operadora.autorizacao', TABELAS_AUTORIZACAO);
  }

  // ---- domínios e apoio ----

  async dominios(c: ContextoAutorizacao): Promise<Record<DominioAutorizacao, DadosItemDominioAutorizacao[]>> {
    return this.ler(c, async (l) => {
      const r = {} as Record<DominioAutorizacao, DadosItemDominioAutorizacao[]>;
      for (const [d, tabela] of Object.entries(DOMINIOS) as [DominioAutorizacao, string][]) {
        const linhas = await l.consultar(
          `SELECT id, descricao FROM ${tabela} WHERE ativo = TRUE ORDER BY descricao, id`,
        );
        r[d] = linhas.map((x) => ({ codigo: num(x['id']), rotulo: txt(x['descricao']) }));
      }
      return r;
    });
  }

  async prestadores(c: ContextoAutorizacao): Promise<DadosPrestadorParaAutorizacao[]> {
    const r: DadosPrestadorParaAutorizacao[] = [];
    let apos: { nome: string; id: number } | undefined;
    for (let i = 0; i < 20; i++) {
      const p = await this.rede.prestadores(c, { situacao: 'credenciado', ...(apos ? { apos } : {}) });
      r.push(
        ...p.itens.map((x: Prestador) => ({
          id: x.id,
          nome: x.nome,
          tipo: x.tipo,
          regime: x.regime,
          municipioIbge: x.municipioIbge,
          uf: x.uf,
        })),
      );
      if (!p.proxima) break;
      apos = p.proxima;
    }
    return r;
  }

  prestador(c: ContextoAutorizacao, id: number): Promise<Prestador | null> {
    return this.rede.prestador(c, id);
  }

  elegibilidade(c: ContextoAutorizacao, carteirinha: string): Promise<DadosElegibilidadeBeneficiario | null> {
    return this.f1.elegibilidade(c, carteirinha) as Promise<DadosElegibilidadeBeneficiario | null>;
  }

  // Catálogos oficiais (dado da rede inteira, carga versionada): TUSS de procedimentos (tabela 22 da TISS) e CID-10,
  // em termo_terminologia. Catálogo ainda não carregado: nenhum termo (o serviço recusa o código ausente como regra de
  // negócio), nunca 501 na leitura.
  procedimentosTuss(c: ContextoAutorizacao, codigos: readonly string[]): Promise<DadosProcedimentoTuss[]> {
    const lista = [...new Set(codigos)];
    if (!lista.length) return Promise.resolve([]);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `${SELECT_TUSS} AND t.codigo_termo IN (${lista.map(() => '?').join(',')}) ORDER BY t.codigo_termo`,
          lista,
        )
      ).map(procedimentoTuss),
    );
  }

  buscarTuss(c: ContextoAutorizacao, termo: string): Promise<DadosProcedimentoTuss[]> {
    const digitos = termo.replace(/[.\-\s]/g, '');
    const porCodigo = /^\d{2,8}$/.test(digitos);
    const texto = termo.trim().replace(/[%_\\]/g, '');
    if (!porCodigo && texto.length < 3) return Promise.resolve([]);
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `${SELECT_TUSS} AND ${VIGENTE_TUSS} AND ${porCodigo ? 't.codigo_termo LIKE ?' : 't.descricao LIKE ?'}
            ORDER BY t.codigo_termo LIMIT ${LIMITE_BUSCA_TUSS}`,
          [porCodigo ? `${digitos}%` : `%${texto}%`],
        )
      ).map(procedimentoTuss),
    );
  }

  nomeDoCid(c: ContextoAutorizacao, codigo: string): Promise<string | null> {
    const cod = codigo.trim().toUpperCase().replace('.', '');
    return this.ler(c, async (l) => {
      const r = await l.uma(
        `SELECT t.descricao FROM termo_terminologia t JOIN terminologia g ON g.id = t.terminologia_id
          WHERE g.codigo = 'cid10' AND t.codigo_termo IN (?, ?) AND t.ativo = TRUE LIMIT 1`,
        [cod, cod.length > 3 ? `${cod.slice(0, 3)}.${cod.slice(3)}` : cod],
      );
      return r ? txt(r['descricao']) : null;
    });
  }

  // ---- pedidos ----

  autorizacoes(
    c: ContextoAutorizacao,
    f: FiltroAutorizacoesPorta,
  ): Promise<{ itens: DadosAutorizacaoResumo[]; proxima: number | null }> {
    const limite = Math.min(f.limite ?? LIMITE_PAGINA_AUTORIZACOES, LIMITE_PAGINA_AUTORIZACOES);
    const cond = ['pa.estabelecimento_id = ?', 'pa.excluido_em IS NULL'];
    const p: unknown[] = [c.estabelecimento ?? 0];
    if (f.situacao) {
      cond.push('pa.situacao = ?');
      p.push(SITUACAO(f.situacao));
    }
    if (f.vencidas) cond.push("pa.situacao IN ('em_analise','pendente','em_junta') AND pa.prazo_em < NOW()");
    if (f.prestador !== undefined) {
      cond.push('pa.solicitante_prestador_rede_id = ?');
      p.push(f.prestador);
    }
    if (f.busca) {
      cond.push('(pa.protocolo = ? OR pa.numero_carteira = ? OR pa.senha = ?)');
      p.push(f.busca, f.busca, f.busca);
    }
    if (f.apos) {
      cond.push('pa.id < ?');
      p.push(f.apos);
    }
    return this.ler(c, async (l) => {
      const agora = await this.agoraDoBanco(l);
      const linhas = await l.consultar(`${SELECT_PEDIDO} WHERE ${cond.join(' AND ')} ORDER BY pa.id DESC LIMIT ${limite + 1}`, p);
      const itens = linhas.slice(0, limite).map((x) => resumoDe(x, agora));
      return { itens, proxima: linhas.length > limite ? (itens.at(-1)?.id ?? null) : null };
    });
  }

  private async agoraDoBanco(l: Leitor): Promise<Date> {
    const r = await l.uma<{ agora: unknown }>('SELECT NOW() AS agora');
    return new Date(`${instante(r?.agora)}Z`);
  }

  totais(c: ContextoAutorizacao): Promise<TotaisAutorizacoes> {
    return this.ler(c, async (l) => {
      const t = await l.uma(
        `SELECT SUM(situacao = 'em_analise') AS em_analise, SUM(situacao = 'pendente') AS pendentes,
                SUM(situacao = 'em_junta') AS em_junta,
                SUM(situacao IN ('em_analise','pendente','em_junta') AND prazo_em < NOW()) AS vencidas,
                SUM(situacao IN ('autorizada','parcial','negada') AND DATE(decidida_em) = CURRENT_DATE) AS hoje
           FROM pedido_autorizacao_plano WHERE estabelecimento_id = ? AND excluido_em IS NULL`,
        [c.estabelecimento ?? 0],
      );
      return {
        emAnalise: num(t?.['em_analise']),
        pendentes: num(t?.['pendentes']),
        emJunta: num(t?.['em_junta']),
        vencidas: num(t?.['vencidas']),
        decididasHoje: num(t?.['hoje']),
      };
    });
  }

  autorizacao(c: ContextoAutorizacao, id: number): Promise<DadosAutorizacao | null> {
    return this.ler(c, async (l) => {
      const p = await l.uma(`${SELECT_PEDIDO} WHERE pa.id = ? AND pa.estabelecimento_id = ? AND pa.excluido_em IS NULL`, [
        id,
        c.estabelecimento ?? 0,
      ]);
      if (!p) return null;
      const hist = await l.consultar(
        `SELECT evento, texto, dados FROM pedido_autorizacao_plano_historico
          WHERE pedido_autorizacao_plano_id = ? ORDER BY ocorrido_em, id`,
        [id],
      );
      const ultimo = (ev: string) => [...hist].reverse().find((h) => txt(h['evento']) === ev);
      const decisao = ultimo('decisao');
      const dadosDecisao = lerJson(decisao?.['dados']);
      const registro = lerJson(ultimo('registro')?.['dados']);
      const junta = await l.uma(
        `SELECT motivo_divergencia, desempatador_nome, desempatador_numero_conselho, uf.sigla AS uf,
                beneficiario_notificado_em, parecer
           FROM junta_divergencia_tecnica j LEFT JOIN unidade_federativa uf ON uf.id = j.desempatador_unidade_federativa_id
          WHERE j.pedido_autorizacao_plano_id = ? AND j.excluido_em IS NULL ORDER BY j.id DESC LIMIT 1`,
        [id],
      );
      const internacao = p['tipo_internacao']
        ? {
            tipo: TIPO_INTERNACAO_DO_BANCO[txt(p['tipo_internacao'])] ?? 1,
            diarias: num(p['diarias_solicitadas']),
            diariasAutorizadas: numOuNulo(p['diarias_autorizadas']),
            admissaoPrevista: data(p['data_prevista_execucao']) ?? '',
          }
        : null;
      return {
        ...resumoDe(p, await this.agoraDoBanco(l)),
        beneficiarioNascimento: data(p['beneficiario_nascimento']) ?? '',
        beneficiarioSexo: txt(p['beneficiario_sexo']),
        produtoNome: txt(p['produto_nome']),
        produtoNatureza: 'plano',
        segmentacao: null,
        executante: numOuNulo(p['executante_prestador_rede_id']),
        executanteNome: txtOuNulo(p['executante_nome']),
        guiaPrincipal: numOuNulo(p['guia_principal_pedido_autorizacao_plano_id']),
        guiaPrincipalProtocolo: txtOuNulo(p['guia_principal_protocolo']),
        altaComplexidade: txt(p['prazo_tipo']) === 'complexo',
        origem: num(p['origem_guia_plano_id']),
        prazoTipo: txt(p['prazo_tipo']) as DadosAutorizacao['prazoTipo'],
        cid: txtOuNulo(registro['cid']),
        indicacaoClinica: txt(p['indicacao_clinica']),
        profissional: {
          nome: txt(p['solicitante_nome']),
          conselho: txt(p['solicitante_conselho']),
          numero: txt(p['solicitante_numero_conselho']),
          uf: txt(p['solicitante_uf']),
        },
        internacao,
        complementoPedido: txtOuNulo(ultimo('complemento_pedido')?.['texto']),
        complementoResposta: txtOuNulo(ultimo('complemento_resposta')?.['texto']),
        junta: junta
          ? {
              divergencia: txt(junta['motivo_divergencia']),
              desempatador: txt(junta['desempatador_nome']),
              crm: txt(junta['desempatador_numero_conselho']),
              uf: txt(junta['uf']),
              notificadosEm: instante(junta['beneficiario_notificado_em']) ?? '',
              parecer: txtOuNulo(junta['parecer']),
            }
          : null,
        auditor: numOuNulo(p['auditor_plano_id']),
        auditorNome: txtOuNulo(p['auditor_nome']),
        decididaEm: instante(p['decidida_em']),
        decididaPor: txtOuNulo(p['decidida_login']),
        critica: numOuNulo(p['motivo_decisao_autorizacao_id']),
        fundamento: txtOuNulo(dadosDecisao['fundamento']),
        parecer: txtOuNulo(decisao?.['texto']),
        senhaValidade: data(p['senha_validade']),
        motivoCancelamento: txt(p['situacao']) === 'cancelada' ? txtOuNulo(p['observacao']) : null,
      };
    });
  }

  itens(c: ContextoAutorizacao, id: number): Promise<DadosItemAutorizacao[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT i.id, i.sequencia, i.descricao, i.quantidade_solicitada, i.quantidade_autorizada, i.situacao,
                f.codigo, f.descricao AS item_descricao
           FROM pedido_autorizacao_plano_item i
           JOIN pedido_autorizacao_plano pa ON pa.id = i.pedido_autorizacao_plano_id
           JOIN item_faturavel f ON f.id = i.item_faturavel_id
          WHERE i.pedido_autorizacao_plano_id = ? AND pa.estabelecimento_id = ? AND i.excluido_em IS NULL
          ORDER BY i.sequencia`,
        [id, c.estabelecimento ?? 0],
      );
      return linhas.map((i) => ({
        id: num(i['id']),
        ordem: num(i['sequencia']),
        tabela: 22,
        codigo: txt(i['codigo']),
        descricao: txt(i['descricao'] ?? i['item_descricao']),
        quantidadeSolicitada: num(i['quantidade_solicitada']),
        quantidadeAutorizada: numOuNulo(i['quantidade_autorizada']),
        situacao: txt(i['situacao']) as DadosItemAutorizacao['situacao'],
      }));
    });
  }

  eventos(c: ContextoAutorizacao, id: number): Promise<DadosEventoAutorizacao[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT h.id, h.evento, h.situacao, h.texto, h.ocorrido_em, u.login
           FROM pedido_autorizacao_plano_historico h
           JOIN pedido_autorizacao_plano pa ON pa.id = h.pedido_autorizacao_plano_id
           LEFT JOIN usuario u ON u.id = h.usuario_id
          WHERE h.pedido_autorizacao_plano_id = ? AND pa.estabelecimento_id = ? AND h.evento <> 'troca_responsavel'
            AND h.evento <> 'alteracao_valor'
          ORDER BY h.ocorrido_em, h.id`,
        [id, c.estabelecimento ?? 0],
      );
      return linhas.map((h) => ({
        id: num(h['id']),
        evento: txt(h['evento']).replace('_', '-') as DadosEventoAutorizacao['evento'],
        situacao: SITUACAO_DO_BANCO(txt(h['situacao'])),
        texto: txtOuNulo(h['texto']),
        em: instante(h['ocorrido_em']) ?? '',
        por: txt(h['login']),
      }));
    });
  }

  /** As autorizações pela senha (as contas médicas conferem a guia apresentada). */
  autorizacoesPorSenha(c: ContextoAutorizacao, senhas: readonly string[]): Promise<DadosAutorizacaoDaSenha[]> {
    if (senhas.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l) => {
      const pedidos = await l.consultar(
        `SELECT id, protocolo, senha, situacao, beneficiario_plano_id, solicitante_prestador_rede_id,
                executante_prestador_rede_id, senha_validade
           FROM pedido_autorizacao_plano
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND senha IN (${senhas.map(() => '?').join(', ')})`,
        [c.estabelecimento ?? 0, ...senhas],
      );
      const r: DadosAutorizacaoDaSenha[] = [];
      for (const p of pedidos) {
        const itens = await l.consultar(
          `SELECT f.codigo, i.quantidade_autorizada FROM pedido_autorizacao_plano_item i
             JOIN item_faturavel f ON f.id = i.item_faturavel_id
            WHERE i.pedido_autorizacao_plano_id = ? AND i.excluido_em IS NULL ORDER BY i.sequencia`,
          [p['id']],
        );
        r.push({
          id: num(p['id']),
          protocolo: txt(p['protocolo']),
          senha: txt(p['senha']),
          situacao: SITUACAO_DO_BANCO(txt(p['situacao'])),
          beneficiario: num(p['beneficiario_plano_id']),
          prestadores: [p['solicitante_prestador_rede_id'], p['executante_prestador_rede_id']]
            .filter((x) => x !== null && x !== undefined)
            .map(Number),
          validade: data(p['senha_validade']),
          itens: itens.map((i) => ({ tabela: 22, codigo: txt(i['codigo']), autorizada: numOuNulo(i['quantidade_autorizada']) })),
        });
      }
      return r;
    });
  }

  /**
   * Os anexos da resposta ao complemento: o modelo ainda não guarda o anexo do portal (armazenamento de arquivos
   * pendente), então não há anexo a listar. A ficha do pedido abre; só abrir o anexo responde 501.
   */
  async anexosDoComplemento(): Promise<DadosAnexoComplemento[]> {
    return [];
  }

  async anexoDoComplemento(): Promise<{ autorizacao: number; nome: string; tipo: string; sha256: string; bytes: Buffer } | null> {
    return pendente('Anexos da resposta do prestador (armazenamento de arquivos)');
  }

  // ---- auditores ----

  private auditoresDe(l: Leitor, est: number, filtro: string, p: unknown[]): Promise<DadosAuditor[]> {
    return l
      .consultar(
        `SELECT a.id, a.operadora_saude_id, a.categoria, a.vigencia_inicio, a.vigencia_fim, a.situacao, a.versao,
                u.login, pf.nome, cc.sigla AS conselho, ic.numero_inscricao, uf.sigla AS uf,
                (SELECT COUNT(*) FROM pedido_autorizacao_plano pa
                  WHERE pa.auditor_plano_id = a.id AND pa.estabelecimento_id = ?
                    AND pa.situacao IN ('em_analise','pendente','em_junta') AND pa.excluido_em IS NULL) AS em_analise
           FROM auditor_plano a
           JOIN profissional pr ON pr.id = a.profissional_id
           JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
           LEFT JOIN usuario u ON u.id = a.usuario_id
           LEFT JOIN inscricao_conselho ic ON ic.id = (SELECT x.id FROM inscricao_conselho x
                                                         WHERE x.profissional_id = pr.id AND x.excluido_em IS NULL
                                                         ORDER BY x.principal DESC, x.sequencia LIMIT 1)
           LEFT JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
           LEFT JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
          WHERE a.excluido_em IS NULL
            AND EXISTS (SELECT 1 FROM operadora_saude_estabelecimento oe
                         WHERE oe.operadora_saude_id = a.operadora_saude_id AND oe.estabelecimento_id = ?
                           AND oe.excluido_em IS NULL)
            ${filtro}
          ORDER BY pf.nome, a.id`,
        [est, est, ...p],
      )
      .then((linhas) =>
        linhas.map((a) => ({
          id: num(a['id']),
          operadora: num(a['operadora_saude_id']),
          login: txt(a['login']),
          nome: txt(a['nome']),
          categoria: txt(a['categoria']) === 'enfermeiro' ? 'enfermeiro' : 'medico',
          conselho: txt(a['conselho']),
          numero: txt(a['numero_inscricao']),
          uf: txt(a['uf']),
          inicio: data(a['vigencia_inicio']) ?? '',
          fim: data(a['vigencia_fim']),
          situacao: txt(a['situacao']) === 'ativo' ? 'ativo' : 'encerrado',
          motivoEncerramento: null,
          versao: num(a['versao']),
          emAnalise: num(a['em_analise']),
        })),
      );
  }

  auditores(c: ContextoAutorizacao): Promise<DadosAuditor[]> {
    return this.ler(c, (l) => this.auditoresDe(l, c.estabelecimento ?? 0, '', []));
  }

  async auditor(c: ContextoAutorizacao, id: number): Promise<DadosAuditor | null> {
    return (await this.ler(c, (l) => this.auditoresDe(l, c.estabelecimento ?? 0, 'AND a.id = ?', [id])))[0] ?? null;
  }

  designacoes(c: ContextoAutorizacao, login: string): Promise<DadosAuditor[]> {
    return this.ler(c, (l) =>
      this.auditoresDe(l, c.estabelecimento ?? 0, "AND u.login = ? AND a.situacao = 'ativo'", [login]),
    );
  }

  // ---- gravação ----

  protected gravador(tx: TxOperacao): GravadorAutorizacao {
    const est = tx.contexto.estabelecimento ?? 0;
    const pedido = async (id: number) => {
      const p = await versaoDe(tx, 'pedido_autorizacao_plano', id, 'O pedido de autorização');
      if (num(p['estabelecimento_id']) !== est) throw inexistente('O pedido de autorização');
      return p;
    };
    const historico = (id: number, evento: string, situacao: string, texto: string | null, dados?: unknown) =>
      tx.incluir('pedido_autorizacao_plano_historico', {
        pedido_autorizacao_plano_id: id,
        operacao: evento === 'registro' ? 'inclusao' : 'alteracao',
        dados: dados === undefined ? null : JSON.stringify(dados),
        ocorrido_em: new Date(),
        usuario_id: tx.contexto.usuario,
        evento,
        situacao,
        texto,
      });
    const emAberto = (p: Linha, permitidas: readonly string[], codigo: string, msg: string) => {
      if (!permitidas.includes(txt(p['situacao']))) throw recusa(codigo, msg);
    };
    return {
      proximoProtocolo: async () => (await tx.proximoNumero('protocolo_autorizacao')).valor,
      proximaSenha: async () => (await tx.proximoNumero('senha_autorizacao')).valor,
      registrar: (r) => registrarPedido(tx, est, r, historico),
      async pedirComplemento(a) {
        const p = await pedido(a.id);
        emAberto(p, ['em_analise'], 'pedido-nao-em-analise', 'Só o pedido em análise pode pedir complemento.');
        const versao = await tx.alterar('pedido_autorizacao_plano', a.id, a.versao, { situacao: 'pendente' });
        await historico(a.id, 'complemento_pedido', 'pendente', a.pedido);
        return { id: a.id, versao };
      },
      async responderComplemento(a) {
        const p = await pedido(a.id);
        emAberto(p, ['pendente'], 'pedido-sem-complemento', 'O pedido não aguarda complemento.');
        const versao = await tx.alterar('pedido_autorizacao_plano', a.id, a.versao, { situacao: 'em_analise' });
        await historico(a.id, 'complemento_resposta', 'em_analise', a.resposta);
        return { id: a.id, versao };
      },
      responderComplementoPortal: () => pendente('Resposta do complemento pelo portal (anexos)'),
      async abrirJunta(a) {
        const p = await pedido(a.id);
        emAberto(p, ['em_analise', 'pendente'], 'pedido-decidido', 'O pedido já foi decidido.');
        const auditor = numOuNulo(p['auditor_plano_id']);
        if (!auditor) throw recusa('pedido-sem-auditor', 'Designe o auditor do pedido antes de abrir a junta.');
        const uf = await tx.uma('SELECT id FROM unidade_federativa WHERE sigla = ?', [a.desempatador.uf]);
        const numero = await tx.proximoNumero('junta');
        await tx.incluir('junta_divergencia_tecnica', {
          estabelecimento_id: est,
          numero: numero.formatado,
          pedido_autorizacao_plano_id: a.id,
          beneficiario_plano_id: num(p['beneficiario_plano_id']),
          auditor_plano_id: auditor,
          assistente_nome: txt(p['solicitante_nome']) || 'Profissional assistente',
          assistente_numero_conselho: txtOuNulo(p['solicitante_numero_conselho']),
          desempatador_nome: a.desempatador.nome,
          desempatador_numero_conselho: a.desempatador.crm,
          desempatador_unidade_federativa_id: uf ? num(uf['id']) : null,
          desempatador_escolhido_em: new Date(),
          motivo_divergencia: a.divergencia.slice(0, 2000),
          instaurada_em: new Date(),
          beneficiario_notificado_em: new Date(a.notificadosEm),
          situacao: 'em_analise',
        });
        const versao = await tx.alterar('pedido_autorizacao_plano', a.id, a.versao, { situacao: 'em_junta' });
        await historico(a.id, 'junta_aberta', 'em_junta', a.divergencia);
        return { id: a.id, versao };
      },
      async decidir(d) {
        const p = await pedido(d.id);
        emAberto(p, ['em_analise', 'em_junta'], 'pedido-nao-em-analise', 'Só o pedido em análise pode ser decidido.');
        if ((d.situacao === 'autorizada' || d.situacao === 'parcial') && !d.senha)
          throw recusa('senha-obrigatoria', 'A autorização precisa da senha.', { campos: ['senha'] });
        for (const i of d.itens) {
          const item = await tx.uma(
            'SELECT id, versao FROM pedido_autorizacao_plano_item WHERE id = ? AND pedido_autorizacao_plano_id = ?',
            [i.id, d.id],
          );
          if (!item) throw inexistente('O item do pedido');
          if (i.situacao === 'negado' && d.critica === null)
            throw recusa('motivo-obrigatorio', 'O item negado precisa do motivo (crítica).', { campos: ['critica'] });
          await tx.alterar('pedido_autorizacao_plano_item', i.id, num(item['versao']), {
            quantidade_autorizada: i.situacao === 'negado' ? 0 : i.quantidade,
            situacao: i.situacao,
            motivo_decisao_autorizacao_id: i.situacao === 'negado' ? d.critica : null,
          });
        }
        const versao = await tx.alterar('pedido_autorizacao_plano', d.id, d.versao, {
          situacao: d.situacao,
          diarias_autorizadas: d.diarias,
          auditor_plano_id: d.auditor,
          motivo_decisao_autorizacao_id: d.critica,
          decidida_em: new Date(),
          decidida_por_usuario_id: tx.contexto.usuario,
          senha: d.senha,
          senha_validade: d.senhaValidade,
        });
        if (txt(p['situacao']) === 'em_junta') {
          const j = await tx.uma(
            `SELECT id, versao FROM junta_divergencia_tecnica
              WHERE pedido_autorizacao_plano_id = ? AND situacao <> 'concluida' AND excluido_em IS NULL
              ORDER BY id DESC LIMIT 1`,
            [d.id],
          );
          if (j) {
            await tx.alterar('junta_divergencia_tecnica', num(j['id']), num(j['versao']), {
              situacao: 'concluida',
              conclusao: d.situacao === 'autorizada' ? 'favoravel_assistente' : d.situacao === 'parcial' ? 'parcial' : 'favoravel_operadora',
              parecer: d.parecerJunta ?? d.parecer,
              concluida_em: new Date(),
              realizada_em: new Date(),
            });
            await historico(d.id, 'junta_concluida', 'em_junta', d.parecerJunta ?? null);
          }
        }
        await historico(d.id, 'decisao', d.situacao, d.parecer, { fundamento: d.fundamento });
        return { id: d.id, versao };
      },
      async cancelar(a) {
        const p = await pedido(a.id);
        emAberto(p, ['em_analise', 'pendente', 'em_junta', 'autorizada', 'parcial'], 'pedido-cancelado', 'O pedido já foi encerrado.');
        const motivo = await tx.uma(
          `SELECT id FROM motivo_cancelamento_guia_plano
            WHERE codigo = 'outros' AND ativo = TRUE LIMIT 1`,
        );
        if (!motivo)
          throw recusa(
            'motivo-cancelamento-ausente',
            'Cadastre o motivo de cancelamento "outros" da guia antes de cancelar pedidos.',
          );
        const versao = await tx.alterar('pedido_autorizacao_plano', a.id, a.versao, {
          situacao: 'cancelada',
          motivo_cancelamento_guia_plano_id: num(motivo['id']),
          cancelada_em: new Date(),
          observacao: a.motivo,
        });
        await historico(a.id, 'cancelamento', 'cancelada', a.motivo);
        return { id: a.id, versao };
      },
      async designar(d) {
        await exigirOperadora(tx, est, d.operadora);
        const prof = await tx.uma(
          `SELECT ic.profissional_id FROM inscricao_conselho ic
             JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
             JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
            WHERE cc.sigla = ? AND ic.numero_inscricao = ? AND uf.sigla = ? AND ic.excluido_em IS NULL LIMIT 1`,
          [d.conselho, d.numero, d.uf],
        );
        if (!prof)
          throw recusa('profissional-nao-cadastrado', 'Cadastre o profissional (conselho, número e UF) antes de designá-lo.', {
            campos: ['numero'],
          });
        const usuario = await tx.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [d.login]);
        if (!usuario) throw recusa('usuario-inexistente', 'O usuário informado não existe.', { campos: ['login'] });
        const id = await tx.incluir('auditor_plano', {
          operadora_saude_id: d.operadora,
          profissional_id: num(prof['profissional_id']),
          usuario_id: num(usuario['id']),
          categoria: d.categoria,
          interno: true,
          vigencia_inicio: d.inicio,
          situacao: 'ativo',
        });
        return { id };
      },
      async encerrar(a) {
        const aud = await versaoDe(tx, 'auditor_plano', a.id, 'O auditor');
        await exigirOperadora(tx, est, num(aud['operadora_saude_id']));
        if (txt(aud['situacao']) !== 'ativo') throw recusa('auditor-encerrado', 'A designação já foi encerrada.');
        // Decisão: a designação do auditor é da operadora (rede inteira), e o encerramento vale para todos os
        // estabelecimentos em que ela atua; os pedidos em análise dele em qualquer estabelecimento passam ao
        // auditor que assume (senão ficariam com um auditor inativo, sem ninguém para decidir). A recusa mostra só os
        // protocolos do estabelecimento da sessão; os dos outros entram apenas na contagem.
        const pedidos = await tx.consultarParaAtualizar(
          `SELECT id, versao, protocolo, situacao, estabelecimento_id FROM pedido_autorizacao_plano
            WHERE auditor_plano_id = ? AND situacao IN ('em_analise','pendente','em_junta') AND excluido_em IS NULL
            ORDER BY estabelecimento_id = ? DESC, id`,
          [a.id, est],
        );
        const para = a.redistribuirPara ?? null;
        if (pedidos.length > 0 && para === null)
          throw recusaAuditorComPedidos(
            pedidos.map((p) => ({ protocolo: num(p['estabelecimento_id']) === est ? txt(p['protocolo']) : null })),
          );
        if (para !== null && pedidos.length > 0) {
          const destino = await tx.uma(
            "SELECT operadora_saude_id FROM auditor_plano WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
            [para],
          );
          if (!destino || num(destino['operadora_saude_id']) !== num(aud['operadora_saude_id']) || para === a.id)
            throw recusa('auditor-destino-invalido', 'Escolha outro auditor ativo da mesma operadora.', {
              campos: ['redistribuirPara'],
            });
          for (const p of pedidos) {
            await tx.alterar('pedido_autorizacao_plano', num(p['id']), num(p['versao']), { auditor_plano_id: para });
            await historico(num(p['id']), 'troca_responsavel', txt(p['situacao']), a.motivo, { de: a.id, para });
          }
        }
        await tx.alterar('auditor_plano', a.id, a.versao, {
          situacao: 'inativo',
          vigencia_fim: data(new Date()) ?? undefined,
        });
        return { id: a.id, redistribuidos: para !== null ? pedidos.length : 0 };
      },
      alterar: () => pendente('Alteração do auditor (nome e conselho são do cadastro do profissional)'),
    };
  }
}

function lerJson(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'object') return v as Record<string, unknown>;
  try {
    const d = JSON.parse(String(v)) as unknown;
    return d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function registrarPedido(
  tx: TxOperacao,
  est: number,
  r: Omit<EntradaRegistroAutorizacao, 'hospital'>,
  historico: (id: number, evento: string, situacao: string, texto: string | null, dados?: unknown) => Promise<number>,
): Promise<{ id: number; versao: number }> {
  await exigirOperadora(tx, est, r.operadora);
  const b = await tx.uma(
    `SELECT b.id, k.operadora_saude_id FROM beneficiario_plano b JOIN contrato_plano k ON k.id = b.contrato_plano_id
      WHERE b.id = ? AND k.estabelecimento_id = ? AND b.excluido_em IS NULL`,
    [r.beneficiario, est],
  );
  if (!b || num(b['operadora_saude_id']) !== r.operadora) throw inexistente('O beneficiário');
  const carater = await tx.uma('SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?', [
    CARATER_TISS[r.carater],
  ]);
  if (!carater) throw recusa('carater-nao-cadastrado', 'O caráter do atendimento não está no catálogo TISS.');
  const itens: { id: number; e: (typeof r.itens)[number] }[] = [];
  for (const i of r.itens) {
    const f = await tx.uma('SELECT id FROM item_faturavel WHERE codigo = ? AND excluido_em IS NULL', [i.codigo]);
    if (!f)
      throw recusa('item-nao-cadastrado', `O procedimento ${i.codigo} não está no cadastro de itens.`, { campos: ['itens'] });
    itens.push({ id: num(f['id']), e: i });
  }
  const conselho = await tx.uma('SELECT id FROM conselho_classe WHERE sigla = ?', [r.profissional.conselho]);
  const ufSolicitante = await tx.uma('SELECT id FROM unidade_federativa WHERE sigla = ?', [r.profissional.uf]);
  const numero = await tx.proximoNumero('guia_autorizacao');
  const id = await tx.incluir('pedido_autorizacao_plano', {
    estabelecimento_id: est,
    operadora_saude_id: r.operadora,
    numero_guia: numero.formatado,
    protocolo: r.protocolo,
    guia_principal_pedido_autorizacao_plano_id: r.guiaPrincipal,
    beneficiario_plano_id: r.beneficiario,
    numero_carteira: r.carteirinha,
    tipo_guia_plano_id: r.tipoGuia,
    origem_guia_plano_id: r.origem,
    carater_atendimento_tiss_id: num(carater['id']),
    solicitante_prestador_rede_id: r.prestador,
    solicitante_nome: r.profissional.nome,
    solicitante_numero_conselho: r.profissional.numero,
    solicitante_conselho_classe_id: conselho ? num(conselho['id']) : null,
    solicitante_unidade_federativa_id: ufSolicitante ? num(ufSolicitante['id']) : null,
    executante_prestador_rede_id: r.executante,
    regime_internacao: r.internacao ? 'hospitalar' : null,
    tipo_internacao: r.internacao ? (TIPO_INTERNACAO[r.internacao.tipo] ?? null) : null,
    diarias_solicitadas: r.internacao?.diarias ?? null,
    data_prevista_execucao: r.internacao?.admissaoPrevista ?? null,
    indicacao_clinica: r.indicacaoClinica,
    solicitada_em: new Date(r.solicitadaEm),
    prazo_tipo: r.prazoTipo,
    prazo_em: new Date(r.prazoEm),
    situacao: 'em_analise',
  });
  let seq = 0;
  for (const i of itens)
    await tx.incluir('pedido_autorizacao_plano_item', {
      pedido_autorizacao_plano_id: id,
      sequencia: ++seq,
      tipo_item: 'procedimento',
      item_faturavel_id: i.id,
      descricao: i.e.descricao.slice(0, 300),
      quantidade_solicitada: i.e.quantidade,
      situacao: 'pendente',
    });
  // O CID fica no histórico do registro até o catálogo CID-10 chegar (pedido_autorizacao_plano_diagnostico pede o id).
  await historico(id, 'registro', 'em_analise', null, { cid: r.cid });
  return { id, versao: 1 };
}
