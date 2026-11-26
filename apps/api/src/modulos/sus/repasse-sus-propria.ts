// Repasse da produção SUS aos profissionais (F7, 06-SUS linha 62), no banco do cliente. As regras são as puras de
// @sgh/dominio-repasse (producao-sus.ts); aqui ficam a leitura e a gravação. Contrato de efeito
// (repasse-sus-propria.int.spec.ts):
//   - regra do repasse SUS (regra_repasse_sus) e regra do rateio do SADT da AIH (regra_rateio_sadt_aih): incluídas
//     com a conferência do domínio; procedimento, grupo e ocupação pelo código; código e início repetidos recusados;
//     encerrar grava o fim da vigência na versão vista, nada é apagado;
//   - apurar: só na apuração do repasse do estabelecimento em apuração; a base é a produção APROVADA da competência
//     (folhas do BPA processadas, APAC aprovadas, contas da AIH aprovadas com a equipe de conta_aih_profissional); as
//     linhas anteriores do sistema na apuração ficam excluídas (excluido_em/excluido_por) e as novas entram na sequência
//     seguinte em producao_repasse_sus; o SADT da AIH (procedimento sem equipe nem executante) é rateado pelas regras
//     de rateio; a versão da apuração sobe. Ato sem executante ou sem regra volta como pendência, sem linha.
// A trilha de cada gravação vai pelo executor (mesma transação).
import {
  type AtoProducaoSus,
  apurarProducaoSus,
  BASES_REPASSE_SUS,
  conferirRateioSadt,
  conferirRegraSus,
  MODALIDADES_REPASSE_SUS,
  PAPEIS_REGRA_SUS,
  papelDaAtividadeAih,
  type ParticipanteSadt,
  type PendenciaRepasseSus,
  type RegraRateioSadtAih,
  type RegraRepasseSus,
} from '@sgh/dominio-repasse';
import { ErroOperacao, type Leitor, type Linha } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_REPASSE_SUS = Symbol('PORTA_REPASSE_SUS');
const TABELAS = [
  'regra_repasse_sus',
  'regra_rateio_sadt_aih',
  'producao_repasse_sus',
  'apuracao_repasse',
] as const;

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const codigoOuNull = z.string().trim().max(20).nullable().optional();
const pct = z.number().min(0).max(100).nullable().optional();
const esquemaRegra = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    modalidade: z.enum(MODALIDADES_REPASSE_SUS),
    procedimento: codigoOuNull,
    grupo: codigoOuNull,
    ocupacao: codigoOuNull,
    papel: z.enum(PAPEIS_REGRA_SUS).default('todos'),
    base: z.enum(BASES_REPASSE_SUS),
    percentualPago: pct,
    percentualDesconto: pct,
    valorFixo: z.number().min(0).nullable().optional(),
    valorDesconto: z.number().min(0).nullable().optional(),
    valorPonto: z.number().min(0).nullable().optional(),
    prioridade: z.number().int().min(0).max(65535).default(100),
    inicio: dia,
    fim: dia.nullable().optional(),
  })
  .strict();
const esquemaRateio = z
  .object({
    procedimento: codigoOuNull,
    grupo: codigoOuNull,
    profissional: z.number().int().positive().nullable().optional(),
    consideraSadt: z.boolean().default(true),
    usaPeso: z.boolean().default(false),
    pesoPercentual: pct,
    tetoPercentual: pct,
    inicio: dia,
    fim: dia.nullable().optional(),
  })
  .strict();
const esquemaEncerrar = z.object({ versao: z.number().int().positive(), fim: dia }).strict();
const esquemaApurar = z.object({ versao: z.number().int().positive() }).strict();

export interface RegraRepasseSusLida extends RegraRepasseSus {
  readonly descricao: string;
  readonly procedimentoCodigo: string | null;
  readonly grupoCodigo: string | null;
  readonly ocupacaoCodigo: string | null;
  readonly versao: number;
}
export interface RateioSadtLido extends RegraRateioSadtAih {
  readonly procedimentoCodigo: string | null;
  readonly grupoCodigo: string | null;
  readonly versao: number;
}
export interface ApuracaoAberta {
  readonly id: number;
  readonly numero: string;
  readonly competencia: string;
  readonly versao: number;
}
export interface LinhaRepasseSusLida {
  readonly sequencia: number;
  readonly instrumento: string;
  readonly executante: number;
  readonly executanteNome: string;
  readonly papel: string;
  readonly regraCodigo: string | null;
  readonly base: number;
  readonly percentual: number | null;
  readonly glosa: number;
  readonly repasse: number;
}
export interface ResumoApuracaoSus {
  readonly apuracao: number;
  readonly competencia: string;
  readonly linhas: number;
  readonly excluidas: number;
  readonly totalRepasse: number;
  readonly totalGlosa: number;
  readonly pendencias: readonly PendenciaRepasseSus[];
  readonly versao: number;
}

