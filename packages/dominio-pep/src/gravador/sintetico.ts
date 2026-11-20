// Respostas SINTÉTICAS para um modelo (testes, reprodução das assinaturas e E2E): uma resposta por pergunta ativa
// que o gravador grava, com valores marcados "SINTETICO" (nenhum dado de pessoa). Determinístico pela semente.
import type { RespostaRegistro, ValorResposta } from '@sgh/contratos';
import type { ItemFormulario, RepresentacaoFormulario } from '../formulario/dfm/mapeamento.js';
import { podeGravar, TIPOS_GRAVADOS } from './colunas.js';

export const MARCA_SINTETICA_PEP = 'SINTETICO M22';

export interface OpcoesSinteticas {
  readonly semente?: number;
  /** Só estes tipos de pergunta (padrão: todos os gravados). */
  readonly tipos?: ReadonlySet<string>;
  /** No máximo N respostas (as primeiras na ordem da árvore). */
  readonly maximo?: number;
  /** Texto com acentos e símbolos do CP1252 (ida e volta do codec). */
  readonly acentos?: boolean;
  readonly dataBase?: string;
}

function valorSintetico(i: ItemFormulario, k: number, o: OpcoesSinteticas): ValorResposta | null {
  const t = i['x-legacy'].tipo ?? '';
  const texto = o.acentos
    ? `${MARCA_SINTETICA_PEP} ação — coração “sem queixas” ${k} ºC €`
    : `${MARCA_SINTETICA_PEP} ${k}`;
  const ops = i.opcoes ?? [];
  switch (t) {
    case '5':
      return {
        tipo: 'formatado',
        paragrafos: [
          {
            alinhamento: 'esquerda',
            recuo: 0,
            trechos: [{ texto, negrito: false, italico: false, sublinhado: false, cor: 0 }],
          },
          {
            alinhamento: 'esquerda',
            recuo: 1,
            trechos: [
              { texto: `linha ${k}`, negrito: k % 2 === 0, italico: false, sublinhado: false, cor: 0 },
            ],
          },
        ],
      };
    case '2':
      return { tipo: 'data', data: o.dataBase ?? '2026-07-04' };
    case '3':
      return {
        tipo: 'hora',
        hora: `${String(8 + (k % 10)).padStart(2, '0')}:${String((k * 7) % 60).padStart(2, '0')}`,
      };
    case '6':
      return { tipo: 'numero', valor: 36.5 + (k % 3) / 10 };
    case '7':
      return { tipo: 'numero', valor: 60 + (k % 40) };
    case '11':
    case '15':
    case '16':
    case '17':
    case '20':
      return { tipo: 'texto', texto: `${MARCA_SINTETICA_PEP} ${k}`.slice(0, i.tamanhoMaximo ?? 200) };
    case '4':
    case '13': {
      const op = ops[k % ops.length];
      return op ? { tipo: 'escolha', indice: op.indice } : null;
    }
    case '8': {
      const op = ops[k % ops.length];
      return op
        ? k % 2
          ? { tipo: 'escolha', indice: op.indice, complemento: texto }
          : { tipo: 'escolha', indice: op.indice }
        : null;
    }
    case '12': {
      const marcadas = ops.filter((_, j) => j % 2 === k % 2).map((x) => x.indice);
      return marcadas.length
        ? { tipo: 'multipla', indices: marcadas }
        : ops[0]
          ? { tipo: 'multipla', indices: [ops[0].indice] }
          : null;
    }
    case '9': {
      const cols = i.colunasGrade ?? [];
      if (!cols.length) return null;
      const cel = (c: (typeof cols)[number], linha: number) =>
        c.tipo === '2' || c.tipo === '3'
          ? `${String(7 + linha).padStart(2, '0')}:00`
          : c.tipo === '5' || c.tipo === '6' || c.tipo === '7'
            ? String(36 + linha)
            : `${120 + linha}/80`;
      return { tipo: 'grade', linhas: [0, 1].map((l) => cols.map((c) => cel(c, l))) };
    }
    case '10':
      return { tipo: 'cid', codigos: ['I10'] };
    default:
      return null;
  }
}

export function respostasSinteticas(
  rep: Pick<RepresentacaoFormulario, 'itens'>,
  opcoes: OpcoesSinteticas = {},
): RespostaRegistro[] {
  const tipos = opcoes.tipos ?? TIPOS_GRAVADOS;
  const r: RespostaRegistro[] = [];
  let k = opcoes.semente ?? 0;
  const visitar = (itens: readonly ItemFormulario[]) => {
    for (const i of itens) {
      if (!i.ativo) continue;
      const t = i['x-legacy'].tipo ?? '';
      if (
        t !== '1' &&
        tipos.has(t) &&
        podeGravar(i) &&
        (opcoes.maximo === undefined || r.length < opcoes.maximo)
      ) {
        const v = valorSintetico(i, k++, opcoes);
        if (v) r.push({ vinculo: i['x-legacy'].vinculo, valor: v, autopreenchido: false, confirmado: false });
      }
      visitar(i.itens);
    }
  };
  visitar(rep.itens);
  return r;
}
