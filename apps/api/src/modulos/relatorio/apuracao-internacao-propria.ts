// Porta PRÓPRIA da apuração dos indicadores obrigatórios de internação (01-REL L112; F3), sobre o banco do cliente.
// Recebe as apurações calculadas pelo domínio (dominio-relatorio/apuracao-internacao, a partir das bases do censo) e
// grava `apuracao_indicador` com numerador, denominador, valor, meta e situação. O indicador e a ficha técnica vigente
// (versão 1, da ficha do sistema) nascem na primeira apuração, no grupo dos obrigatórios de internação, se o hospital
// ainda não os cadastrou. Apuração fechada nunca é sobrescrita; a prévia igual não é regravada.
import {
  type ApuracaoCalculada,
  destinoDaApuracao,
  fichaDe,
  INDICADORES_OBRIGATORIOS_INTERNACAO,
} from '@sgh/dominio-relatorio';
import type { TxOperacao } from '@sgh/nucleo';
import {
  BaseComunicacaoPropria,
  type ContextoComunicacao,
  num,
  numOuNull,
  txtOuNull,
} from '../integracao/comunicacao-base-propria.js';

export const PORTA_APURACAO_INTERNACAO = Symbol('PORTA_APURACAO_INTERNACAO');

export const OPERACAO_APURACAO_INTERNACAO = 'relatorio.apuracao_indicador.internacao';
export const TABELAS_APURACAO_INTERNACAO = [
  'apuracao_indicador',
  'indicador',
  'indicador_versao',
  'grupo_indicador',
] as const;

/** Grupo em que nascem os indicadores obrigatórios de internação ainda não cadastrados pelo hospital. */
export const GRUPO_OBRIGATORIOS_INTERNACAO = 'internacao-obrigatorios';

const UNIDADE: Readonly<Record<string, string>> = {
  percentual: 'percentual',
  dias: 'dias',
  razao: 'razao',
  quantidade: 'quantidade',
};
const POLARIDADE: Readonly<Record<string, string>> = {
  'maior-melhor': 'maior_melhor',
  'menor-melhor': 'menor_melhor',
  neutra: 'neutra',
};

export interface ResumoApuracao {
  readonly incluidas: number;
  readonly atualizadas: number;
  readonly mantidasFechadas: number;
  readonly semMudanca: number;
}

export interface ApuracaoLida {
  readonly codigo: string;
  readonly nome: string;
  readonly competencia: string;
  readonly numerador: number | null;
  readonly denominador: number | null;
  readonly valor: number | null;
  readonly valorMeta: number | null;
  readonly situacaoMeta: string;
  readonly situacao: string;
  readonly dadosAte: string | null;
}

const dia = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

export class PortaApuracaoInternacaoPropria extends BaseComunicacaoPropria {
  /** Grava as apurações calculadas (uma transação, uma linha de trilha). */
  async apurar(
    c: ContextoComunicacao,
    apuracoes: readonly ApuracaoCalculada[],
    dadosAte: Date,
  ): Promise<{ id: number } & ResumoApuracao> {
    return this.gravar(c, OPERACAO_APURACAO_INTERNACAO, TABELAS_APURACAO_INTERNACAO, async (tx, est) => {
      const resumo = { incluidas: 0, atualizadas: 0, mantidasFechadas: 0, semMudanca: 0 };
      const ids = new Map<string, { indicador: number; versao: number }>();
      let primeiro = 0;
      for (const a of apuracoes) {
        let alvo = ids.get(a.codigo);
        if (!alvo) {
          alvo = await this.indicadorDe(tx, a.codigo);
          ids.set(a.codigo, alvo);
        }
        const [g] = await tx.consultar(
          `SELECT id, versao, situacao, numerador, denominador, valor_meta FROM apuracao_indicador
            WHERE estabelecimento_id = ? AND indicador_id = ? AND competencia = ? AND escopo_chave = '0-0'
            LIMIT 1`,
          [est, alvo.indicador, a.competencia],
          { teto: 1 },
        );
        const gravada = g
          ? {
              situacao: String(g['situacao']),
              numerador: numOuNull(g['numerador']),
              denominador: numOuNull(g['denominador']),
              valorMeta: numOuNull(g['valor_meta']),
            }
          : null;
        const destino = destinoDaApuracao(gravada, a);
        const valores = {
          indicador_versao_id: alvo.versao,
          periodo_inicio: a.periodoInicio,
          periodo_fim: a.periodoFim,
          numerador: a.numerador,
          denominador: a.denominador,
          valor: a.valor,
          valor_meta: a.valorMeta,
          situacao_meta: a.situacaoMeta,
          situacao: 'previa',
          forma_insercao: 'carga',
          dados_ate: dadosAte,
        };
        if (destino === 'incluir') {
          const id = await tx.incluir('apuracao_indicador', {
            estabelecimento_id: est,
            indicador_id: alvo.indicador,
            competencia: a.competencia,
            ...valores,
          });
          primeiro ||= id;
          resumo.incluidas++;
        } else if (destino === 'atualizar') {
          await tx.alterar('apuracao_indicador', num(g!['id']), num(g!['versao']), valores);
          primeiro ||= num(g!['id']);
          resumo.atualizadas++;
        } else if (destino === 'manter-fechada') resumo.mantidasFechadas++;
        else resumo.semMudanca++;
      }
      return { id: primeiro, ...resumo };
    });
  }

