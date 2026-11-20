// Eventos de tabela do eSocial (M53-F5; leiaute S-1.3): S-1000 informações do empregador, S-1005 estabelecimento, S-1010
// rubricas e S-1020 lotação tributária, em inclusão, alteração ou exclusão a partir da competência de início. Os dados
// vêm dos parâmetros do eSocial do empregador (com vigência), do CNPJ da empresa e das rubricas da folha (código,
// natureza e incidências do M53-F1). Faltou dado obrigatório: o evento não é montado e a pendência diz o quê.
//
// D-LOTACAO-536 (POL-5): uma lotação tributária por empregador (tipo 01, FPAS e terceiros dos parâmetros), o caso do
// hospital de um CNPJ; lotação por centro de custo fica para quando houver obra ou tomador de serviço.
// D-ESTAB-536 (POL-5): o estabelecimento é o CNPJ completo da empresa (matriz), com o CNAE e o RAT/FAP dos parâmetros.
import type { OperacaoTabelaEsocial, PendenciaEsocial, RubricaFolha } from '@sgh/contratos';
import {
  type ContextoEventoEsocial,
  type EmpregadorParaEvento,
  envelope,
  idEventoEsocial,
  ideEmpregador,
  ideEventoTabela,
  pendencia,
  raizCnpj,
  type ResultadoEventoEsocial,
} from './comum.js';
import { el, type NoXml, obrig, textoCampo } from './xml.js';

const semCnpj = (e: EmpregadorParaEvento): PendenciaEsocial[] =>
  e.cnpj && /^[A-Z0-9]{12}\d{2}$/.test(e.cnpj)
    ? []
    : [pendencia('empregador-sem-cnpj', 'O cadastro da empresa não tem o CNPJ de 14 posições.')];

/** Inclusão, alteração ou exclusão, com o período de validade a partir de `inicio` (AAAA-MM). */
function operacao(
  op: OperacaoTabelaEsocial,
  identificacao: (inicio: string) => NoXml,
  dados: NoXml | null,
  inicio: string,
): NoXml {
  if (op === 'exclusao') return obrig('exclusao', [identificacao(inicio)]);
  return obrig(op, [identificacao(inicio), dados]);
}

function montar(
  evento: 'S-1000' | 'S-1005' | 'S-1010' | 'S-1020',
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  corpo: (cnpj: string) => readonly (NoXml | null)[],
  inicio: string,
): ResultadoEventoEsocial {
  const pend = semCnpj(e);
  if (pend.length) return { ok: false, pendencias: pend };
  const cnpj = e.cnpj!;
  const id = idEventoEsocial(raizCnpj(cnpj), ctx.instante, ctx.sequencia);
  return { ok: true, raiz: envelope(evento, ctx, corpo(cnpj), id), idEsocial: id, dataReferencia: inicio };
}

/** S-1000: classificação tributária e indicativos do empregador. */
export function montarS1000(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  op: OperacaoTabelaEsocial,
  inicio: string,
): ResultadoEventoEsocial {
  const periodo = (i: string) => obrig('idePeriodo', [obrig('iniValid', i)]);
  const cadastro = obrig('infoCadastro', [
    obrig('classTrib', e.classTrib),
    el('indCoop', e.indCoop),
    el('indConstr', e.indConstr),
    obrig('indDesFolha', e.indDesFolha),
    obrig('indOptRegEletron', e.indOptRegEletron),
  ]);
  return montar(
    'S-1000',
    ctx,
    e,
    (cnpj) => [
      ideEventoTabela(ctx),
      ideEmpregador(cnpj),
      obrig('infoEmpregador', [
        op === 'exclusao' ? obrig('exclusao', [periodo(inicio)]) : obrig(op, [periodo(inicio), cadastro]),
      ]),
    ],
    inicio,
  );
}

/** FAP do leiaute (décimos de milésimo → "1.0000"). */
export const fapDecimal = (fap: number): string =>
  `${Math.floor(fap / 10_000)}.${String(fap % 10_000).padStart(4, '0')}`;

