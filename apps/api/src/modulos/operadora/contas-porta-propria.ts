// Porta PRÓPRIA das contas médicas recebidas dos prestadores (F2.2, lote 02-09) sobre o MariaDB do cliente, pelo
// @sgh/nucleo:
//   - conta = lote_conta_recebida (protocolo, lote do prestador, tipo de guia, competência, valores e situação), com as
//     guias em guia_conta_recebida e os itens em guia_conta_recebida_item; a glosa de cada item em
//     glosa_conta_recebida (motivo padronizado da terminologia TISS);
//   - o histórico da conta vem das datas do próprio lote (recebida, analisada, devolvida, paga);
//   - os motivos de glosa são os da terminologia oficial (motivo_glosa), pelo id;
//   - beneficiário, prestadores, autorizações pela senha e designações do auditor vêm das portas da F1, da rede e da
//     autorização.
// Número de negócio: `protocolo_conta` (por estabelecimento).
// Dado da rede inteira: os motivos de glosa (terminologia oficial). Contas filtram pelo estabelecimento da sessão.
// Melhoria: o lote é único por operadora, prestador e número do prestador (UNIQUE no banco: o mesmo lote não entra
// duas vezes); a glosa nunca passa do apresentado (CHECK); a devolução exige o motivo (CHECK).
// Pendente (pedido ao orquestrador): recurso de glosa (por guia e por item) e o arquivo do lote (armazenamento de
// arquivos) respondem 501 `modelo-pendente`.
import type { MotivoGlosaLido } from '@sgh/contratos';
import { type Leitor, type Linha, recusa, type TxOperacao } from '@sgh/nucleo';
import {
  BasePortaOperadoraPropria,
  competenciaDe,
  data,
  exigirOperadora,
  inexistente,
  instante,
  type NucleoOperadora,
  num,
  numOuNulo,
  pendente,
  primeiroDia,
  txt,
  txtOuNulo,
  versaoDe,
} from './apoio-porta-propria.js';
import type { ContextoContas, GravadorContas, PortaContasOperadora } from './contas-porta.js';
import {
  type DadosAuditor,
  type DadosAutorizacaoDaSenha,
  type DadosConta,
  type DadosContaResumo,
  type DadosElegibilidadeBeneficiario,
  type DadosEventoConta,
  type DadosGuiaConta,
  type DadosItemConta,
  type DadosRecursoItem,
  type DecisaoRecursoItem,
  type DadosTipoGuiaConta,
  type EntradaRecebimentoConta,
  type FiltroContasPorta,
  type FiltroPagamentosPorta,
  LIMITE_PAGINA_CONTAS,
  type SituacaoContaPorta,
  type TotaisContas,
} from './dados-portas.js';
import type { PortaOperadora } from './porta.js';
import type { PortaRedeOperadora, Prestador } from './rede-porta.js';

export const TABELAS_CONTAS = [
  'lote_conta_recebida',
  'guia_conta_recebida',
  'guia_conta_recebida_item',
  'glosa_conta_recebida',
] as const;

const TIPO_GUIA = (t: DadosTipoGuiaConta): string => t.replace('-', '_');
const TIPO_GUIA_DO_BANCO = (t: string): DadosTipoGuiaConta => t.replace('_', '-') as DadosTipoGuiaConta;
const SITUACAO_DO_BANCO = (s: string): SituacaoContaPorta =>
  (['recebida', 'analisada', 'paga', 'devolvida'] as const).find((x) => x === s) ?? 'devolvida';

const SELECT_LOTE = `
  SELECT l.*, pr.nome AS prestador_nome, COALESCE(pr.cnpj, pr.cpf) AS prestador_documento, pr.codigo_cnes AS prestador_cnes,
         o.nome AS operadora_nome, o.registro_ans, pj.cnpj AS operadora_cnpj, ua.login AS auditor_login
    FROM lote_conta_recebida l
    JOIN operadora_saude o ON o.id = l.operadora_saude_id
    JOIN pessoa_juridica pj ON pj.id = o.pessoa_juridica_id
    LEFT JOIN prestador_rede pr ON pr.id = l.prestador_rede_id
    LEFT JOIN usuario ua ON ua.id = l.auditor_usuario_id`;