  /** As apurações gravadas dos indicadores obrigatórios na competência (AAAA-MM). */
  async lerApuracoes(c: ContextoComunicacao, competencia: string): Promise<ApuracaoLida[]> {
    return this.ler(c, 'apuracao-internacao', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT i.codigo, i.nome, a.competencia, a.numerador, a.denominador, a.valor, a.valor_meta, a.situacao_meta,
                a.situacao, a.dados_ate
           FROM apuracao_indicador a JOIN indicador i ON i.id = a.indicador_id
          WHERE a.estabelecimento_id = ? AND a.competencia = ? AND a.escopo_chave = '0-0' AND a.excluido_em IS NULL
            AND i.codigo IN (${INDICADORES_OBRIGATORIOS_INTERNACAO.map(() => '?').join(', ')})
          ORDER BY i.codigo`,
        [est, `${competencia}-01`, ...INDICADORES_OBRIGATORIOS_INTERNACAO],
      );
      return linhas.map((r) => ({
        codigo: String(r['codigo']),
        nome: String(r['nome']),
        competencia: dia(r['competencia']),
        numerador: numOuNull(r['numerador']),
        denominador: numOuNull(r['denominador']),
        valor: numOuNull(r['valor']),
        valorMeta: numOuNull(r['valor_meta']),
        situacaoMeta: String(r['situacao_meta']),
        situacao: String(r['situacao']),
        dadosAte: r['dados_ate'] instanceof Date ? r['dados_ate'].toISOString() : txtOuNull(r['dados_ate']),
      }));
    });
  }

  /** O indicador e a ficha vigente pelo código; nascem da ficha do sistema se o hospital não os cadastrou. */
  private async indicadorDe(tx: TxOperacao, codigo: string): Promise<{ indicador: number; versao: number }> {
    const ficha = fichaDe(codigo);
    if (!ficha) throw new Error(`Indicador sem ficha técnica: ${codigo}`);
    const [i] = await tx.consultar('SELECT id FROM indicador WHERE codigo = ? LIMIT 1', [codigo], {
      teto: 1,
    });
    let indicador = i ? num(i['id']) : 0;
    if (!indicador) {
      const [g] = await tx.consultar('SELECT id FROM grupo_indicador WHERE codigo = ? LIMIT 1', [
        GRUPO_OBRIGATORIOS_INTERNACAO,
      ]);
      const grupo = g
        ? num(g['id'])
        : await tx.incluir('grupo_indicador', {
            codigo: GRUPO_OBRIGATORIOS_INTERNACAO,
            descricao: 'Indicadores obrigatórios de internação (censo)',
          });
      indicador = await tx.incluir('indicador', {
        codigo,
        nome: ficha.nome,
        grupo_indicador_id: grupo,
        tipo: 'operacional',
        unidade: UNIDADE[ficha.unidade] ?? 'razao',
        polaridade: POLARIDADE[ficha.polaridade] ?? 'neutra',
        periodicidade: 'mensal',
        forma_calculo: 'automatica',
        regulatorio: true,
      });
    }
    const [v] = await tx.consultar(
      'SELECT id FROM indicador_versao WHERE indicador_id = ? ORDER BY numero_versao DESC LIMIT 1',
      [indicador],
      { teto: 1 },
    );
    if (v) return { indicador, versao: num(v['id']) };
    const versao = await tx.incluir('indicador_versao', {
      indicador_id: indicador,
      numero_versao: 1,
      operacao: 'inclusao',
      ocorrido_em: new Date(),
      formula: ficha.formula,
      numerador_descricao: ficha.numerador.descricao,
      numerador_grandeza: ficha.numerador.grandeza,
      denominador_descricao: ficha.denominador?.descricao ?? null,
      denominador_grandeza: ficha.denominador?.grandeza ?? null,
      multiplicador: ficha.fator,
      fonte_dados: ficha.fonte.slice(0, 500),
      vigencia_inicio: '2019-01-01',
    });
    return { indicador, versao };
  }
}
