// Porta própria da conferência das contas médicas recebidas (08-SGO linha 105, C1-100; F7) sobre o banco do cliente:
//   - regra_critica_conta: as regras de crítica que a operadora cadastra (procedimentos excludentes, combinação
//     rejeitada, glosa de referência, penalidade do prestador), aplicadas no recebimento do lote;
//   - critica_conta_recebida: as críticas de cada guia e item gravadas no recebimento (as padrão do domínio e as das
//     regras), nunca apagadas;
//   - auditoria_conta_recebida: o parecer da auditoria (administrativa, médica, de enfermagem), um registro por parecer;
//   - demonstrativo_analise_emitido: o registro de cada demonstrativo de análise entregue ao prestador (número, hash e
//     valores do momento; a nova emissão atualiza o registro com a versão e a trilha guarda o anterior).
// A regra vem do domínio (conta-conferencia.ts); o banco só guarda. Cada gravação é uma operação do Executor (trilha na
// mesma transação). O escopo é o estabelecimento da sessão e a operadora ligada a ele (fora, 404).
import { CRITICAS_CONTA, type CriticaConta, MENSAGENS_CONTAS } from '@sgh/contratos';
import {
  type CriticaDeRegra,
  type EntradaRegraCritica,
  normalizarCodigoRegra,
  problemasDaRegraCritica,
  problemasDoParecerAuditoria,
  type RegraCriticaConta,
  type ResultadoAuditoriaConta,
  type TipoAuditoriaConta,
  type TipoRegraCritica,
} from '@sgh/dominio-operadora';
import {
  definirOperacao,
  ErroOperacao,
  type Escritor,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  booleano,
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  inteiro,
  instanteIso,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
} from './apoio-banco.js';

export const PORTA_CONFERENCIA_CONTA = Symbol('PORTA_CONFERENCIA_CONTA_OPERADORA');

export const TABELAS_CONFERENCIA_CONTA = [
  'regra_critica_conta',
  'auditoria_conta_recebida',
  'demonstrativo_analise_emitido',
] as const;

export type Gravado = { readonly id: number; readonly versao: number };
type Trilha = (r: Gravado) => RegistroTrilhaTela;
type Problema = { codigo: string; campo?: string };

const TEXTO_PROBLEMA: Readonly<Record<string, string>> = {
  'codigo-invalido': 'Informe o código da regra (letras, números, ponto ou hífen; até 30).',
  'codigo-repetido': 'Já existe uma regra com este código na operadora.',
  'descricao-obrigatoria': 'Informe a descrição da regra (até 150 caracteres).',
  'tipo-invalido': 'Escolha o tipo.',
  'procedimento-obrigatorio': 'Escolha o procedimento da regra.',
  'relacionado-obrigatorio': 'Escolha o procedimento que não se cobra junto.',
  'relacionado-igual-ao-principal': 'O procedimento relacionado tem de ser outro.',
  'relacionado-sem-uso': 'Este tipo de regra não usa o procedimento relacionado.',
  'prestador-obrigatorio': 'Escolha o prestador da penalidade.',
  'percentual-invalido': 'O percentual vai de 0,01 a 100.',
  'percentual-obrigatorio': 'Informe o percentual da glosa.',
  'motivo-obrigatorio': 'Escolha o motivo de glosa padronizado.',
  'vigencia-invalida': 'Confira as datas da vigência (o fim não pode ser antes do início).',
  'conta-fora-da-analise': 'Só a conta em análise recebe parecer de auditoria.',
  'resultado-invalido': 'Escolha o resultado.',
  'parecer-obrigatorio': 'Escreva o parecer (pelo menos 10 caracteres).',
  'auditor-sem-categoria':
    'A auditoria médica é de médico e a de enfermagem, de enfermeiro designado nesta operadora.',
};
function exigir(problemas: readonly Problema[]): void {
  const p = problemas[0];
  if (p)
    throw recusa(p.codigo, TEXTO_PROBLEMA[p.codigo] ?? p.codigo, {
      campos: [...new Set(problemas.map((x) => x.campo).filter((x): x is string => !!x))],
    });
}
const naoEncontrado = (o = 'O registro') =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    `${o} não existe neste estabelecimento.`,
  );

