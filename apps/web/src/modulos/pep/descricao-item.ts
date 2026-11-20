// Descrição curta de um item da prescrição na tela (lista do editor, painel de alertas): o produto ou o cadastro
// pelo nome, a dose, a via e a frequência. Sem texto livre do paciente.
import type { ItemPrescricao } from '@sgh/contratos';

export interface NomesDoEditor {
  readonly produtos: ReadonlyMap<number, string>;
  readonly dominio: (lista: string, id: string | number | null | undefined) => string | null;
}

const num = (n: number) => n.toLocaleString('pt-BR');

export function descreverItem(i: ItemPrescricao, nomes: NomesDoEditor): string {
  const d = i.detalhe;
  const freq = 'frequencia' in d ? nomes.dominio('frequencias', d.frequencia) : null;
  const partes: (string | null)[] = [];
  switch (d.tipo) {
    case 'medicamento':
      partes.push(
        nomes.produtos.get(d.item.produto) ?? `Produto ${d.item.produto}`,
        `${num(d.dose)} ${d.unidade}`,
        nomes.dominio('vias', d.via) ?? d.via,
        freq,
        d.seNecessario ? 'se necessário' : null,
        d.iniciarAgora ? 'agora' : null,
      );
      break;
    case 'solucao':
      partes.push(
        d.componentes.map((c) => nomes.produtos.get(c.produto) ?? `Produto ${c.produto}`).join(' + '),
        nomes.dominio('vias', d.via) ?? d.via,
        freq,
      );
      break;
    case 'jejum':
    case 'dieta-livre':
    case 'dieta-oral':
    case 'dieta-enteral':
      partes.push(
        nomes.dominio('dietas', d.dieta) ?? `Dieta ${d.dieta}`,
        'quantidade' in d ? num(d.quantidade) : null,
        freq,
      );
      break;
    case 'procedimento':
      partes.push(nomes.dominio('procedimentos', d.procedimento) ?? `Cuidado ${d.procedimento}`, freq);
      break;
    case 'glicemia':
      partes.push(
        nomes.dominio('procedimentos', d.procedimento) ?? `Cuidado ${d.procedimento}`,
        `escala com ${d.faixas.length} faixa(s)`,
        freq,
      );
      break;
    case 'vni':
    case 'vmi':
      partes.push(
        nomes.dominio('modos', d.modo) ?? `Modo ${d.modo}`,
        d.fio2 ? `FiO2 ${d.fio2}%` : null,
        freq,
      );
      break;
    case 'hemoterapia':
      partes.push(
        nomes.dominio('hemocomponentes', `${d.hemocomponente.ato}:${d.hemocomponente.codigo}`) ??
          d.hemocomponente.codigo,
        `${num(d.dose)} ${d.unidade}`,
        freq,
      );
      break;
  }
  return partes.filter((x): x is string => !!x).join(' · ');
}

/** Hora local do aparelho no formato da prescrição (AAAA-MM-DDTHH:MM). */
export function agoraLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