const textoOuNull = (v: string | null | undefined) => (v && v.trim() !== '' ? v.trim() : null);
const dataTxt = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const competenciaDe = (v: unknown) => (dataTxt(v) ?? '').slice(0, 7).replace('-', '');

function regraDaLinha(x: Linha): RegraRepasseSusLida {
  return {
    id: num(x['id']),
    codigo: String(x['codigo']),
    descricao: String(x['descricao']),
    modalidade: String(x['modalidade']) as RegraRepasseSus['modalidade'],
    procedimento: numOuNull(x['procedimento_sigtap_id']),
    procedimentoCodigo: txtOuNull(x['procedimento_codigo']),
    grupo: numOuNull(x['grupo_sigtap_id']),
    grupoCodigo: txtOuNull(x['grupo_codigo']),
    ocupacao: numOuNull(x['ocupacao_cbo_id']),
    ocupacaoCodigo: txtOuNull(x['ocupacao_codigo']),
    papel: String(x['papel']) as RegraRepasseSus['papel'],
    base: String(x['base_calculo']) as RegraRepasseSus['base'],
    percentualPago: numOuNull(x['percentual_pago']),
    percentualDesconto: numOuNull(x['percentual_desconto']),
    valorFixo: numOuNull(x['valor_fixo']),
    valorDesconto: numOuNull(x['valor_desconto']),
    valorPonto: numOuNull(x['valor_ponto']),
    prioridade: num(x['prioridade']),
    inicio: dataTxt(x['vigencia_inicio']) ?? '',
    fim: dataTxt(x['vigencia_fim']),
    ativo: bool(x['ativo']),
    versao: num(x['versao']),
  };
}

function rateioDaLinha(x: Linha): RateioSadtLido {
  return {
    id: num(x['id']),
    procedimento: numOuNull(x['procedimento_sigtap_id']),
    procedimentoCodigo: txtOuNull(x['procedimento_codigo']),
    grupo: numOuNull(x['grupo_sigtap_id']),
    grupoCodigo: txtOuNull(x['grupo_codigo']),
    profissional: numOuNull(x['profissional_id']),
    consideraSadt: bool(x['considera_sadt']),
    usaPeso: bool(x['usa_peso']),
    pesoPercentual: numOuNull(x['peso_percentual']),
    tetoPercentual: numOuNull(x['teto_percentual']),
    inicio: dataTxt(x['vigencia_inicio']) ?? '',
    fim: dataTxt(x['vigencia_fim']),
    ativo: bool(x['ativo']),
    versao: num(x['versao']),
  };
}

async function regras(l: Leitor, est: number): Promise<RegraRepasseSusLida[]> {
  const xs = await l.consultar(
    `SELECT r.*, ps.codigo_sigtap AS procedimento_codigo, g.codigo_sigtap AS grupo_codigo, o.codigo_cbo AS ocupacao_codigo
       FROM regra_repasse_sus r
       LEFT JOIN procedimento_sigtap ps ON ps.id = r.procedimento_sigtap_id
       LEFT JOIN grupo_sigtap g ON g.id = r.grupo_sigtap_id
       LEFT JOIN ocupacao_cbo o ON o.id = r.ocupacao_cbo_id
      WHERE r.estabelecimento_id = ? ORDER BY r.prioridade, r.codigo, r.vigencia_inicio`,
    [est],
  );
  return xs.map(regraDaLinha);
}