/**
 * O número do demonstrativo é único na operadora (UNIQUE operadora + número), mas o protocolo da conta é sequencial por
 * estabelecimento: dois estabelecimentos da mesma operadora emitem o mesmo protocolo. O número leva o estabelecimento
 * à frente para que a reemissão de um nunca alcance o registro do outro.
 */
export function numeroDemonstrativo(est: number, protocolo: string): string {
  const n = `${est}-${protocolo.trim()}`;
  if (!protocolo.trim() || n.length > 20)
    throw recusa('numero-demonstrativo-invalido', 'O número do demonstrativo é inválido.', {
      campos: ['numero'],
    });
  return n;
}

// ── tipos lidos ─────────────────────────────────────────────────────────────────────────────────

export interface RegraCriticaLida {
  id: number;
  versao: number;
  codigo: string;
  descricao: string;
  tipo: TipoRegraCritica;
  principal: { id: number; codigo: string; descricao: string } | null;
  relacionado: { id: number; codigo: string; descricao: string } | null;
  prestador: { id: number; nome: string } | null;
  motivoGlosa: { id: number; codigo: string; descricao: string } | null;
  percentual: number | null;
  glosaAutomatica: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  ativo: boolean;
}
export interface ApoioRegras {
  procedimentos: { id: number; codigo: string; descricao: string }[];
  motivos: { id: number; codigo: string; descricao: string }[];
  prestadores: { id: number; nome: string }[];
}
export interface CriticaLida {
  id: number;
  guia: number;
  numeroGuia: string;
  item: number | null;
  itemCodigo: string | null;
  regra: { id: number; codigo: string } | null;
  motivoGlosa: string | null;
  descricao: string;
  tipo: 'critica' | 'alerta' | 'glosa';
  ocorridaEm: string;
}
export interface AuditoriaLida {
  id: number;
  guia: number;
  numeroGuia: string;
  item: number | null;
  tipo: TipoAuditoriaConta;
  resultado: ResultadoAuditoriaConta;
  parecer: string;
  motivoGlosa: string | null;
  auditor: string | null;
  registradaEm: string;
}
export interface DemonstrativoEmitidoLido {
  id: number;
  versao: number;
  numero: string;
  emitidoEm: string;
  informado: number;
  liberado: number;
  glosa: number;
  situacao: string;
  emissoes: number;
}
export interface ConferenciaConta {
  criticas: CriticaLida[];
  auditorias: AuditoriaLida[];
  demonstrativos: DemonstrativoEmitidoLido[];
}
export interface EntradaAuditoria {
  guia: number;
  item: number | null;
  tipo: TipoAuditoriaConta;
  resultado: ResultadoAuditoriaConta;
  parecer: string;
  motivoGlosa: number | null;
}
export interface EntradaDemonstrativoEmitido {
  numero: string;
  protocolo: string;
  hash: string;
  informado: number;
  liberado: number;
  glosa: number;
}

const esquemaEntrada = z.record(z.string(), z.unknown());

// ── apoio usado também no recebimento (contas-porta-propria) ────────────────────────────────────

/** As regras ativas da operadora, com os procedimentos pelo código TUSS (o que a conferência compara). */
export async function regrasDaOperadora(l: Leitor, operadora: number): Promise<RegraCriticaConta[]> {
  const linhas = await l.consultar(
    `SELECT r.id, r.codigo, r.descricao, r.tipo_regra, r.prestador_rede_id, r.motivo_glosa_id, r.percentual_glosa,
            r.glosa_automatica, r.vigencia_inicio, r.vigencia_fim, r.ativo,
            tp.codigo_termo AS principal, tr.codigo_termo AS relacionado
       FROM regra_critica_conta r
       LEFT JOIN item_faturavel ip ON ip.id = r.item_faturavel_id
       LEFT JOIN termo_terminologia tp ON tp.id = ip.termo_terminologia_id
       LEFT JOIN item_faturavel ir ON ir.id = r.relacionado_item_faturavel_id
       LEFT JOIN termo_terminologia tr ON tr.id = ir.termo_terminologia_id
      WHERE r.operadora_saude_id = ? AND r.ativo = TRUE
      ORDER BY r.id`,
    [operadora],
  );
  return linhas.map((r) => ({
    id: inteiro(r['id'])!,
    codigo: textoObrigatorio(r['codigo']),
    descricao: textoObrigatorio(r['descricao']),
    tipo: textoObrigatorio(r['tipo_regra']) as TipoRegraCritica,
    principal: texto(r['principal']),
    relacionado: texto(r['relacionado']),
    prestador: inteiro(r['prestador_rede_id']),
    motivoGlosa: inteiro(r['motivo_glosa_id']),
    percentual: numero(r['percentual_glosa']),
    glosaAutomatica: booleano(r['glosa_automatica']),
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '0000-01-01',
    vigenciaFim: dataIso(r['vigencia_fim']),
    ativo: booleano(r['ativo']),
  }));
}