/** S-1005: o estabelecimento (CNPJ completo), com o CNAE preponderante e o RAT/FAP. */
export function montarS1005(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  op: OperacaoTabelaEsocial,
  inicio: string,
): ResultadoEventoEsocial {
  return montar(
    'S-1005',
    ctx,
    e,
    (cnpj) => {
      const ide = (i: string) =>
        obrig('ideEstab', [obrig('tpInsc', 1), obrig('nrInsc', cnpj), obrig('iniValid', i)]);
      const dados = obrig('dadosEstab', [
        obrig('cnaePrep', e.cnaePrep),
        obrig('aliqGilrat', [obrig('aliqRat', e.aliqRat), obrig('fap', fapDecimal(e.fap))]),
      ]);
      return [
        ideEventoTabela(ctx),
        ideEmpregador(cnpj),
        obrig('infoEstab', [operacao(op, ide, dados, inicio)]),
      ];
    },
    inicio,
  );
}

/** Tipo da rubrica no eSocial: 1 vencimento, 2 desconto, 3 informativa, 4 informativa dedutora. */
export const TIPO_RUBRICA_ESOCIAL: Readonly<Record<NonNullable<RubricaFolha['tipo']>, 1 | 2 | 3 | 4>> = {
  provento: 1,
  desconto: 2,
  base: 3,
  informativa: 3,
  informativaDedutora: 4,
};

/** O que falta à rubrica para o S-1010 (natureza, tipo e as incidências de INSS, IRRF e FGTS). */
export function pendenciasRubrica(r: RubricaFolha, natureza: string | null): PendenciaEsocial[] {
  const p: PendenciaEsocial[] = [];
  const rot = `Rubrica ${r.codigo}`;
  if (!natureza || !/^\d{4}$/.test(natureza))
    p.push(pendencia('rubrica-sem-natureza', `${rot}: sem a natureza da rubrica do eSocial.`));
  if (!r.tipo)
    p.push(pendencia('rubrica-sem-tipo', `${rot}: sem o tipo (provento, desconto ou informativa).`));
  for (const [t, rotulo] of [
    ['inss', 'previdência'],
    ['irrf', 'imposto de renda'],
    ['fgts', 'FGTS'],
  ] as const)
    if (!r.esocial[t])
      p.push(pendencia(`rubrica-sem-incidencia-${t}`, `${rot}: sem a incidência de ${rotulo} no eSocial.`));
  return p;
}

/**
 * S-1010: uma rubrica da tabela da empresa (`natureza` é o código de 4 dígitos da natureza da rubrica, lido do domínio
 * oficial pelo identificador da rubrica).
 */
export function montarS1010(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  op: OperacaoTabelaEsocial,
  inicio: string,
  r: RubricaFolha,
  natureza: string | null,
): ResultadoEventoEsocial {
  const pend = op === 'exclusao' ? [] : pendenciasRubrica(r, natureza);
  if (pend.length) return { ok: false, pendencias: pend };
  return montar(
    'S-1010',
    ctx,
    e,
    (cnpj) => {
      const ide = (i: string) =>
        obrig('ideRubrica', [
          obrig('codRubr', String(r.codigo)),
          obrig('ideTabRubr', e.ideTabRubr),
          obrig('iniValid', i),
        ]);
      const dados =
        op === 'exclusao'
          ? null
          : obrig('dadosRubrica', [
              obrig('dscRubr', textoCampo(r.descricao, 100) ?? `Rubrica ${r.codigo}`),
              obrig('natRubr', natureza!),
              obrig('tpRubr', TIPO_RUBRICA_ESOCIAL[r.tipo!]),
              obrig('codIncCP', r.esocial.inss!),
              obrig('codIncIRRF', r.esocial.irrf!),
              obrig('codIncFGTS', r.esocial.fgts!),
            ]);
      return [
        ideEventoTabela(ctx),
        ideEmpregador(cnpj),
        obrig('infoRubrica', [operacao(op, ide, dados, inicio)]),
      ];
    },
    inicio,
  );
}

/** S-1020: a lotação tributária do empregador (tipo 01: atividade da pessoa jurídica), com FPAS e terceiros. */
export function montarS1020(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  op: OperacaoTabelaEsocial,
  inicio: string,
): ResultadoEventoEsocial {
  return montar(
    'S-1020',
    ctx,
    e,
    (cnpj) => {
      const ide = (i: string) =>
        obrig('ideLotacao', [obrig('codLotacao', e.codLotacao), obrig('iniValid', i)]);
      const dados = obrig('dadosLotacao', [
        obrig('tpLotacao', '01'),
        obrig('fpasLotacao', [obrig('fpas', e.fpas), obrig('codTercs', e.codTercs)]),
      ]);
      return [
        ideEventoTabela(ctx),
        ideEmpregador(cnpj),
        obrig('infoLotacao', [operacao(op, ide, dados, inicio)]),
      ];
    },
    inicio,
  );
}