function resumoDe(l: Linha, hoje: string): DadosContaResumo {
  const situacao = SITUACAO_DO_BANCO(txt(l['situacao']));
  const prazo = data(l['prazo_pagamento']) ?? '';
  return {
    id: num(l['id']),
    operadora: num(l['operadora_saude_id']),
    prestador: num(l['prestador_rede_id']),
    prestadorNome: txt(l['prestador_nome']),
    protocolo: txt(l['numero_protocolo']),
    numeroLote: txt(l['numero_lote_prestador']),
    tipoGuia: TIPO_GUIA_DO_BANCO(txt(l['tipo_guia'])),
    competencia: competenciaDe(l['competencia']),
    guias: num(l['quantidade_guias']),
    recebidaEm: instante(l['recebido_em']) ?? '',
    prazoPagamento: prazo,
    vencida: situacao !== 'paga' && situacao !== 'devolvida' && prazo !== '' && prazo < hoje,
    situacao,
    apresentado: num(l['valor_apresentado']),
    glosado: num(l['valor_glosado']),
    acatado: 0,
    pago: num(l['valor_pago']),
    recursosPendentes: 0,
    versao: num(l['versao']),
  };
}

/** A decisão do item do recurso no banco → na tela (pendente: sem decisão). */
const DECISAO_RECURSO_ITEM: Readonly<Record<string, DecisaoRecursoItem>> = {
  acatado: 'acatado',
  acatado_parcial: 'parcial',
  negado: 'mantido',
};

export class PortaContasOperadoraPropria extends BasePortaOperadoraPropria<GravadorContas> implements PortaContasOperadora {
  constructor(
    nucleo: NucleoOperadora,
    cliente: string,
    private readonly f1: Pick<PortaOperadora, 'elegibilidade'>,
    private readonly rede: Pick<PortaRedeOperadora, 'prestador' | 'prestadores'>,
    private readonly autorizacao: {
      autorizacoesPorSenha(c: ContextoContas, senhas: readonly string[]): Promise<DadosAutorizacaoDaSenha[]>;
      designacoes(c: ContextoContas, login: string): Promise<DadosAuditor[]>;
    },
  ) {
    super(nucleo, cliente, 'operadora.contas', TABELAS_CONTAS);
  }