/**
 * Grava as críticas de uma guia recebida (na transação do recebimento): as padrão do domínio, no nível da guia, com o
 * motivo da terminologia quando existe, e as das regras, no item. A sequência é por guia.
 */
export async function gravarCriticasDaGuia(
  tx: TxOperacao,
  guia: number,
  itens: readonly number[],
  padrao: readonly string[],
  deRegras: readonly CriticaDeRegra[],
): Promise<number> {
  const motivo = new Map<string, number | null>();
  const motivoDe = async (codigo: string): Promise<number | null> => {
    if (!motivo.has(codigo)) {
      const m = await tx.uma('SELECT id FROM motivo_glosa WHERE codigo_tuss = ? ORDER BY id LIMIT 1', [
        codigo,
      ]);
      motivo.set(codigo, m ? inteiro(m['id']) : null);
    }
    return motivo.get(codigo) ?? null;
  };
  let sequencia = 0;
  const agora = new Date();
  for (const c of padrao) {
    const m = CRITICAS_CONTA[c as CriticaConta]?.motivo;
    await tx.incluir('critica_conta_recebida', {
      guia_conta_recebida_id: guia,
      sequencia: ++sequencia,
      guia_conta_recebida_item_id: null,
      regra_critica_conta_id: null,
      motivo_glosa_id: m ? await motivoDe(String(m)) : null,
      descricao: (MENSAGENS_CONTAS[c] ?? c).slice(0, 2000),
      tipo_ocorrencia: 'critica',
      forma_registro: 'automatica',
      glosa_parcial: false,
      ocorrido_em: agora,
    });
  }
  for (const c of deRegras) {
    await tx.incluir('critica_conta_recebida', {
      guia_conta_recebida_id: guia,
      sequencia: ++sequencia,
      guia_conta_recebida_item_id: c.indice === null ? null : (itens[c.indice] ?? null),
      regra_critica_conta_id: c.regra,
      motivo_glosa_id: c.motivoGlosa,
      descricao: c.descricao,
      tipo_ocorrencia: c.tipo,
      forma_registro: 'automatica',
      glosa_parcial: c.tipo === 'glosa',
      ocorrido_em: agora,
    });
  }
  return sequencia;
}

// ── a porta ─────────────────────────────────────────────────────────────────────────────────────