async function rateios(l: Leitor, est: number): Promise<RateioSadtLido[]> {
  const xs = await l.consultar(
    `SELECT r.*, ps.codigo_sigtap AS procedimento_codigo, g.codigo_sigtap AS grupo_codigo
       FROM regra_rateio_sadt_aih r
       LEFT JOIN procedimento_sigtap ps ON ps.id = r.procedimento_sigtap_id
       LEFT JOIN grupo_sigtap g ON g.id = r.grupo_sigtap_id
      WHERE r.estabelecimento_id = ? ORDER BY r.vigencia_inicio, r.id`,
    [est],
  );
  return xs.map(rateioDaLinha);
}

/** Código → id (procedimento e grupo da tabela unificada, ocupação do CBO); código desconhecido recusa. */
async function idPeloCodigo(
  l: Leitor,
  tipo: 'procedimento' | 'grupo' | 'ocupacao',
  codigo: string | null,
): Promise<number | null> {
  if (codigo === null) return null;
  const sql = {
    procedimento:
      'SELECT id FROM procedimento_sigtap WHERE codigo_sigtap = ? ORDER BY vigencia_inicio DESC LIMIT 1',
    grupo: 'SELECT id FROM grupo_sigtap WHERE codigo_sigtap = ? LIMIT 1',
    ocupacao: 'SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ? LIMIT 1',
  }[tipo];
  const x = await l.uma(sql, [codigo]);
  if (!x)
    throw recusaRegra('Código não encontrado', [{ campo: tipo, mensagem: `O código ${codigo} não existe.` }]);
  return num(x['id']);
}

const fracao = (aprovado: unknown, apresentado: unknown) => {
  const ap = numOuNull(aprovado);
  const tot = num(apresentado);
  return ap === null || tot <= 0 ? 1 : Math.min(1, ap / tot);
};

