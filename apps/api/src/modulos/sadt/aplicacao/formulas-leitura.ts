// Fórmulas e textos padrão do exame lidos do banco do cliente (F3.5, análise 05-SADT linha 3), para a digitação: a
// fórmula vigente de cada analito calculado na data pedida (a mais recente em vigor), com as variáveis; o cálculo é do
// domínio (calcularAnalitos, sem eval). Na leitura da digitação, cada elemento calculado sai com a fórmula, o valor
// calculado ou o motivo de não calcular, e as variáveis que alguém precisa digitar entram na lista de variáveis. Na
// gravação do resultado, o valor do analito calculado é o da fórmula (o digitado nele é ignorado) e as variáveis
// digitadas ficam em resultado_variavel_formula, para refazer a conta.
import type { ElementoDigitacao } from '@sgh/contratos';
import {
  calcularAnalitos,
  type FonteVariavelCalculo,
  type FormulaDoAnalito,
  idadeEmAnos,
  type ValorDigitado,
  variaveisADigitar,
} from '@sgh/dominio-sadt';
import type { Linha, TxOperacao } from '@sgh/nucleo';

/** Quem lê: o leitor da consulta ou a transação da gravação. */
interface Fonte {
  consultar(sql: string, parametros: readonly unknown[]): Promise<Linha[]>;
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const marcas = (k: number) => Array.from({ length: k }, () => '?').join(', ');

/** A fórmula vigente de cada analito calculado do exame na data (a de início mais recente; uma por analito). */
export async function lerFormulasDoExame(
  l: Fonte,
  exameId: number,
  dia: string | Date,
): Promise<FormulaDoAnalito[]> {
  const linhas = await l.consultar(
    `SELECT fc.id, ea.analito_id, fc.expressao, COALESCE(fc.casas_decimais, ea.casas_decimais, an.casas_decimais) AS casas
       FROM formula_calculo fc
       JOIN exame_analito ea ON ea.id = fc.exame_analito_id AND ea.ativo = TRUE AND ea.excluido_em IS NULL
       JOIN analito an ON an.id = ea.analito_id AND an.excluido_em IS NULL
      WHERE ea.exame_id = ? AND fc.alvo = 'analito' AND fc.ativo = TRUE
        AND fc.vigencia_inicio <= ? AND (fc.vigencia_fim IS NULL OR fc.vigencia_fim >= ?)
      ORDER BY ea.analito_id, fc.vigencia_inicio DESC, fc.id DESC`,
    [exameId, dia, dia],
  );
  const porAnalito = new Map<number, Linha>();
  for (const x of linhas) if (!porAnalito.has(n(x['analito_id']))) porAnalito.set(n(x['analito_id']), x);
  const ids = [...porAnalito.values()].map((x) => n(x['id']));
  if (!ids.length) return [];
  const variaveis = await l.consultar(
    `SELECT id, formula_calculo_id, identificador, descricao, fonte, analito_id, dado_paciente FROM variavel_formula
      WHERE formula_calculo_id IN (${marcas(ids.length)}) AND excluido_em IS NULL ORDER BY formula_calculo_id, sequencia`,
    ids,
  );
  return [...porAnalito.values()].map((f) => ({
    analito: n(f['analito_id']),
    expressao: String(f['expressao']),
    casas: nn(f['casas']),
    variaveis: variaveis
      .filter((v) => n(v['formula_calculo_id']) === n(f['id']))
      .map((v) => ({
        id: n(v['id']),
        identificador: String(v['identificador']),
        descricao: String(v['descricao']),
        fonte: String(v['fonte']) as FonteVariavelCalculo,
        analito: nn(v['analito_id']),
        dadoPaciente: v['dado_paciente'] === null ? null : String(v['dado_paciente']),
      })),
  }));
}

export interface TextoPadraoDaDigitacao {
  codigo: number;
  descricao: string;
  texto: string;
  mnemonico: string | null;
}

/** Os textos padrão oferecidos na digitação do exame: os do exame primeiro, depois os dos setores dele e os gerais. */
export async function lerTextosPadraoDoExame(l: Fonte, exameId: number): Promise<TextoPadraoDaDigitacao[]> {
  return (
    await l.consultar(
      `SELECT t.id, t.descricao, t.texto, t.mnemonico FROM texto_padrao_resultado t
        WHERE t.ativo = TRUE AND t.aplicacao IN ('resultado', 'analito')
          AND (t.exame_id = ?
               OR (t.exame_id IS NULL
                   AND (t.setor_diagnostico_id IS NULL
                        OR t.setor_diagnostico_id IN (SELECT se.setor_diagnostico_id FROM exame_setor_executante se
                                                       WHERE se.exame_id = ? AND se.ativo = TRUE))))
        ORDER BY t.exame_id IS NULL, t.setor_diagnostico_id IS NULL, t.descricao, t.id LIMIT 200`,
      [exameId, exameId],
    )
  ).map((x) => ({
    codigo: n(x['id']),
    descricao: String(x['descricao']),
    texto: String(x['texto']),
    mnemonico: x['mnemonico'] === null ? null : String(x['mnemonico']),
  }));
}

interface VariavelLida {
  codigo: number;
  identificacao: string;
  descricao: string;
  valor: number | null;
}

/**
 * A digitação com o cálculo: cada elemento calculado leva a fórmula e o valor (ou o motivo); as variáveis a digitar que
 * o resultado ainda não tem entram na lista, vazias; a idade do paciente (anos completos na data do exame) vai junto
 * para a tela refazer a conta enquanto se digita.
 */
export function comCalculo(
  elementos: readonly ElementoDigitacao[],
  variaveis: readonly VariavelLida[],
  formulas: readonly FormulaDoAnalito[],
  diasDeVida: number | null,
): { elementos: ElementoDigitacao[]; variaveis: VariavelLida[]; idadePaciente: number | null } {
  const idadePaciente = idadeEmAnos(diasDeVida);
  if (!formulas.length) return { elementos: [...elementos], variaveis: [...variaveis], idadePaciente };
  const todas = [
    ...variaveis,
    ...variaveisADigitar(formulas)
      .filter((v) => !variaveis.some((x) => x.codigo === v.id))
      .map((v) => ({ codigo: v.id, identificacao: v.identificador, descricao: v.descricao, valor: null })),
  ];
  const calculos = calcularAnalitos({
    formulas,
    valores: new Map(elementos.map((e) => [e.codigo, e.valor?.numerico ?? null])),
    digitadas: Object.fromEntries(todas.map((v) => [v.codigo, v.valor])),
    paciente: { idade: idadePaciente },
  });
  return {
    elementos: elementos.map((e) => {
      const f = formulas.find((x) => x.analito === e.codigo);
      const c = calculos.get(e.codigo);
      if (!f || !c) return e;
      return {
        ...e,
        calculo: {
          expressao: f.expressao,
          casas: f.casas,
          variaveis: f.variaveis.map((v) => ({
            codigo: v.id,
            identificador: v.identificador,
            fonte: v.fonte,
            analito: v.analito,
            dadoPaciente: v.dadoPaciente,
          })),
          valor: c.ok ? c.valor : null,
          motivo: c.ok ? null : c.motivo,
        },
      };
    }),
    variaveis: todas,
    idadePaciente,
  };
}

const FONTE_VALOR: Record<FonteVariavelCalculo, string> = {
  digitado: 'digitado',
  dado_paciente: 'paciente',
  grandeza: 'grandeza',
  analito: 'analito',
};

/**
 * O cálculo na gravação do resultado: junta os valores já gravados com os que vieram, calcula os analitos com fórmula
 * e devolve os valores a gravar (o do calculado é o da fórmula; sem conta possível, o calculado não é gravado). A
 * variável informada tem de ser de fórmula vigente do exame e ser das que se digitam.
 */
export async function calcularNoResultado(
  tx: TxOperacao,
  a: {
    readonly exameId: number;
    readonly paciente: number;
    readonly agora: Date;
    readonly resultado: number | null;
    readonly valores: readonly ValorDigitado[];
    readonly variaveis: readonly { variavel: number; valor: number }[];
  },
): Promise<{
  falha: string | null;
  valores: ValorDigitado[];
  gravarVariaveis: (resultado: number) => Promise<void>;
}> {
  const nada = async () => {};
  const formulas = await lerFormulasDoExame(tx, a.exameId, a.agora);
  const digitaveis = new Map(variaveisADigitar(formulas).map((v) => [v.id, v]));
  const idades = formulas.flatMap((f) => f.variaveis).filter((v) => v.fonte === 'dado_paciente');
  for (const v of idades) digitaveis.set(v.id, v);
  if (a.variaveis.some((v) => !digitaveis.has(v.variavel)))
    return {
      falha: 'A variável informada não é das que se digitam na fórmula vigente deste exame.',
      valores: [...a.valores],
      gravarVariaveis: nada,
    };
  if (new Set(a.variaveis.map((v) => v.variavel)).size !== a.variaveis.length)
    return { falha: 'Variável repetida.', valores: [...a.valores], gravarVariaveis: nada };
  if (!formulas.length) return { falha: null, valores: [...a.valores], gravarVariaveis: nada };

  const gravadas = a.resultado
    ? await tx.consultar(
        `SELECT id, versao, variavel_formula_id, valor_numerico, sequencia, excluido_em FROM resultado_variavel_formula
          WHERE resultado_exame_id = ?`,
        [a.resultado],
      )
    : [];
  const digitadas: Record<number, number | null> = {};
  for (const g of gravadas)
    if (g['excluido_em'] === null) digitadas[n(g['variavel_formula_id'])] = nn(g['valor_numerico']);
  for (const v of a.variaveis) digitadas[v.variavel] = v.valor;

  const valores = new Map<number, number | null>();
  if (a.resultado)
    for (const x of await tx.consultar(
      'SELECT analito_id, valor_numerico FROM resultado_analito WHERE resultado_exame_id = ? AND excluido_em IS NULL',
      [a.resultado],
    ))
      valores.set(n(x['analito_id']), nn(x['valor_numerico']));
  for (const v of a.valores) valores.set(v.analito, v.numero);
  const [pac] = await tx.consultar(
    `SELECT DATEDIFF(?, pf.data_nascimento) AS dias FROM paciente p
       JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ?`,
    [a.agora, a.paciente],
  );
  const calculos = calcularAnalitos({
    formulas,
    valores,
    digitadas,
    paciente: { idade: idadeEmAnos(nn(pac?.['dias'])) },
  });
  const saida = a.valores.filter((v) => !calculos.has(v.analito));
  for (const [analito, c] of calculos) if (c.ok) saida.push({ analito, numero: c.valor, texto: null });

  const gravarVariaveis = async (resultado: number) => {
    let seq = gravadas.reduce((m, g) => Math.max(m, n(g['sequencia'])), 0);
    for (const v of a.variaveis) {
      const ja = gravadas.find((g) => n(g['variavel_formula_id']) === v.variavel);
      const fonte = FONTE_VALOR[(digitaveis.get(v.variavel) as { fonte: FonteVariavelCalculo }).fonte];
      if (ja)
        await tx.alterar('resultado_variavel_formula', n(ja['id']), n(ja['versao']), {
          valor_numerico: v.valor,
          fonte_valor: fonte,
          excluido_em: null,
          excluido_por: null,
        });
      else
        await tx.incluir('resultado_variavel_formula', {
          resultado_exame_id: resultado,
          sequencia: ++seq,
          variavel_formula_id: v.variavel,
          valor_numerico: v.valor,
          fonte_valor: fonte,
        });
    }
  };
  return { falha: null, valores: saida, gravarVariaveis };
}