  private async hojeDo(l: Leitor): Promise<string> {
    return data((await l.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje'))?.hoje) ?? '';
  }

  // ---- apoio ----

  async prestadores(c: ContextoContas): Promise<{ id: number; nome: string }[]> {
    const r: { id: number; nome: string }[] = [];
    let apos: { nome: string; id: number } | undefined;
    for (let i = 0; i < 20; i++) {
      const p = await this.rede.prestadores(c, { ...(apos ? { apos } : {}) });
      r.push(...p.itens.map((x: Prestador) => ({ id: x.id, nome: x.nome })));
      if (!p.proxima) break;
      apos = p.proxima;
    }
    return r;
  }

  async prestadorPorDocumento(c: ContextoContas, documento: string): Promise<Prestador | null> {
    const p = await this.rede.prestadores(c, { busca: documento });
    return p.itens.find((x: Prestador) => x.documento === documento) ?? null;
  }

  elegibilidade(c: ContextoContas, carteirinha: string): Promise<DadosElegibilidadeBeneficiario | null> {
    return this.f1.elegibilidade(c, carteirinha) as Promise<DadosElegibilidadeBeneficiario | null>;
  }

  autorizacoesPorSenha(c: ContextoContas, senhas: readonly string[]): Promise<DadosAutorizacaoDaSenha[]> {
    return this.autorizacao.autorizacoesPorSenha(c, senhas);
  }

  designacoes(c: ContextoContas, login: string): Promise<DadosAuditor[]> {
    return this.autorizacao.designacoes(c, login);
  }

  async guiasJaApresentadas(c: ContextoContas, prestador: number, numeros: readonly string[]): Promise<Set<string>> {
    if (numeros.length === 0) return new Set();
    const linhas = await this.ler(c, (l) =>
      l.consultar(
        `SELECT DISTINCT g.numero_guia_prestador FROM guia_conta_recebida g
           JOIN lote_conta_recebida l ON l.id = g.lote_conta_recebida_id
          WHERE g.estabelecimento_id = ? AND g.prestador_rede_id = ? AND l.situacao <> 'devolvida'
            AND g.excluido_em IS NULL AND g.numero_guia_prestador IN (${numeros.map(() => '?').join(', ')})`,
        [c.estabelecimento ?? 0, prestador, ...numeros],
      ),
    );
    return new Set(linhas.map((g) => txt(g['numero_guia_prestador'])));
  }

  async loteJaRecebido(
    c: ContextoContas,
    x: { operadora: number; prestador: number; numeroLote: string; sha256: string },
  ): Promise<boolean> {
    const r = await this.ler(c, (l) =>
      l.uma(
        `SELECT 1 AS ok FROM lote_conta_recebida
          WHERE estabelecimento_id = ? AND operadora_saude_id = ? AND prestador_rede_id = ?
            AND (numero_lote_prestador = ? OR hash_tiss = ?) AND situacao <> 'devolvida' AND excluido_em IS NULL`,
        [c.estabelecimento ?? 0, x.operadora, x.prestador, x.numeroLote, x.sha256],
      ),
    );
    return r !== null;
  }

  async motivos(c: ContextoContas): Promise<MotivoGlosaLido[]> {
    const linhas = await this.ler(c, (l) =>
      l.consultar(
        `SELECT m.id, m.descricao, m.permite_reapresentacao, m.grupo_motivo_glosa_id, g.descricao AS grupo
           FROM motivo_glosa m LEFT JOIN grupo_motivo_glosa g ON g.id = m.grupo_motivo_glosa_id
          WHERE m.vigencia_inicio <= CURRENT_DATE AND (m.vigencia_fim IS NULL OR m.vigencia_fim >= CURRENT_DATE)
          ORDER BY m.codigo_tuss`,
      ),
    );
    return linhas.map((m) => ({
      codigo: num(m['id']),
      nome: txt(m['descricao']),
      tipo: num(m['grupo_motivo_glosa_id']),
      tipoNome: txt(m['grupo']),
      reapresenta: m['permite_reapresentacao'] === 1 || m['permite_reapresentacao'] === true,
    }));
  }

  // ---- contas ----

  contas(c: ContextoContas, f: FiltroContasPorta): Promise<{ itens: DadosContaResumo[]; proxima: number | null }> {
    const limite = Math.min(f.limite ?? LIMITE_PAGINA_CONTAS, LIMITE_PAGINA_CONTAS);
    const cond = ['l.estabelecimento_id = ?', 'l.excluido_em IS NULL'];
    const p: unknown[] = [c.estabelecimento ?? 0];
    if (f.busca) {
      cond.push('(l.numero_protocolo = ? OR l.numero_lote_prestador = ?)');
      p.push(f.busca, f.busca);
    }
    if (f.prestador !== undefined) {
      cond.push('l.prestador_rede_id = ?');
      p.push(f.prestador);
    }
    if (f.competencia) {
      cond.push('l.competencia = ?');
      p.push(primeiroDia(f.competencia));
    }
    if (f.situacao) {
      cond.push('l.situacao = ?');
      p.push(f.situacao);
    }
    if (f.vencidas) cond.push("l.situacao IN ('recebida','analisada') AND l.prazo_pagamento < CURRENT_DATE");
    if (f.recursos) cond.push('FALSE');
    if (f.apos) {
      cond.push('l.id < ?');
      p.push(f.apos);
    }
    return this.ler(c, async (l) => {
      const hoje = await this.hojeDo(l);
      const linhas = await l.consultar(`${SELECT_LOTE} WHERE ${cond.join(' AND ')} ORDER BY l.id DESC LIMIT ${limite + 1}`, p);
      const itens = linhas.slice(0, limite).map((x) => resumoDe(x, hoje));
      return { itens, proxima: linhas.length > limite ? (itens.at(-1)?.id ?? null) : null };
    });
  }

  pagamentos(c: ContextoContas, f: FiltroPagamentosPorta): Promise<{ itens: DadosContaResumo[]; proxima: number | null }> {
    const limite = Math.min(f.limite ?? LIMITE_PAGINA_CONTAS, LIMITE_PAGINA_CONTAS);
    const cond = ['l.estabelecimento_id = ?', 'l.excluido_em IS NULL'];
    const p: unknown[] = [c.estabelecimento ?? 0];
    cond.push(
      f.estado === 'a-pagar'
        ? "l.situacao = 'analisada'"
        : f.estado === 'pagas'
          ? "l.situacao = 'paga'"
          : "l.situacao IN ('analisada','paga')",
    );
    if (f.prestador !== undefined) {
      cond.push('l.prestador_rede_id = ?');
      p.push(f.prestador);
    }
    if (f.competencia) {
      cond.push('l.competencia = ?');
      p.push(primeiroDia(f.competencia));
    }
    if (f.apos) {
      cond.push('l.id < ?');
      p.push(f.apos);
    }
    return this.ler(c, async (l) => {
      const hoje = await this.hojeDo(l);
      const linhas = await l.consultar(`${SELECT_LOTE} WHERE ${cond.join(' AND ')} ORDER BY l.id DESC LIMIT ${limite + 1}`, p);
      const itens = linhas.slice(0, limite).map((x) => resumoDe(x, hoje));
      return { itens, proxima: linhas.length > limite ? (itens.at(-1)?.id ?? null) : null };
    });
  }

  totais(c: ContextoContas): Promise<TotaisContas> {
    return this.ler(c, async (l) => {
      const t = await l.uma(
        `SELECT SUM(situacao = 'recebida') AS em_analise, SUM(situacao = 'analisada') AS a_pagar,
                SUM(situacao IN ('recebida','analisada') AND prazo_pagamento < CURRENT_DATE) AS vencidas,
                COALESCE(SUM(CASE WHEN situacao = 'recebida' THEN valor_apresentado END), 0) AS valor_em_analise,
                COALESCE(SUM(CASE WHEN situacao = 'analisada' THEN valor_liberado END), 0) AS valor_a_pagar
           FROM lote_conta_recebida WHERE estabelecimento_id = ? AND excluido_em IS NULL`,
        [c.estabelecimento ?? 0],
      );
      return {
        emAnalise: num(t?.['em_analise']),
        aPagar: num(t?.['a_pagar']),
        vencidas: num(t?.['vencidas']),
        recursosPendentes: 0,
        valorEmAnalise: num(t?.['valor_em_analise']),
        valorAPagar: num(t?.['valor_a_pagar']),
      };
    });
  }

  conta(c: ContextoContas, id: number): Promise<DadosConta | null> {
    return this.ler(c, async (l) => {
      const x = await l.uma(`${SELECT_LOTE} WHERE l.id = ? AND l.estabelecimento_id = ? AND l.excluido_em IS NULL`, [
        id,
        c.estabelecimento ?? 0,
      ]);
      if (!x) return null;
      const documento = txt(x['prestador_documento']);
      return {
        ...resumoDe(x, await this.hojeDo(l)),
        operadoraNome: txt(x['operadora_nome']),
        registroAns: txt(x['registro_ans']),
        operadoraCnpj: txt(x['operadora_cnpj']),
        prestadorDocumento: documento,
        prestadorPessoa: documento.length === 11 ? 'F' : 'J',
        prestadorCnes: txtOuNulo(x['prestador_cnes']),
        arquivo: {
          nome: null,
          bytes: 0,
          sha256: txt(x['hash_tiss']),
          hashEpilogo: txt(x['hash_tiss']),
          versaoTiss: txt(x['versao_tiss']),
        },
        auditor: null,
        analisadaEm: instante(x['analisado_em']),
        analisadaPor: txtOuNulo(x['auditor_login']),
        observacao: txtOuNulo(x['observacao']),
        motivoDevolucao: txtOuNulo(x['motivo_devolucao']),
      };
    });
  }

  guias(c: ContextoContas, id: number): Promise<DadosGuiaConta[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT g.*, pf.nome AS beneficiario_nome, pa.protocolo AS autorizacao_protocolo, cat.codigo_tiss AS carater
           FROM guia_conta_recebida g
           LEFT JOIN beneficiario_plano b ON b.id = g.beneficiario_plano_id
           LEFT JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
           LEFT JOIN pedido_autorizacao_plano pa ON pa.id = g.pedido_autorizacao_plano_id
           LEFT JOIN carater_atendimento_tiss cat ON cat.id = g.carater_atendimento_tiss_id
          WHERE g.lote_conta_recebida_id = ? AND g.estabelecimento_id = ? AND g.excluido_em IS NULL
          ORDER BY g.ordem_lote`,
        [id, c.estabelecimento ?? 0],
      );
      return linhas.map((g) => ({
        id: num(g['id']),
        ordem: num(g['ordem_lote']),
        numeroGuiaPrestador: txt(g['numero_guia_prestador']),
        numeroGuiaOperadora: txtOuNulo(g['numero_guia_operadora']),
        senha: txtOuNulo(g['senha_autorizacao']),
        carteirinha: txt(g['numero_carteira']),
        beneficiario: g['beneficiario_plano_id']
          ? { id: num(g['beneficiario_plano_id']), nome: txt(g['beneficiario_nome']) }
          : null,
        autorizacao: g['pedido_autorizacao_plano_id']
          ? { id: num(g['pedido_autorizacao_plano_id']), protocolo: txt(g['autorizacao_protocolo']) }
          : null,
        carater: txtOuNulo(g['carater']),
        inicio: data(g['inicio_atendimento']) ?? '',
        fim: data(g['fim_atendimento'] ?? g['inicio_atendimento']) ?? '',
        criticas: txtOuNulo(g['observacao'])?.split('\n').filter(Boolean) ?? [],
        apresentado: num(g['valor_apresentado']),
        glosado: num(g['valor_glosado']),
        acatado: num(g['valor_acatado_recurso']),
        recurso: null,
      }));
    });
  }

  itens(c: ContextoContas, id: number): Promise<DadosItemConta[]> {
    return this.ler(c, async (l) => {
      const linhas = await l.consultar(
        `SELECT i.*, g.ordem_lote, t.codigo_termo,
                (SELECT gl.motivo_glosa_id FROM glosa_conta_recebida gl
                  WHERE gl.guia_conta_recebida_item_id = i.id AND gl.excluido_em IS NULL
                  ORDER BY gl.sequencia DESC LIMIT 1) AS motivo,
                (SELECT gl.fonte_glosa FROM glosa_conta_recebida gl
                  WHERE gl.guia_conta_recebida_item_id = i.id AND gl.excluido_em IS NULL
                  ORDER BY gl.sequencia DESC LIMIT 1) AS fonte
           FROM guia_conta_recebida_item i
           JOIN guia_conta_recebida g ON g.id = i.guia_conta_recebida_id
           JOIN termo_terminologia t ON t.id = i.procedimento_termo_terminologia_id
          WHERE g.lote_conta_recebida_id = ? AND g.estabelecimento_id = ? AND i.excluido_em IS NULL
          ORDER BY g.ordem_lote, i.sequencia`,
        [id, c.estabelecimento ?? 0],
      );
      return linhas.map((i) => {
        const quantidade = num(i['quantidade_apresentada']);
        const fonte = txtOuNulo(i['fonte']);
        return {
          id: num(i['id']),
          guia: num(i['guia_conta_recebida_id']),
          ordem: num(i['ordem_lote']),
          sequencial: num(i['sequencia']),
          grupo: txt(i['grupo']) === 'despesa' ? 'despesa' : 'procedimento',
          codigoDespesa: txtOuNulo(i['tipo_despesa']),
          tabela: txt(i['codigo_tabela_tiss']),
          codigo: txt(i['codigo_termo']),
          descricao: txt(i['descricao']),
          data: data(i['data_execucao']) ?? '',
          quantidade,
          fator: 1 + num(i['percentual_reducao_acrescimo']) / 100,
          valorUnitario: num(i['valor_unitario_apresentado']),
          apresentado: num(i['valor_apresentado']),
          glosado: num(i['valor_glosado']),
          motivo: numOuNulo(i['motivo']),
          justificativa: txtOuNulo(i['justificativa']),
          origem: fonte === null ? null : fonte === 'automatica' ? 'automatica' : 'auditor',
          critica: txt(i['situacao']) === 'criticado' ? txtOuNulo(i['justificativa']) : null,
        };
      });
    });
  }

  eventos(c: ContextoContas, id: number): Promise<DadosEventoConta[]> {
    return this.ler(c, async (l) => {
      const x = await l.uma(
        `SELECT l.situacao, l.recebido_em, l.analisado_em, l.devolvido_em, l.motivo_devolucao, l.valor_pago,
                l.valor_apresentado, l.alterado_em, uc.login AS criado_login, ua.login AS alterado_login
           FROM lote_conta_recebida l
           LEFT JOIN usuario uc ON uc.id = l.criado_por
           LEFT JOIN usuario ua ON ua.id = l.alterado_por
          WHERE l.id = ? AND l.estabelecimento_id = ? AND l.excluido_em IS NULL`,
        [id, c.estabelecimento ?? 0],
      );
      if (!x) return [];
      const base = { guia: null, pagoEm: null, documento: null } as const;
      const r: DadosEventoConta[] = [
        {
          ...base,
          id: 1,
          evento: 'recebimento',
          situacao: 'recebida',
          valor: num(x['valor_apresentado']),
          texto: null,
          em: instante(x['recebido_em']) ?? '',
          por: txt(x['criado_login']),
        },
      ];
      if (x['analisado_em'])
        r.push({ ...base, id: 2, evento: 'analise', situacao: 'analisada', valor: null, texto: null, em: instante(x['analisado_em']) ?? '', por: txt(x['alterado_login']) });
      if (x['devolvido_em'])
        r.push({ ...base, id: 3, evento: 'devolucao', situacao: 'devolvida', valor: null, texto: txtOuNulo(x['motivo_devolucao']), em: instante(x['devolvido_em']) ?? '', por: txt(x['alterado_login']) });
      if (txt(x['situacao']) === 'paga')
        r.push({ ...base, id: 4, evento: 'pagamento', situacao: 'paga', valor: num(x['valor_pago']), texto: null, em: instante(x['alterado_em']) ?? '', por: txt(x['alterado_login']) });
      return r;
    });
  }

  /** Os recursos de glosa por item da conta (recurso_glosa_recebido_item), com a decisão quando houver. */
  recursosItens(c: ContextoContas, id: number): Promise<DadosRecursoItem[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT i.id, i.guia_conta_recebida_id, i.guia_conta_recebida_item_id, i.valor_recursado, i.valor_acatado,
                  i.justificativa_prestador, i.justificativa_operadora, i.decisao, r.recebido_em, r.decidido_em,
                  uc.login AS registrado_login, ua.login AS analista_login
             FROM recurso_glosa_recebido_item i
             JOIN recurso_glosa_recebido r ON r.id = i.recurso_glosa_recebido_id
             LEFT JOIN usuario uc ON uc.id = i.criado_por
             LEFT JOIN usuario ua ON ua.id = r.analista_usuario_id
            WHERE r.lote_conta_recebida_id = ? AND r.estabelecimento_id = ? AND i.guia_conta_recebida_item_id IS NOT NULL
              AND r.excluido_em IS NULL AND i.excluido_em IS NULL
            ORDER BY i.id`,
          [id, c.estabelecimento ?? 0],
        )
      ).map((x): DadosRecursoItem => {
        const decisao = DECISAO_RECURSO_ITEM[txt(x['decisao'])];
        return {
          id: num(x['id']),
          guia: num(x['guia_conta_recebida_id']),
          item: num(x['guia_conta_recebida_item_id']),
          valor: num(x['valor_recursado']),
          justificativa: txt(x['justificativa_prestador']),
          em: instante(x['recebido_em']) ?? '',
          por: txt(x['registrado_login']),
          decisao: decisao
            ? {
                decisao,
                valorAcatado: num(x['valor_acatado']),
                parecer: txt(x['justificativa_operadora']),
                em: instante(x['decidido_em']) ?? '',
                por: txt(x['analista_login']),
              }
            : null,
        };
      }),
    );
  }

  // ---- gravação ----

  protected gravador(tx: TxOperacao): GravadorContas {
    const est = tx.contexto.estabelecimento ?? 0;
    const lote = async (id: number) => {
      const x = await versaoDe(tx, 'lote_conta_recebida', id, 'A conta');
      if (num(x['estabelecimento_id']) !== est) throw inexistente('A conta');
      return x;
    };
    return {
      proximoProtocolo: async () => (await tx.proximoNumero('protocolo_conta')).valor,
      receber: (r) => receberLote(tx, est, r),
      async glosar(a) {
        const x = await lote(a.id);
        if (txt(x['situacao']) !== 'recebida') throw recusa('conta-analisada', 'Só a conta em análise pode ser glosada.');
        for (const g of a.itens) {
          const it = await tx.uma(
            `SELECT i.id, i.versao, i.valor_apresentado, i.guia_conta_recebida_id
               FROM guia_conta_recebida_item i JOIN guia_conta_recebida g ON g.id = i.guia_conta_recebida_id
              WHERE i.id = ? AND g.lote_conta_recebida_id = ?`,
            [g.item, a.id],
          );
          if (!it) throw inexistente('O item da conta');
          if (g.valorGlosado > num(it['valor_apresentado']))
            throw recusa('glosa-maior', 'A glosa não pode passar do valor apresentado.', { campos: ['valorGlosado'] });
          if (g.valorGlosado > 0 && g.motivo === null)
            throw recusa('motivo-obrigatorio', 'Informe o motivo da glosa.', { campos: ['motivo'] });
          await tx.alterar('guia_conta_recebida_item', g.item, num(it['versao']), {
            valor_glosado: g.valorGlosado,
            valor_liberado: num(it['valor_apresentado']) - g.valorGlosado,
            situacao: g.valorGlosado === 0 ? 'liberado' : g.valorGlosado < num(it['valor_apresentado']) ? 'glosado_parcial' : 'glosado',
            justificativa: g.justificativa,
          });
          // A glosa anterior do item sai pela exclusão auditada (versão, trilha), linha a linha.
          const anteriores = await tx.consultarParaAtualizar(
            'SELECT id, versao FROM glosa_conta_recebida WHERE guia_conta_recebida_item_id = ? AND excluido_em IS NULL',
            [g.item],
          );
          for (const ant of anteriores) await tx.excluir('glosa_conta_recebida', num(ant['id']), num(ant['versao']));
          if (g.valorGlosado > 0) {
            const guia = num(it['guia_conta_recebida_id']);
            const seq = num((await tx.uma('SELECT MAX(sequencia) AS s FROM glosa_conta_recebida WHERE guia_conta_recebida_id = ?', [guia]))?.['s']) + 1;
            await tx.incluir('glosa_conta_recebida', {
              guia_conta_recebida_id: guia,
              sequencia: seq,
              guia_conta_recebida_item_id: g.item,
              motivo_glosa_id: g.motivo,
              valor_glosado: g.valorGlosado,
              fonte_glosa: 'auditoria_medica',
              justificativa: g.justificativa,
              glosado_em: new Date(),
              glosado_por_usuario_id: tx.contexto.usuario,
            });
          }
        }
        const versao = await recalcularLote(tx, a.id, a.versao);
        return { id: a.id, versao };
      },
      async concluir(a) {
        const x = await lote(a.id);
        if (txt(x['situacao']) !== 'recebida') throw recusa('conta-analisada', 'A análise desta conta já foi concluída.');
        const versao = await tx.alterar('lote_conta_recebida', a.id, a.versao, {
          situacao: a.situacao,
          auditor_usuario_id: tx.contexto.usuario,
          analisado_em: new Date(),
          observacao: a.observacao,
        });
        return { id: a.id, versao };
      },
      async devolver(a) {
        const x = await lote(a.id);
        if (txt(x['situacao']) !== 'recebida') throw recusa('conta-analisada', 'Só a conta em análise pode ser devolvida.');
        const versao = await tx.alterar('lote_conta_recebida', a.id, a.versao, {
          situacao: 'devolvida',
          devolvido_em: new Date(),
          motivo_devolucao: a.motivo.slice(0, 500),
        });
        return { id: a.id, versao };
      },
      async pagar(a) {
        const x = await lote(a.id);
        if (txt(x['situacao']) !== 'analisada') throw recusa('conta-nao-analisada', 'Só a conta analisada pode ser paga.');
        const versao = await tx.alterar('lote_conta_recebida', a.id, a.versao, {
          situacao: a.situacao,
          valor_pago: a.valor,
          pago_em: a.data,
          documento_pagamento: a.documento.slice(0, 60),
          // Transitório: a data e o documento do pagamento vão para a observação até as colunas pago_em e
          // documento_pagamento existirem (pedido de DDL na saída do lote 02-09); a ficha passa a ler a data da coluna.
          observacao: [txtOuNulo(x['observacao']), `Pagamento ${a.data}: ${a.documento}`].filter(Boolean).join('\n').slice(0, 2000),
        });
        return { id: a.id, versao };
      },
      registrarRecurso: () => pendente('Recurso de glosa da guia'),
      decidirRecurso: () => pendente('Decisão do recurso de glosa da guia'),
      registrarRecursoItens: () => pendente('Recurso de glosa por item'),
      decidirRecursoItens: () => pendente('Decisão do recurso de glosa por item'),
    };
  }
}