/** A produção aprovada da competência (AAAAMM): atos do BPA, da APAC e da AIH, e o SADT de cada AIH. */
export async function producaoAprovada(
  l: Leitor,
  est: number,
  competencia: string,
): Promise<{
  atos: AtoProducaoSus[];
  sadt: { valor: number; fracaoAprovada: number; participantes: ParticipanteSadt[] }[];
}> {
  const atos: AtoProducaoSus[] = [];
  const bpa = await l.consultar(
    `SELECT i.id, i.procedimento_sigtap_id, ps.grupo_sigtap_id, i.ocupacao_cbo_id, i.profissional_id, i.quantidade,
            i.valor_servico_ambulatorial, i.valor_servico_profissional, i.valor_total
       FROM producao_ambulatorial_sus_item i
       JOIN producao_ambulatorial_sus f ON f.id = i.producao_ambulatorial_sus_id
       JOIN competencia_sus c ON c.id = f.competencia_sus_id
       JOIN procedimento_sigtap ps ON ps.id = i.procedimento_sigtap_id
      WHERE f.estabelecimento_id = ? AND c.competencia = ? AND f.situacao = 'processada'
        AND f.excluido_em IS NULL AND i.excluido_em IS NULL
      ORDER BY f.id, i.sequencia`,
    [est, competencia],
  );
  for (const x of bpa)
    atos.push({
      instrumento: 'bpa',
      origem: num(x['id']),
      procedimento: num(x['procedimento_sigtap_id']),
      grupo: numOuNull(x['grupo_sigtap_id']),
      ocupacao: numOuNull(x['ocupacao_cbo_id']),
      executante: numOuNull(x['profissional_id']),
      papel: 'executante',
      quantidade: num(x['quantidade']),
      pontos: null,
      servicoProfissional: num(x['valor_servico_profissional']),
      servicoHospitalar: 0,
      servicoAmbulatorial: num(x['valor_servico_ambulatorial']),
      total: num(x['valor_total']),
      fracaoAprovada: 1,
    });
  const apac = await l.consultar(
    `SELECT p.id, p.procedimento_sigtap_id, ps.grupo_sigtap_id, p.ocupacao_cbo_id, p.executante_profissional_id,
            p.quantidade, p.valor_total, a.valor_aprovado, a.valor_apresentado
       FROM apac_procedimento p
       JOIN apac a ON a.id = p.apac_id
       JOIN competencia_sus c ON c.id = a.competencia_sus_id
       JOIN procedimento_sigtap ps ON ps.id = p.procedimento_sigtap_id
      WHERE a.estabelecimento_id = ? AND c.competencia = ? AND a.situacao = 'aprovada'
        AND a.excluido_em IS NULL AND p.excluido_em IS NULL
      ORDER BY a.id, p.sequencia`,
    [est, competencia],
  );
  for (const x of apac)
    atos.push({
      instrumento: 'apac',
      origem: num(x['id']),
      procedimento: num(x['procedimento_sigtap_id']),
      grupo: numOuNull(x['grupo_sigtap_id']),
      ocupacao: numOuNull(x['ocupacao_cbo_id']),
      executante: numOuNull(x['executante_profissional_id']),
      papel: 'executante',
      quantidade: num(x['quantidade']),
      pontos: null,
      servicoProfissional: 0,
      servicoHospitalar: 0,
      servicoAmbulatorial: num(x['valor_total']),
      total: num(x['valor_total']),
      fracaoAprovada: fracao(x['valor_aprovado'], x['valor_apresentado']),
    });
  const procs = await l.consultar(
    `SELECT p.id, p.conta_aih_id, p.procedimento_sigtap_id, ps.grupo_sigtap_id, p.ocupacao_cbo_id,
            p.executante_profissional_id, p.quantidade, p.pontos, p.valor_servico_hospitalar,
            p.valor_servico_profissional, p.valor_total, c.valor_aprovado, c.valor_total AS conta_total
       FROM conta_aih_procedimento p
       JOIN conta_aih c ON c.id = p.conta_aih_id
       JOIN competencia_sus k ON k.id = c.competencia_sus_id
       JOIN procedimento_sigtap ps ON ps.id = p.procedimento_sigtap_id
      WHERE c.estabelecimento_id = ? AND k.competencia = ? AND c.situacao = 'aprovada'
        AND c.excluido_em IS NULL AND p.excluido_em IS NULL
      ORDER BY c.id, p.sequencia`,
    [est, competencia],
  );
  const equipe = procs.length
    ? await l.consultar(
        `SELECT e.conta_aih_procedimento_id, e.profissional_id, e.ocupacao_cbo_id, e.pontos, e.valor_servico_profissional,
                d.codigo AS atividade
           FROM conta_aih_profissional e
           LEFT JOIN dominio_sus d ON d.id = e.atividade_dominio_sus_id
          WHERE e.conta_aih_procedimento_id IN (${procs.map(() => '?').join(',')}) AND e.excluido_em IS NULL
          ORDER BY e.conta_aih_id, e.sequencia`,
        procs.map((p) => num(p['id'])),
      )
    : [];
  const sadtPorConta = new Map<
    number,
    { valor: number; fracaoAprovada: number; participantes: ParticipanteSadt[] }
  >();
  for (const p of procs) {
    const id = num(p['id']);
    const conta = num(p['conta_aih_id']);
    const fr = fracao(p['valor_aprovado'], p['conta_total']);
    const s = sadtPorConta.get(conta) ?? { valor: 0, fracaoAprovada: fr, participantes: [] };
    sadtPorConta.set(conta, s);
    const membros = equipe.filter((e) => num(e['conta_aih_procedimento_id']) === id);
    const comum = {
      instrumento: 'aih' as const,
      origem: id,
      procedimento: num(p['procedimento_sigtap_id']),
      grupo: numOuNull(p['grupo_sigtap_id']),
      quantidade: num(p['quantidade']),
      fracaoAprovada: fr,
    };
    const executanteDoProc =
      numOuNull(p['executante_profissional_id']) ?? numOuNull(membros[0]?.['profissional_id']);
    if (membros.length === 0 && executanteDoProc === null) {
      // SADT: o serviço profissional do procedimento sem equipe fica para o rateio.
      s.valor = Math.round((s.valor + num(p['valor_servico_profissional'])) * 100) / 100;
      continue;
    }
    s.participantes.push({
      origem: id,
      procedimento: comum.procedimento,
      grupo: comum.grupo,
      executante: executanteDoProc,
      pontos: numOuNull(p['pontos']),
      quantidade: comum.quantidade,
    });
    if (membros.length === 0) {
      atos.push({
        ...comum,
        ocupacao: numOuNull(p['ocupacao_cbo_id']),
        executante: executanteDoProc,
        papel: 'executante',
        pontos: numOuNull(p['pontos']),
        servicoProfissional: num(p['valor_servico_profissional']),
        servicoHospitalar: num(p['valor_servico_hospitalar']),
        servicoAmbulatorial: 0,
        total: num(p['valor_total']),
      });
      continue;
    }
    membros.forEach((e, i) =>
      atos.push({
        ...comum,
        ocupacao: numOuNull(e['ocupacao_cbo_id']),
        executante: num(e['profissional_id']),
        papel: papelDaAtividadeAih(txtOuNull(e['atividade'])),
        pontos: numOuNull(e['pontos']),
        servicoProfissional: num(e['valor_servico_profissional']),
        // O serviço hospitalar e o total do procedimento contam uma vez só (no primeiro da equipe).
        servicoHospitalar: i === 0 ? num(p['valor_servico_hospitalar']) : 0,
        servicoAmbulatorial: 0,
        total: i === 0 ? num(p['valor_total']) : num(e['valor_servico_profissional']),
      }),
    );
  }
  return { atos, sadt: [...sadtPorConta.values()].filter((s) => s.valor > 0) };
}

