// Linhas gravadas → respostas do formulário (o inverso do gravador): reabrir um rascunho (gravado aqui ou no
// outro sistema), trazer a última resposta do paciente (MANTERHIST, "copiar do último") e mostrar o registro
// gravado no renderizador. A linha é ligada à pergunta pela ORDEM e pelo ID da resposta (a mesma ORDEM pode ter
// vínculos de perguntas diferentes; leitura do M15). O que não se reconhece fica de fora e é contado.
import { ErroHoraInvalida, lerHoraDigitada, type RespostaRegistro, type ValorResposta } from '@sgh/contratos';
import type { ItemFormulario, RepresentacaoFormulario } from '../formulario/dfm/mapeamento.js';
import { pareceRtf, rtfParaTexto } from '../prontuario/rtf.js';
import type { LinhaResposta } from '../prontuario/respostas.js';
import { paragrafosDoTexto } from './rtf.js';

function textoPlano(t: string | null): string {
  if (!t) return '';
  if (!pareceRtf(t)) return t.trim();
  return rtfParaTexto(t)
    .paragrafos.map((p) => p.trechos.map((x) => x.texto).join(''))
    .join('\n')
    .trim();
}

/** Hora da linha em HH:MM pelo leitor neutro (aceita também os quatro dígitos das linhas já gravadas); null fora do formato. */
function horaTela(h: string | null): string | null {
  try {
    return lerHoraDigitada(h ?? '');
  } catch (e) {
    if (e instanceof ErroHoraInvalida) return null;
    throw e;
  }
}

function idsDoItem(i: ItemFormulario): Set<number> {
  const s = new Set<number>();
  const x = i['x-legacy'];
  if (x.idResposta) s.add(x.idResposta);
  for (const o of i.opcoes ?? []) if (o.idResposta) s.add(o.idResposta);
  for (const c of i.colunasGrade ?? []) if (c.idResposta) s.add(c.idResposta);
  return s;
}

function valorDasLinhas(item: ItemFormulario, ls: readonly LinhaResposta[]): ValorResposta | null {
  const tipo = item['x-legacy'].tipo ?? '';
  const l0 = ls.find((l) => l.seq === 0) ?? ls[0];
  if (!l0) return null;
  const indice = (l: LinhaResposta) =>
    l.indice === null || l.indice.trim() === '' ? null : Number(l.indice);
  switch (tipo) {
    case '5': {
      if (l0.texto && pareceRtf(l0.texto))
        return { tipo: 'formatado', paragrafos: rtfParaTexto(l0.texto).paragrafos };
      const t = textoPlano(l0.texto) || (l0.alfa ?? '').trim();
      return t ? { tipo: 'formatado', paragrafos: paragrafosDoTexto(t) } : null;
    }
    case '2':
      return l0.data && !l0.data.startsWith('1899-12-30')
        ? { tipo: 'data', data: l0.data.slice(0, 10) }
        : null;
    case '3': {
      const h = horaTela(l0.hora);
      return h ? { tipo: 'hora', hora: h } : null;
    }
    case '6':
    case '7':
      return l0.valor === null ? null : { tipo: 'numero', valor: l0.valor };
    case '11':
    case '15':
    case '16':
    case '17':
    case '20':
      return (l0.alfa ?? '').trim() ? { tipo: 'texto', texto: (l0.alfa ?? '').trim() } : null;
    case '4':
    case '13': {
      const i = indice(l0);
      if (i === null || !Number.isInteger(i)) return null;
      const comp = ls.find((l) => l.seq === 1)?.alfa?.trim();
      return comp ? { tipo: 'escolha', indice: i, complemento: comp } : { tipo: 'escolha', indice: i };
    }
    case '8': {
      const i = indice(l0);
      if (i === null || !Number.isInteger(i)) return null;
      const op = item.opcoes?.find((o) => o.indice === i)?.texto ?? (l0.alfa ?? '').trim();
      const t = textoPlano(l0.texto);
      return t && t !== op ? { tipo: 'escolha', indice: i, complemento: t } : { tipo: 'escolha', indice: i };
    }
    case '12': {
      const indices = [
        ...new Set(ls.map(indice).filter((x): x is number => x !== null && Number.isInteger(x))),
      ];
      return indices.length ? { tipo: 'multipla', indices: indices.sort((a, b) => a - b) } : null;
    }
    case '9': {
      const cols = item.colunasGrade ?? [];
      const seqs = [
        ...new Set(ls.filter((l) => l.idResposta !== item['x-legacy'].idResposta).map((l) => l.seq)),
      ].sort((a, b) => a - b);
      if (!cols.length || !seqs.length) return null;
      return {
        tipo: 'grade',
        linhas: seqs.map((s) =>
          cols.map((c) => {
            const l = ls.find((x) => x.seq === s && x.idResposta === c.idResposta);
            if (!l) return null;
            if (l.hora) return horaTela(l.hora);
            if (l.valor !== null) return String(l.valor).replace('.', ',');
            return (l.alfa ?? '').trim() || null;
          }),
        ),
      };
    }
    case '10': {
      const c = /^([A-Z]\d{2}(?:\.\d{1,2})?)/.exec((l0.cid ?? l0.alfa ?? '').trim());
      return c ? { tipo: 'cid', codigos: [c[1]!] } : null;
    }
    default:
      return null;
  }
}

/**
 * Respostas a partir das linhas gravadas. `soAtivos`: só as perguntas ligadas no modelo (rascunho e
 * pré-preenchimento); na visualização do registro gravado, todas (o registro antigo mostra o que tinha).
 */
export function respostasDasLinhas(
  rep: Pick<RepresentacaoFormulario, 'itens'>,
  linhas: readonly LinhaResposta[],
  opcoes: { readonly soAtivos?: boolean } = {},
): { respostas: RespostaRegistro[]; ignoradas: number } {
  const porOrdem = new Map<string, LinhaResposta[]>();
  for (const l of linhas) {
    const k = l.ordem.trim();
    porOrdem.set(k, [...(porOrdem.get(k) ?? []), l]);
  }
  const usadas = new Set<LinhaResposta>();
  const respostas: RespostaRegistro[] = [];
  const visitar = (itens: readonly ItemFormulario[]) => {
    for (const i of itens) {
      const x = i['x-legacy'];
      const daOrdem = porOrdem.get(x.ordem) ?? [];
      const ids = idsDoItem(i);
      const minhas = daOrdem.filter((l) => l.idResposta !== null && ids.has(l.idResposta));
      if (x.tipo === '1') for (const l of minhas) usadas.add(l);
      else if (minhas.length > 0 && (!opcoes.soAtivos || i.ativo)) {
        const v = valorDasLinhas(i, minhas);
        if (v) {
          for (const l of minhas) usadas.add(l);
          respostas.push({
            vinculo: x.vinculo,
            valor: v,
            autopreenchido: minhas.some((l) => l.autopreenchido),
            confirmado: true,
          });
        }
      }
      visitar(i.itens);
    }
  };
  visitar(rep.itens);
  return { respostas, ignoradas: linhas.filter((l) => !usadas.has(l)).length };
}
