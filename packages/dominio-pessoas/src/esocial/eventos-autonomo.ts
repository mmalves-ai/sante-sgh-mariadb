// C3-006 (06-FAT linha 45): os eventos periódicos do eSocial do contribuinte individual pago por RPA (recibo de
// pagamento ao autônomo do repasse), leiaute S-1.3. O RPA não tem vínculo (sem S-2300): o S-1200 leva o nome e o
// nascimento no `infoComplem`, a categoria 701 (contribuinte individual autônomo) e um demonstrativo por RPA; o S-1210
// paga o líquido do RPA na data do pagamento. As rubricas são as da tabela do empregador (S-1010): a remuneração, o
// desconto do INSS e o do IRRF retidos. Regras puras; a assinatura e o lote seguem o módulo do eSocial.
import {
  type ContextoEventoEsocial,
  type EmpregadorParaEvento,
  envelope,
  ideEmpregador,
  idEventoEsocial,
  pendencia,
  raizCnpj,
  type ResultadoEventoEsocial,
} from './comum.js';
import { decimalDeCentavos, el, obrig, textoCampo } from './xml.js';
import type { PendenciaEsocial } from '@sgh/contratos';

/** Categoria do contribuinte individual autônomo em geral (tabela 01 do eSocial). */
export const CATEGORIA_AUTONOMO = '701';

/** O autônomo do RPA (sem vínculo). */
export interface AutonomoParaEvento {
  readonly cpf: string | null;
  readonly nome: string;
  /** AAAA-MM-DD; o S-1200 de quem não tem S-2300 exige. */
  readonly nascimento: string | null;
  /** Código da tabela 01 (padrão 701). */
  readonly categoria?: string;
}

/** Os códigos das rubricas do empregador (S-1010) que o RPA usa. */
export interface RubricasDoRpa {
  readonly remuneracao: string | null;
  readonly inss: string | null;
  readonly irrf: string | null;
}

/** O RPA emitido, em centavos. */
export interface RpaParaEvento {
  readonly id: number;
  /** AAAA-MM: a competência do RPA (período de apuração do S-1200). */
  readonly competencia: string;
  readonly bruto: number;
  readonly inss: number;
  readonly irrf: number;
  readonly liquido: number;
  /** AAAA-MM-DD: o pagamento (S-1210); nulo enquanto não pago. */
  readonly pagoEm: string | null;
}

/** O identificador do demonstrativo do RPA: único no empregador e estável entre retificações. */
export const ideDmDevDoRpa = (rpa: number): string => `RPA${rpa}`;

const CPF_VALIDO = /^\d{11}$/;

function pendenciasAutonomo(e: EmpregadorParaEvento, a: AutonomoParaEvento): PendenciaEsocial[] {
  const p: PendenciaEsocial[] = [];
  if (!e.cnpj)
    p.push(pendencia('empregador-sem-cnpj', 'O cadastro da empresa não tem o CNPJ de 14 posições.'));
  if (!a.cpf || !CPF_VALIDO.test(a.cpf))
    p.push(pendencia('autonomo-sem-cpf', 'O profissional do RPA não tem CPF de 11 dígitos no cadastro.'));
  return p;
}

