// W0-08, parte 8b (mercado M2: tecnovigilância e recall ligados ao parque instalado; RDC 67/2009, RDC 551/2021 e RDC
// 509/2021): as regras puras do domínio entregues à gravação da porta como callback (a porta não importa o domínio)
// e a montagem da lista de afetados para a tela.
import type {
  AfetadoAlerta,
  AlertaEquipamento,
  RecusaAlertaEquipamento,
  RegistrarAlertaEquipamentoEntrada,
} from '@sgh/contratos';
import {
  afetadosDoAlerta,
  conferirAlteracaoAlerta,
  descricaoDaAcaoDeCampo,
  faixaInvertida,
  planejarAcaoDeCampo,
} from '@sgh/dominio-manutencao';
import type { AcaoDeCampo, EquipamentoDoParque } from './tipos.js';

/** Inclusão: a faixa de série não pode vir invertida. */
export const conferirFaixaDoAlerta =
  (x: Pick<RegistrarAlertaEquipamentoEntrada, 'serieInicio' | 'serieFim'>) =>
  (): RecusaAlertaEquipamento | null =>
    faixaInvertida(x.serieInicio, x.serieFim) ? 'faixa-invertida' : null;

/** Alteração pela versão vista: encerrado não muda; o critério não muda depois da primeira OS de ação de campo. */
export const conferirAlteracaoDoAlerta =
  (
    versaoVista: number,
    novo: Pick<AlertaEquipamento, 'numero' | 'fabricante' | 'modelo' | 'serieInicio' | 'serieFim'>,
  ) =>
  (atual: AlertaEquipamento): RecusaAlertaEquipamento | null => {
    const c = conferirAlteracaoAlerta(atual, versaoVista, novo);
    return c.ok ? null : c.motivo;
  };

/** A lista do parque diante do alerta (afetados e a conferir, com a OS já gerada). */
export const afetados = (
  alerta: AlertaEquipamento,
  parque: readonly EquipamentoDoParque[],
  acoes: readonly AcaoDeCampo[],
): AfetadoAlerta[] => afetadosDoAlerta(parque, alerta, acoes);

/**
 * A ação de campo planejada sobre o alerta, o parque e as OS relidos com a trava, pela VERSÃO VISTA pela pessoa (um
 * alerta alterado por outra pessoa entre a leitura e o clique recusa `desatualizado`).
 */
export const planejarAcaoDoAlerta =
  (versaoVista: number, pedidos: readonly number[]) =>
  (
    alerta: AlertaEquipamento,
    parque: readonly EquipamentoDoParque[],
    acoes: readonly AcaoDeCampo[],
  ) => {
    const p = planejarAcaoDeCampo(alerta, versaoVista, afetados(alerta, parque, acoes), pedidos);
    if (!p.ok) return p;
    return {
      ok: true as const,
      equipamentos: p.equipamentos.map((q) => ({
        equipamento: q.equipamento,
        centroCusto: q.centroCusto,
        descricao: descricaoDaAcaoDeCampo(alerta, q),
      })),
    };
  };