/** Soma as guias e o lote depois da glosa (a soma é do banco, na mesma transação). */
async function recalcularLote(tx: TxOperacao, lote: number, versao: number): Promise<number> {
  const guias = await tx.consultar(
    `SELECT g.id, g.versao, COALESCE(SUM(i.valor_glosado), 0) AS glosado, COALESCE(SUM(i.valor_apresentado), 0) AS apresentado
       FROM guia_conta_recebida g LEFT JOIN guia_conta_recebida_item i ON i.guia_conta_recebida_id = g.id AND i.excluido_em IS NULL
      WHERE g.lote_conta_recebida_id = ? AND g.excluido_em IS NULL GROUP BY g.id, g.versao`,
    [lote],
  );
  let glosado = 0;
  let apresentado = 0;
  for (const g of guias) {
    glosado += num(g['glosado']);
    apresentado += num(g['apresentado']);
    await tx.alterar('guia_conta_recebida', num(g['id']), num(g['versao']), {
      valor_glosado: num(g['glosado']),
      valor_liberado: num(g['apresentado']) - num(g['glosado']),
    });
  }
  return tx.alterar('lote_conta_recebida', lote, versao, {
    valor_glosado: Math.round(glosado * 100) / 100,
    valor_liberado: Math.round((apresentado - glosado) * 100) / 100,
  });
}