/** S-1200 do RPA: a remuneração do autônomo na competência, com o INSS e o IRRF retidos. */
export function montarS1200DoRpa(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  a: AutonomoParaEvento,
  rpa: RpaParaEvento,
  rubricas: RubricasDoRpa,
  reciboRetificado: string | null,
): ResultadoEventoEsocial {
  const p = pendenciasAutonomo(e, a);
  if (!a.nascimento)
    p.push(
      pendencia('autonomo-sem-nascimento', 'O profissional do RPA não tem a data de nascimento no cadastro.'),
    );
  if (rpa.bruto <= 0) p.push(pendencia('sem-remuneracao', 'O RPA não tem valor bruto.'));
  const itens: { codigo: string | null; valor: number; nome: string }[] = [
    { codigo: rubricas.remuneracao, valor: rpa.bruto, nome: 'remuneração' },
    { codigo: rubricas.inss, valor: rpa.inss, nome: 'INSS retido' },
    { codigo: rubricas.irrf, valor: rpa.irrf, nome: 'IRRF retido' },
  ].filter((i) => i.valor > 0);
  for (const i of itens)
    if (!i.codigo)
      p.push(
        pendencia('rubrica-ausente', `Informe nos parâmetros do RPA a rubrica do eSocial da ${i.nome}.`),
      );
  if (p.length) return { ok: false, pendencias: p };
  const cnpj = e.cnpj!;
  const id = idEventoEsocial(raizCnpj(cnpj), ctx.instante, ctx.sequencia);
  const raiz = envelope(
    'S-1200',
    ctx,
    [
      obrig('ideEvento', [
        obrig('indRetif', reciboRetificado ? 2 : 1),
        el('nrRecibo', reciboRetificado),
        obrig('indApuracao', 1),
        obrig('perApur', rpa.competencia),
        obrig('tpAmb', ctx.tpAmb),
        obrig('procEmi', 1),
        obrig('verProc', ctx.verProc),
      ]),
      ideEmpregador(cnpj),
      obrig('ideTrabalhador', [
        obrig('cpfTrab', a.cpf!),
        obrig('infoComplem', [obrig('nmTrab', textoCampo(a.nome, 70)), obrig('dtNascto', a.nascimento)]),
      ]),
      obrig('dmDev', [
        obrig('ideDmDev', ideDmDevDoRpa(rpa.id)),
        obrig('codCateg', a.categoria ?? CATEGORIA_AUTONOMO),
        obrig('infoPerApur', [
          obrig('ideEstabLot', [
            obrig('tpInsc', 1),
            obrig('nrInsc', cnpj),
            obrig('codLotacao', e.codLotacao),
            obrig(
              'remunPerApur',
              itens.map((i) =>
                obrig('itensRemun', [
                  obrig('codRubr', i.codigo),
                  obrig('ideTabRubr', e.ideTabRubr),
                  obrig('vrRubr', decimalDeCentavos(i.valor)),
                  obrig('indApurIR', 0),
                ]),
              ),
            ),
          ]),
        ]),
      ]),
    ],
    id,
  );
  return { ok: true, raiz, idEsocial: id, dataReferencia: rpa.competencia };
}

/** S-1210 do RPA: o pagamento do líquido no mês do pagamento (`perApur` = mês da data de pagamento). */
export function montarS1210DoRpa(
  ctx: ContextoEventoEsocial,
  e: EmpregadorParaEvento,
  a: AutonomoParaEvento,
  rpa: RpaParaEvento,
  reciboRetificado: string | null,
): ResultadoEventoEsocial {
  const p = pendenciasAutonomo(e, a);
  if (!rpa.pagoEm)
    p.push(pendencia('rpa-nao-pago', 'O RPA ainda não foi pago: o S-1210 sai com o pagamento.'));
  if (rpa.liquido < 0) p.push(pendencia('liquido-negativo', 'O líquido do RPA é negativo.'));
  if (p.length) return { ok: false, pendencias: p };
  const cnpj = e.cnpj!;
  const periodo = rpa.pagoEm!.slice(0, 7);
  const id = idEventoEsocial(raizCnpj(cnpj), ctx.instante, ctx.sequencia);
  const raiz = envelope(
    'S-1210',
    ctx,
    [
      obrig('ideEvento', [
        obrig('indRetif', reciboRetificado ? 2 : 1),
        el('nrRecibo', reciboRetificado),
        obrig('perApur', periodo),
        obrig('tpAmb', ctx.tpAmb),
        obrig('procEmi', 1),
        obrig('verProc', ctx.verProc),
      ]),
      ideEmpregador(cnpj),
      obrig('ideBenef', [
        obrig('cpfBenef', a.cpf!),
        obrig('infoPgto', [
          obrig('dtPgto', rpa.pagoEm),
          obrig('tpPgto', 1),
          obrig('perRef', rpa.competencia),
          obrig('ideDmDev', ideDmDevDoRpa(rpa.id)),
          obrig('vrLiq', decimalDeCentavos(rpa.liquido)),
        ]),
      ]),
    ],
    id,
  );
  return { ok: true, raiz, idEsocial: id, dataReferencia: periodo };
}
