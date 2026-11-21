// Dose (regra 7 da ficha do M24): faixa de dose do cadastro do item (mínima e máxima por dose e máxima nas 24 horas)
// e intervalo mínimo entre doses; a base de terceiros (DP-24) amplia as faixas quando contratada. Sem a faixa no
// cadastro, nenhum alerta.
import type { AlertaGerado, ItemAvaliado } from './tipos.js';

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export function alertasDose(item: ItemAvaliado): AlertaGerado[] {
  const r: AlertaGerado[] = [];
  for (const { produto, dose, unidade } of item.produtos) {
    if (dose === null) continue;
    const u = unidade ? ` ${unidade}` : '';
    // A faixa da unidade de prescrição do item; sem ela, a faixa única do produto.
    const faixa = unidade ? produto.faixasDose?.get(unidade.trim().toUpperCase()) : undefined;
    const doseMaxima = faixa ? faixa.maxima : produto.doseMaxima;
    const doseMinima = faixa ? faixa.minima : produto.doseMinima;
    if (doseMaxima !== null && dose > doseMaxima)
      r.push({
        id: `dose-maxima:${produto.produto}`,
        item: item.chave,
        tipo: 'dose-maxima',
        titulo: 'Dose acima da máxima',
        detalhe: `${produto.nome}: ${fmt(dose)}${u} por dose; a máxima do cadastro é ${fmt(doseMaxima)}${u}.`,
      });
    if (doseMinima !== null && dose < doseMinima)
      r.push({
        id: `dose-minima:${produto.produto}`,
        item: item.chave,
        tipo: 'dose-minima',
        titulo: 'Dose abaixo da mínima',
        detalhe: `${produto.nome}: ${fmt(dose)}${u} por dose; a mínima do cadastro é ${fmt(doseMinima)}${u}.`,
      });
    const dia = produto.doseMaximaDia ?? null;
    if (dia !== null && dose * item.dosesNoPeriodo > dia)
      r.push({
        id: `dose-maxima-dia:${produto.produto}`,
        item: item.chave,
        tipo: 'dose-maxima',
        titulo: 'Dose do dia acima da máxima',
        detalhe: `${produto.nome}: ${fmt(dose * item.dosesNoPeriodo)}${u} em 24 horas; a máxima é ${fmt(dia)}${u}.`,
      });
    const minimo = produto.periodoMinimoHoras ?? null;
    if (minimo !== null && item.intervaloHoras !== null && item.intervaloHoras < minimo)
      r.push({
        id: `intervalo:${produto.produto}`,
        item: item.chave,
        tipo: 'dose-maxima',
        titulo: 'Intervalo menor que o mínimo entre doses',
        detalhe: `${produto.nome}: a cada ${item.intervaloHoras} h; o mínimo do cadastro é ${minimo} h.`,
      });
  }
  return r;
}