export class PortaConferenciaContaPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora & Pick<NucleoProprio, 'escrever'>,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-conferencia-conta' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        return fn(l, est);
      },
    );
  }

  private async gravar(
    c: ContextoPorta,
    nome: string,
    tabela: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number) => Promise<Gravado>,
  ): Promise<Gravado> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, Gravado>({
      nome,
      tabelas: TABELAS_CONFERENCIA_CONTA,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: (tx) => fn(tx, est),
      alvo: (_e, r) => ({ tabela, id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const r = await this.executor.executar(
      operacao,
      this.cliente,
      {},
      contextoDireto(this.cliente, est, c, null),
    );
    return r.resultado;
  }

  private static async operadoraDoEst(l: Leitor | Escritor, est: number, op: number): Promise<void> {
    const x = await l.uma(
      `SELECT 1 AS ok FROM operadora_saude_estabelecimento
        WHERE operadora_saude_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [op, est],
    );
    if (!x) throw naoEncontrado('A operadora');
  }

  private static async loteDoEst(
    l: Leitor | Escritor,
    est: number,
    lote: number,
  ): Promise<{ operadora: number; prestador: number; situacao: string }> {
    const x = await l.uma(
      `SELECT operadora_saude_id, prestador_rede_id, situacao FROM lote_conta_recebida
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [lote, est],
    );
    if (!x) throw naoEncontrado('A conta');
    return {
      operadora: inteiro(x['operadora_saude_id'])!,
      prestador: inteiro(x['prestador_rede_id'])!,
      situacao: textoObrigatorio(x['situacao']),
    };
  }

  // ── regras ──
  regras(c: ContextoPorta, op: number): Promise<RegraCriticaLida[]> {
    return this.ler(c, async (l, est) => {
      await PortaConferenciaContaPropria.operadoraDoEst(l, est, op);
      const linhas = await l.consultar(
        `SELECT r.id, r.versao, r.codigo, r.descricao, r.tipo_regra, r.percentual_glosa, r.glosa_automatica,
                r.vigencia_inicio, r.vigencia_fim, r.ativo,
                ip.id AS p_id, tp.codigo_termo AS p_codigo, ip.descricao AS p_descricao,
                ir.id AS r_id, tr.codigo_termo AS r_codigo, ir.descricao AS r_descricao,
                pr.id AS pr_id, pr.nome AS pr_nome,
                m.id AS m_id, m.codigo_tuss AS m_codigo, m.descricao AS m_descricao
           FROM regra_critica_conta r
           LEFT JOIN item_faturavel ip ON ip.id = r.item_faturavel_id
           LEFT JOIN termo_terminologia tp ON tp.id = ip.termo_terminologia_id
           LEFT JOIN item_faturavel ir ON ir.id = r.relacionado_item_faturavel_id
           LEFT JOIN termo_terminologia tr ON tr.id = ir.termo_terminologia_id
           LEFT JOIN prestador_rede pr ON pr.id = r.prestador_rede_id
           LEFT JOIN motivo_glosa m ON m.id = r.motivo_glosa_id
          WHERE r.operadora_saude_id = ?
          ORDER BY r.ativo DESC, r.codigo`,
        [op],
      );
      const par = (id: unknown, codigo: unknown, descricao: unknown) =>
        inteiro(id) === null
          ? null
          : { id: inteiro(id)!, codigo: textoObrigatorio(codigo), descricao: textoObrigatorio(descricao) };
      return linhas.map((r) => ({
        id: inteiro(r['id'])!,
        versao: inteiro(r['versao'])!,
        codigo: textoObrigatorio(r['codigo']),
        descricao: textoObrigatorio(r['descricao']),
        tipo: textoObrigatorio(r['tipo_regra']) as TipoRegraCritica,
        principal: par(r['p_id'], r['p_codigo'], r['p_descricao']),
        relacionado: par(r['r_id'], r['r_codigo'], r['r_descricao']),
        prestador:
          inteiro(r['pr_id']) === null
            ? null
            : { id: inteiro(r['pr_id'])!, nome: textoObrigatorio(r['pr_nome']) },
        motivoGlosa: par(r['m_id'], r['m_codigo'], r['m_descricao']),
        percentual: numero(r['percentual_glosa']),
        glosaAutomatica: booleano(r['glosa_automatica']),
        vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '',
        vigenciaFim: dataIso(r['vigencia_fim']),
        ativo: booleano(r['ativo']),
      }));
    });
  }

  apoio(c: ContextoPorta, op: number): Promise<ApoioRegras> {
    return this.ler(c, async (l, est) => {
      await PortaConferenciaContaPropria.operadoraDoEst(l, est, op);
      const [procedimentos, motivos, prestadores] = await Promise.all([
        l.consultar(
          `SELECT i.id, t.codigo_termo AS codigo, i.descricao FROM item_faturavel i
             JOIN termo_terminologia t ON t.id = i.termo_terminologia_id
            WHERE i.excluido_em IS NULL ORDER BY t.codigo_termo LIMIT 2000`,
        ),
        l.consultar(
          `SELECT id, codigo_tuss AS codigo, descricao FROM motivo_glosa
            WHERE vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE ORDER BY codigo_tuss`,
        ),
        l.consultar(
          `SELECT id, nome FROM prestador_rede
            WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome LIMIT 2000`,
          [est],
        ),
      ]);
      const cod = (x: Record<string, unknown>) => ({
        id: inteiro(x['id'])!,
        codigo: textoObrigatorio(x['codigo']),
        descricao: textoObrigatorio(x['descricao']),
      });
      return {
        procedimentos: procedimentos.map(cod),
        motivos: motivos.map(cod),
        prestadores: prestadores.map((x) => ({ id: inteiro(x['id'])!, nome: textoObrigatorio(x['nome']) })),
      };
    });
  }

  incluirRegra(c: ContextoPorta, op: number, e: EntradaRegraCritica, trilha: Trilha): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.conta.regra-critica.incluir',
      'regra_critica_conta',
      trilha,
      async (tx, est) => {
        await PortaConferenciaContaPropria.operadoraDoEst(tx, est, op);
        const existentes = await tx.consultar(
          'SELECT codigo FROM regra_critica_conta WHERE operadora_saude_id = ?',
          [op],
        );
        exigir(
          problemasDaRegraCritica(
            e,
            existentes.map((x) => textoObrigatorio(x['codigo'])),
          ),
        );
        for (const [campo, id] of [
          ['principal', e.principal],
          ['relacionado', e.relacionado],
        ] as const)
          if (
            id !== null &&
            !(await tx.uma('SELECT id FROM item_faturavel WHERE id = ? AND excluido_em IS NULL', [id]))
          )
            throw recusa('procedimento-inexistente', 'O procedimento escolhido não existe.', {
              campos: [campo],
            });
        if (
          e.prestador !== null &&
          !(await tx.uma('SELECT id FROM prestador_rede WHERE id = ? AND estabelecimento_id = ?', [
            e.prestador,
            est,
          ]))
        )
          throw recusa('prestador-inexistente', 'O prestador não é da rede deste estabelecimento.', {
            campos: ['prestador'],
          });
        const id = await tx.incluir('regra_critica_conta', {
          operadora_saude_id: op,
          codigo: normalizarCodigoRegra(e.codigo),
          descricao: e.descricao.trim(),
          tipo_regra: e.tipo,
          item_faturavel_id: e.principal,
          relacionado_item_faturavel_id: e.relacionado,
          prestador_rede_id: e.prestador,
          motivo_glosa_id: e.motivoGlosa,
          percentual_glosa: e.percentual,
          glosa_automatica: e.glosaAutomatica,
          vigencia_inicio: e.vigenciaInicio,
          vigencia_fim: e.vigenciaFim,
          ativo: true,
        });
        return { id, versao: 1 };
      },
    );
  }

  /** Tira de uso ou volta (nunca apaga: as críticas já gravadas continuam ligadas à regra). */
  situacaoRegra(
    c: ContextoPorta,
    id: number,
    versao: number,
    ativo: boolean,
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.conta.regra-critica.situacao',
      'regra_critica_conta',
      trilha,
      async (tx, est) => {
        const r = await tx.uma('SELECT operadora_saude_id FROM regra_critica_conta WHERE id = ?', [id]);
        if (!r) throw naoEncontrado('A regra');
        await PortaConferenciaContaPropria.operadoraDoEst(tx, est, inteiro(r['operadora_saude_id'])!);
        return { id, versao: await tx.alterar('regra_critica_conta', id, versao, { ativo }) };
      },
    );
  }

  // ── conferência da conta ──
  conferencia(c: ContextoPorta, lote: number): Promise<ConferenciaConta> {
    return this.ler(c, async (l, est) => {
      await PortaConferenciaContaPropria.loteDoEst(l, est, lote);
      const [criticas, auditorias, demonstrativos] = await Promise.all([
        l.consultar(
          `SELECT c.id, c.guia_conta_recebida_id, g.numero_guia_prestador, c.guia_conta_recebida_item_id,
                  t.codigo_termo AS item_codigo, r.id AS regra_id, r.codigo AS regra_codigo, m.codigo_tuss AS motivo,
                  c.descricao, c.tipo_ocorrencia, c.ocorrido_em
             FROM critica_conta_recebida c
             JOIN guia_conta_recebida g ON g.id = c.guia_conta_recebida_id
             LEFT JOIN guia_conta_recebida_item i ON i.id = c.guia_conta_recebida_item_id
             LEFT JOIN termo_terminologia t ON t.id = i.procedimento_termo_terminologia_id
             LEFT JOIN regra_critica_conta r ON r.id = c.regra_critica_conta_id
             LEFT JOIN motivo_glosa m ON m.id = c.motivo_glosa_id
            WHERE g.lote_conta_recebida_id = ? AND c.excluido_em IS NULL
            ORDER BY g.ordem_lote, c.sequencia`,
          [lote],
        ),
        l.consultar(
          `SELECT a.id, a.guia_conta_recebida_id, g.numero_guia_prestador, a.guia_conta_recebida_item_id,
                  a.tipo_auditoria, a.resultado, a.parecer, m.codigo_tuss AS motivo, u.login, a.criado_em
             FROM auditoria_conta_recebida a
             JOIN guia_conta_recebida g ON g.id = a.guia_conta_recebida_id
             LEFT JOIN motivo_glosa m ON m.id = a.motivo_glosa_id
             LEFT JOIN usuario u ON u.id = a.criado_por
            WHERE g.lote_conta_recebida_id = ? AND a.excluido_em IS NULL
            ORDER BY a.criado_em DESC, a.id DESC`,
          [lote],
        ),
        l.consultar(
          `SELECT id, versao, numero_demonstrativo, emitido_em, valor_informado, valor_liberado, valor_glosa, situacao
             FROM demonstrativo_analise_emitido
            WHERE lote_conta_recebida_id = ? AND excluido_em IS NULL ORDER BY emitido_em DESC`,
          [lote],
        ),
      ]);
      return {
        criticas: criticas.map((x) => ({
          id: inteiro(x['id'])!,
          guia: inteiro(x['guia_conta_recebida_id'])!,
          numeroGuia: textoObrigatorio(x['numero_guia_prestador']),
          item: inteiro(x['guia_conta_recebida_item_id']),
          itemCodigo: texto(x['item_codigo']),
          regra:
            inteiro(x['regra_id']) === null
              ? null
              : { id: inteiro(x['regra_id'])!, codigo: textoObrigatorio(x['regra_codigo']) },
          motivoGlosa: texto(x['motivo']),
          descricao: textoObrigatorio(x['descricao']),
          tipo: textoObrigatorio(x['tipo_ocorrencia']) as CriticaLida['tipo'],
          ocorridaEm: instanteIso(x['ocorrido_em']) ?? '',
        })),
        auditorias: auditorias.map((x) => ({
          id: inteiro(x['id'])!,
          guia: inteiro(x['guia_conta_recebida_id'])!,
          numeroGuia: textoObrigatorio(x['numero_guia_prestador']),
          item: inteiro(x['guia_conta_recebida_item_id']),
          tipo: textoObrigatorio(x['tipo_auditoria']) as TipoAuditoriaConta,
          resultado: textoObrigatorio(x['resultado']) as ResultadoAuditoriaConta,
          parecer: textoObrigatorio(x['parecer']),
          motivoGlosa: texto(x['motivo']),
          auditor: texto(x['login']),
          registradaEm: instanteIso(x['criado_em']) ?? '',
        })),
        demonstrativos: demonstrativos.map((x) => ({
          id: inteiro(x['id'])!,
          versao: inteiro(x['versao'])!,
          numero: textoObrigatorio(x['numero_demonstrativo']),
          emitidoEm: instanteIso(x['emitido_em']) ?? '',
          informado: numero(x['valor_informado']) ?? 0,
          liberado: numero(x['valor_liberado']) ?? 0,
          glosa: numero(x['valor_glosa']) ?? 0,
          situacao: textoObrigatorio(x['situacao']),
          emissoes: inteiro(x['versao'])!,
        })),
      };
    });
  }

  /** O parecer da auditoria numa guia (ou num item) da conta em análise; o auditor é quem está na sessão. */
  registrarAuditoria(c: ContextoPorta, lote: number, e: EntradaAuditoria, trilha: Trilha): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.conta.auditoria.registrar',
      'auditoria_conta_recebida',
      trilha,
      async (tx, est) => {
        const conta = await PortaConferenciaContaPropria.loteDoEst(tx, est, lote);
        const g = await tx.uma(
          'SELECT id FROM guia_conta_recebida WHERE id = ? AND lote_conta_recebida_id = ?',
          [e.guia, lote],
        );
        if (!g) throw naoEncontrado('A guia');
        if (
          e.item !== null &&
          !(await tx.uma(
            'SELECT id FROM guia_conta_recebida_item WHERE id = ? AND guia_conta_recebida_id = ?',
            [e.item, e.guia],
          ))
        )
          throw naoEncontrado('O item');
        const auditor = await tx.uma(
          `SELECT id, categoria FROM auditor_plano
          WHERE usuario_id = ? AND operadora_saude_id = ? AND excluido_em IS NULL
            AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)
          ORDER BY id LIMIT 1`,
          [tx.contexto.usuario, conta.operadora],
        );
        const cat = textoObrigatorio(auditor?.['categoria']).toLowerCase();
        exigir(
          problemasDoParecerAuditoria({
            tipo: e.tipo,
            resultado: e.resultado,
            parecer: e.parecer,
            motivoGlosa: e.motivoGlosa,
            situacaoConta: conta.situacao,
            categoriaAuditor: !auditor
              ? null
              : cat.startsWith('enferm')
                ? 'enfermeiro'
                : cat.startsWith('med')
                  ? 'medico'
                  : null,
          }),
        );
        const seq = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM auditoria_conta_recebida WHERE guia_conta_recebida_id = ?',
          [e.guia],
        );
        const id = await tx.incluir('auditoria_conta_recebida', {
          guia_conta_recebida_id: e.guia,
          sequencia: inteiro(seq?.['s']) ?? 1,
          tipo_auditoria: e.tipo,
          momento: 'analise_conta',
          guia_conta_recebida_item_id: e.item,
          motivo_glosa_id: e.motivoGlosa,
          auditor_plano_id: auditor ? inteiro(auditor['id']) : null,
          parecer: e.parecer.trim(),
          resultado: e.resultado,
          liberado_em: e.resultado === 'pendente' ? null : new Date(),
          liberado_por_usuario_id: e.resultado === 'pendente' ? null : tx.contexto.usuario,
          lancamento_manual: true,
        });
        return { id, versao: 1 };
      },
    );
  }

  /**
   * O demonstrativo de análise entregue: a primeira emissão inclui o registro; a reemissão (o mesmo número, do mesmo
   * estabelecimento e da mesma conta) atualiza os valores e o instante com a versão (a trilha guarda o que saiu antes).
   * O número achado em outra conta é recusado, nunca sobrescrito. Nada é apagado.
   */
  registrarDemonstrativo(
    c: ContextoPorta,
    lote: number,
    e: EntradaDemonstrativoEmitido,
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(
      c,
      'operadora.conta.demonstrativo.registrar',
      'demonstrativo_analise_emitido',
      trilha,
      async (tx, est) => {
        const conta = await PortaConferenciaContaPropria.loteDoEst(tx, est, lote);
        const valores = {
          emitido_em: new Date(),
          valor_informado: e.informado,
          valor_processado: e.informado,
          valor_liberado: e.liberado,
          valor_glosa: e.glosa,
          situacao: 'enviado',
        };
        const numero = numeroDemonstrativo(est, e.numero);
        const ja = await tx.uma(
          `SELECT id, versao, estabelecimento_id, lote_conta_recebida_id FROM demonstrativo_analise_emitido
            WHERE operadora_saude_id = ? AND numero_demonstrativo = ?`,
          [conta.operadora, numero],
        );
        if (
          ja &&
          (inteiro(ja['estabelecimento_id']) !== est || inteiro(ja['lote_conta_recebida_id']) !== lote)
        )
          throw recusa(
            'demonstrativo-de-outra-conta',
            'O número do demonstrativo já pertence a outra conta desta operadora.',
            { campos: ['numero'] },
          );
        if (ja) {
          const id = inteiro(ja['id'])!;
          return {
            id,
            versao: await tx.alterar('demonstrativo_analise_emitido', id, inteiro(ja['versao'])!, valores),
          };
        }
        const id = await tx.incluir('demonstrativo_analise_emitido', {
          estabelecimento_id: est,
          operadora_saude_id: conta.operadora,
          prestador_rede_id: conta.prestador,
          numero_demonstrativo: numero,
          lote_conta_recebida_id: lote,
          numero_protocolo: e.protocolo,
          ...valores,
        });
        return { id, versao: 1 };
      },
    );
  }
}

export const METODOS_CONFERENCIA_CONTA: ReadonlySet<string> = new Set([
  'regras',
  'apoio',
  'incluirRegra',
  'situacaoRegra',
  'conferencia',
  'registrarAuditoria',
  'registrarDemonstrativo',
]);