async function receberLote(
  tx: TxOperacao,
  est: number,
  r: Omit<EntradaRecebimentoConta, 'hospital'>,
): Promise<{ id: number; versao: number }> {
  await exigirOperadora(tx, est, r.operadora);
  const tipoGuia = await tx.uma(
    'SELECT id FROM tipo_guia_plano WHERE codigo = ? AND ativo = TRUE',
    [TIPO_GUIA(r.tipoGuia)],
  );
  if (!tipoGuia)
    throw recusa('tipo-guia-nao-cadastrado', `O tipo de guia "${r.tipoGuia}" não está cadastrado na operadora.`);
  const id = await tx.incluir('lote_conta_recebida', {
    estabelecimento_id: est,
    operadora_saude_id: r.operadora,
    prestador_rede_id: r.prestador,
    numero_protocolo: r.protocolo,
    numero_lote_prestador: r.numeroLote,
    tipo_guia: TIPO_GUIA(r.tipoGuia),
    competencia: primeiroDia(r.competencia),
    canal_envio: 'arquivo',
    hash_tiss: r.arquivo.hashEpilogo || r.arquivo.sha256,
    quantidade_guias: r.guias.length,
    valor_apresentado: r.apresentado,
    recebido_em: new Date(),
    prazo_pagamento: r.prazoPagamento,
    situacao: 'recebida',
  });
  const carater = new Map<string, number>();
  for (const g of r.guias) {
    let car: number | null = null;
    if (g.carater) {
      if (!carater.has(g.carater)) {
        const x = await tx.uma('SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?', [g.carater]);
        carater.set(g.carater, x ? num(x['id']) : 0);
      }
      car = carater.get(g.carater) || null;
    }
    const glosado = g.itens.reduce((s, i) => s + i.glosado, 0);
    const guia = await tx.incluir('guia_conta_recebida', {
      estabelecimento_id: est,
      lote_conta_recebida_id: id,
      ordem_lote: g.ordem,
      tipo_guia_plano_id: num(tipoGuia['id']),
      numero_guia_prestador: g.numeroGuiaPrestador,
      numero_guia_operadora: g.numeroGuiaOperadora,
      senha_autorizacao: g.senha,
      numero_carteira: g.carteirinha,
      beneficiario_plano_id: g.beneficiario,
      pedido_autorizacao_plano_id: g.autorizacao,
      prestador_rede_id: r.prestador,
      carater_atendimento_tiss_id: car,
      inicio_atendimento: g.inicio,
      fim_atendimento: g.fim,
      valor_apresentado: g.apresentado,
      valor_glosado: Math.min(glosado, g.apresentado),
      situacao: g.criticas.length ? 'criticada' : 'recebida',
      observacao: g.criticas.length ? g.criticas.join('\n').slice(0, 2000) : null,
    });
    for (const i of g.itens) {
      const termo = await tx.uma(
        `SELECT t.id FROM termo_terminologia t WHERE t.codigo_termo = ? AND t.ativo = TRUE
          ORDER BY t.id LIMIT 1`,
        [i.codigo],
      );
      if (!termo)
        throw recusa('item-nao-cadastrado', `O código ${i.codigo} da guia ${g.numeroGuiaPrestador} não está na terminologia.`);
      await tx.incluir('guia_conta_recebida_item', {
        guia_conta_recebida_id: guia,
        sequencia: i.sequencial,
        grupo: i.grupo,
        tipo_despesa: i.grupo === 'despesa' ? despesa(i.codigoDespesa) : null,
        procedimento_termo_terminologia_id: num(termo['id']),
        codigo_tabela_tiss: i.tabela.slice(0, 2),
        descricao: i.descricao.slice(0, 255),
        data_execucao: i.data,
        quantidade_apresentada: i.quantidade,
        percentual_reducao_acrescimo: Math.round((i.fator - 1) * 10000) / 100,
        valor_unitario_apresentado: i.valorUnitario,
        valor_apresentado: i.apresentado,
        valor_glosado: i.glosado,
        valor_liberado: i.apresentado - i.glosado,
        situacao: i.critica ? 'criticado' : i.glosado > 0 ? 'glosado_parcial' : 'apresentado',
        justificativa: (i.critica ?? i.justificativa)?.slice(0, 500) ?? null,
      });
    }
  }
  return { id, versao: 1 };
}

/** Código de despesa TISS (01 gases, 02 medicamentos, 03 materiais, 05 diárias, 07 taxas, 08 OPME) → tipo no banco. */
function despesa(codigo: string | null): string {
  const m: Readonly<Record<string, string>> = {
    '01': 'gases',
    '02': 'medicamento',
    '03': 'material',
    '05': 'diaria',
    '07': 'taxa',
    '08': 'opme',
  };
  return (codigo && m[codigo]) || 'material';
}