export class PortaRepasseSusPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'repasse.sus');
  }

  /** Regras do repasse, regras do rateio do SADT e as apurações em apuração (para apurar). */
  consultar(c: ContextoPortaPropria): Promise<{
    regras: RegraRepasseSusLida[];
    rateios: RateioSadtLido[];
    apuracoes: ApuracaoAberta[];
  }> {
    return this.ler(c, 'consultar', async (l, est) => {
      const aps = await l.consultar(
        `SELECT id, numero, competencia, versao FROM apuracao_repasse
          WHERE estabelecimento_id = ? AND situacao = 'em_apuracao' ORDER BY competencia DESC, id DESC LIMIT 60`,
        [est.id],
      );
      return {
        regras: await regras(l, est.id),
        rateios: await rateios(l, est.id),
        apuracoes: aps.map((x) => ({
          id: num(x['id']),
          numero: String(x['numero']),
          competencia: competenciaDe(x['competencia']),
          versao: num(x['versao']),
        })),
      };
    });
  }

  /** As linhas vivas da apuração vindas da produção SUS. */
  linhas(c: ContextoPortaPropria, apuracao: number): Promise<LinhaRepasseSusLida[]> {
    return this.ler(c, 'linhas', async (l, est) => {
      const a = await l.uma('SELECT id FROM apuracao_repasse WHERE id = ? AND estabelecimento_id = ?', [
        apuracao,
        est.id,
      ]);
      if (!a) throw naoEncontrado('Apuração do repasse');
      const xs = await l.consultar(
        `SELECT p.sequencia, p.instrumento, p.executante_profissional_id, pf.nome, p.papel, r.codigo AS regra_codigo,
                p.base_calculo, p.percentual, p.valor_glosa, p.valor_repasse
           FROM producao_repasse_sus p
           JOIN profissional pr ON pr.id = p.executante_profissional_id
           JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
           LEFT JOIN regra_repasse_sus r ON r.id = p.regra_repasse_sus_id
          WHERE p.apuracao_repasse_id = ? AND p.excluido_em IS NULL ORDER BY p.sequencia`,
        [apuracao],
      );
      return xs.map((x) => ({
        sequencia: num(x['sequencia']),
        instrumento: String(x['instrumento']),
        executante: num(x['executante_profissional_id']),
        executanteNome: String(x['nome']),
        papel: String(x['papel']),
        regraCodigo: txtOuNull(x['regra_codigo']),
        base: num(x['base_calculo']),
        percentual: numOuNull(x['percentual']),
        glosa: num(x['valor_glosa']),
        repasse: num(x['valor_repasse']),
      }));
    });
  }

  incluirRegra(c: ContextoPortaPropria, entrada: unknown): Promise<RegraRepasseSusLida> {
    const e = entradaValida(esquemaRegra, entrada);
    return this.gravar(c, 'repasse.sus.regra.incluir', ['regra_repasse_sus'], async (tx, est) => {
      const procedimento = await idPeloCodigo(tx, 'procedimento', textoOuNull(e.procedimento));
      const grupo = await idPeloCodigo(tx, 'grupo', textoOuNull(e.grupo));
      const ocupacao = await idPeloCodigo(tx, 'ocupacao', textoOuNull(e.ocupacao));
      const r = {
        codigo: e.codigo,
        descricao: e.descricao,
        base: e.base,
        procedimento,
        grupo,
        percentualPago: e.percentualPago ?? null,
        percentualDesconto: e.percentualDesconto ?? null,
        valorFixo: e.valorFixo ?? null,
        valorPonto: e.valorPonto ?? null,
        inicio: e.inicio,
        fim: e.fim ?? null,
      };
      const problemas = conferirRegraSus(r);
      if (problemas.length)
        throw recusaRegra(
          'Regra do repasse SUS recusada',
          problemas.map((p) => ({ campo: p, mensagem: `Regra inválida: ${p}.` })),
        );
      const dup = await tx.uma(
        'SELECT id FROM regra_repasse_sus WHERE estabelecimento_id = ? AND codigo = ? AND vigencia_inicio = ?',
        [est.id, e.codigo, e.inicio],
      );
      if (dup)
        throw recusaRegra('Regra repetida', [
          { campo: 'codigo', mensagem: 'Já existe regra com este código e este início de vigência.' },
        ]);
      const id = await tx.incluir('regra_repasse_sus', {
        estabelecimento_id: est.id,
        codigo: e.codigo,
        descricao: e.descricao,
        modalidade: e.modalidade,
        procedimento_sigtap_id: procedimento,
        grupo_sigtap_id: grupo,
        ocupacao_cbo_id: ocupacao,
        papel: e.papel,
        base_calculo: e.base,
        percentual_pago: r.percentualPago,
        percentual_desconto: r.percentualDesconto,
        valor_fixo: r.valorFixo,
        valor_desconto: e.valorDesconto ?? null,
        valor_ponto: r.valorPonto,
        prioridade: e.prioridade,
        vigencia_inicio: e.inicio,
        vigencia_fim: r.fim,
        ativo: true,
      });
      const lida = (await regras(tx, est.id)).find((x) => x.id === id);
      if (!lida) throw naoEncontrado('Regra do repasse SUS');
      return { ...lida, tabela: 'regra_repasse_sus', id };
    });
  }

  incluirRateio(c: ContextoPortaPropria, entrada: unknown): Promise<RateioSadtLido> {
    const e = entradaValida(esquemaRateio, entrada);
    return this.gravar(c, 'repasse.sus.rateio.incluir', ['regra_rateio_sadt_aih'], async (tx, est) => {
      const procedimento = await idPeloCodigo(tx, 'procedimento', textoOuNull(e.procedimento));
      const grupo = procedimento === null ? await idPeloCodigo(tx, 'grupo', textoOuNull(e.grupo)) : null;
      const r = {
        procedimento,
        grupo,
        usaPeso: e.usaPeso,
        pesoPercentual: e.pesoPercentual ?? null,
        tetoPercentual: e.tetoPercentual ?? null,
        inicio: e.inicio,
        fim: e.fim ?? null,
      };
      const problemas = conferirRateioSadt(r);
      if (problemas.length)
        throw recusaRegra(
          'Rateio do SADT recusado',
          problemas.map((p) => ({ campo: p, mensagem: `Rateio inválido: ${p}.` })),
        );
      if (e.profissional) {
        const p = await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [
          e.profissional,
        ]);
        if (!p) throw naoEncontrado('Profissional');
      }
      const id = await tx.incluir('regra_rateio_sadt_aih', {
        estabelecimento_id: est.id,
        procedimento_sigtap_id: procedimento,
        grupo_sigtap_id: grupo,
        profissional_id: e.profissional ?? null,
        considera_sadt: e.consideraSadt,
        usa_peso: e.usaPeso,
        peso_percentual: r.pesoPercentual,
        teto_percentual: r.tetoPercentual,
        vigencia_inicio: e.inicio,
        vigencia_fim: r.fim,
        ativo: true,
      });
      const lido = (await rateios(tx, est.id)).find((x) => x.id === id);
      if (!lido) throw naoEncontrado('Rateio do SADT');
      return { ...lido, tabela: 'regra_rateio_sadt_aih', id };
    });
  }

  /** Encerra a vigência (regra ou rateio) na versão vista; o fim não pode ser antes do início. */
  encerrar(
    c: ContextoPortaPropria,
    tipo: 'regra' | 'rateio',
    id: number,
    entrada: unknown,
  ): Promise<{ id: number; fim: string; versao: number }> {
    const e = entradaValida(esquemaEncerrar, entrada);
    const tabela = tipo === 'regra' ? 'regra_repasse_sus' : 'regra_rateio_sadt_aih';
    return this.gravar(c, `repasse.sus.${tipo}.encerrar`, [tabela], async (tx, est) => {
      const x = await tx.uma(
        `SELECT id, vigencia_inicio, versao FROM ${tabela} WHERE id = ? AND estabelecimento_id = ?`,
        [id, est.id],
      );
      if (!x) throw naoEncontrado(tipo === 'regra' ? 'Regra do repasse SUS' : 'Rateio do SADT');
      if ((dataTxt(x['vigencia_inicio']) ?? '') > e.fim)
        throw recusaRegra('Fim antes do início', [
          { campo: 'fim', mensagem: 'O fim da vigência é anterior ao início.' },
        ]);
      const versao = await tx.alterar(tabela, id, e.versao, { vigencia_fim: e.fim });
      return { id, fim: e.fim, versao, tabela };
    });
  }

  /** Apura a produção SUS aprovada da competência da apuração (reprocessa: as linhas anteriores ficam excluídas). */
  apurar(c: ContextoPortaPropria, apuracao: number, entrada: unknown): Promise<ResumoApuracaoSus> {
    const e = entradaValida(esquemaApurar, entrada);
    return this.gravar(
      c,
      'repasse.sus.apurar',
      ['producao_repasse_sus', 'apuracao_repasse'],
      async (tx, est, usuario) => {
        const [a] = await tx.consultarParaAtualizar(
          'SELECT id, competencia, situacao, versao FROM apuracao_repasse WHERE id = ? AND estabelecimento_id = ?',
          [apuracao, est.id],
        );
        if (!a) throw naoEncontrado('Apuração do repasse');
        if (String(a['situacao']) !== 'em_apuracao')
          throw recusaRegra('Apuração fechada', [
            { campo: 'apuracao', mensagem: 'Só a apuração em apuração recebe a produção SUS.' },
          ]);
        if (num(a['versao']) !== e.versao)
          throw new ErroOperacao(409, 'conflito-versao', 'Versão diferente', 'A apuração mudou: recarregue.');
        const competencia = competenciaDe(a['competencia']);
        const producao = await producaoAprovada(tx, est.id, competencia);
        const r = apurarProducaoSus({
          competencia,
          atos: producao.atos,
          regras: await regras(tx, est.id),
          sadt: producao.sadt,
          rateios: await rateios(tx, est.id),
        });
        const antigas = await tx.consultar(
          `SELECT id, versao FROM producao_repasse_sus
            WHERE apuracao_repasse_id = ? AND origem = 'sistema' AND excluido_em IS NULL`,
          [apuracao],
        );
        const agora = new Date();
        for (const x of antigas)
          await tx.alterar('producao_repasse_sus', num(x['id']), num(x['versao']), {
            excluido_em: agora,
            excluido_por: usuario,
          });
        const max = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) AS m FROM producao_repasse_sus WHERE apuracao_repasse_id = ?',
          [apuracao],
        );
        const desde = num(max?.['m']);
        const coluna = {
          bpa: 'producao_ambulatorial_sus_item_id',
          apac: 'apac_procedimento_id',
          aih: 'conta_aih_procedimento_id',
        } as const;
        for (const l of r.linhas)
          await tx.incluir('producao_repasse_sus', {
            apuracao_repasse_id: apuracao,
            sequencia: desde + l.sequencia,
            instrumento: l.instrumento,
            [coluna[l.instrumento]]: l.origem,
            executante_profissional_id: l.executante,
            regra_repasse_sus_id: l.regra,
            papel: l.papel,
            pontos: l.pontos,
            base_calculo: l.base,
            percentual: l.percentual,
            valor_glosa: l.glosa,
            valor_repasse: l.repasse,
            origem: 'sistema',
          });
        const versao = await tx.alterar('apuracao_repasse', apuracao, e.versao, {});
        return {
          apuracao,
          competencia,
          linhas: r.linhas.length,
          excluidas: antigas.length,
          totalRepasse: r.totalRepasse,
          totalGlosa: r.totalGlosa,
          pendencias: r.pendencias,
          versao,
          tabela: 'apuracao_repasse',
          id: apuracao,
        };
      },
    ).then((x) => {
      const resto: Record<string, unknown> = { ...x };
      delete resto['tabela'];
      delete resto['id'];
      return resto as unknown as ResumoApuracaoSus;
    });
  }
}
