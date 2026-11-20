// Regras de faturabilidade como dados (ficha do M30, campo 6, SGH_FAT_REGRA_FATURAB; cap-06b §6.5, "Beneficiário,
// credenciamento e faturabilidade"): um seletor declarativo validado por Zod (tipo de conta, grupos de item, códigos),
// o que a regra exige (senha, carteira válida, guia, CID, autorização) e a ação, sempre "avisar": a violação vira aviso
// na conta (e pendência, se a regra for bloqueante para o fechamento no novo), nunca bloqueio do outro sistema.
import { z } from 'zod';
import type { GrupoItem } from './tipo-item.js';
import { vigenteNaData } from './vigencia.js';

export const EXIGENCIAS_FATURABILIDADE = ['senha', 'carteira-valida', 'guia', 'cid', 'autorizacao'] as const;
export type ExigenciaFaturabilidade = (typeof EXIGENCIAS_FATURABILIDADE)[number];

export const ROTULO_EXIGENCIA: Readonly<Record<ExigenciaFaturabilidade, string>> = {
  senha: 'senha de autorização',
  'carteira-valida': 'carteira do beneficiário dentro da validade',
  guia: 'número da guia',
  cid: 'CID principal',
  autorizacao: 'código de autorização no item',
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const esquemaSeletorFaturabilidade = z
  .object({
    tipoConta: z.enum(['E', 'I']).nullable().default(null),
    grupos: z
      .array(z.enum(['diarias-taxas', 'honorarios', 'sadt', 'matmed']))
      .max(4)
      .default([]),
    codigos: z.array(z.number().int().positive()).max(200).default([]),
  })
  .strict();
export type SeletorFaturabilidade = z.infer<typeof esquemaSeletorFaturabilidade>;

export const esquemaRegraFaturabilidade = z
  .object({
    convenio: z.number().int().min(0),
    nome: z.string().trim().min(3).max(80),
    exige: z.enum(EXIGENCIAS_FATURABILIDADE),
    seletor: esquemaSeletorFaturabilidade,
    acao: z.literal('avisar').default('avisar'),
    /** A violação também vira pendência que impede o fechamento no novo (nunca no outro sistema). */
    bloqueiaFechamento: z.boolean().default(false),
    inicio: z.string().regex(DATA),
    fim: z.string().regex(DATA).nullable().default(null),
  })
  .strict()
  .refine((r) => r.fim === null || r.fim >= r.inicio, { message: 'O fim é antes do início.', path: ['fim'] });
export type RegraFaturabilidade = z.infer<typeof esquemaRegraFaturabilidade>;

export interface FatosFaturabilidade {
  readonly convenio: number;
  readonly tipoConta: 'E' | 'I';
  readonly dataBase: string;
  readonly senha: string | null;
  readonly guia: string | null;
  readonly cid: string | null;
  /** Validade da carteira (AAAA-MM-DD) ou null. */
  readonly validadeCarteira: string | null;
  readonly itens: readonly {
    readonly grupo: GrupoItem | null;
    readonly codigo: number;
    readonly autorizacao: string | null;
  }[];
}

export interface ViolacaoFaturabilidade {
  readonly regra: string;
  readonly exige: ExigenciaFaturabilidade;
  readonly mensagem: string;
  readonly bloqueiaFechamento: boolean;
}

const vazio = (t: string | null | undefined) => !t || !t.trim() || /^0+$/.test(t.trim());

/** A regra vale na data-base (vigência fechada no fim) e para este convênio (0 = todos). */
export function regraVigente(r: RegraFaturabilidade, convenio: number, dataBase: string): boolean {
  if (r.convenio !== 0 && r.convenio !== convenio) return false;
  if (!vigenteNaData([{ data: r.inicio, valor: 1 }], dataBase)) return false;
  return r.fim === null || dataBase.slice(0, 10) <= r.fim;
}

function selecionaItens(r: RegraFaturabilidade, f: FatosFaturabilidade) {
  return f.itens.filter(
    (i) =>
      (r.seletor.grupos.length === 0 || (i.grupo !== null && r.seletor.grupos.includes(i.grupo))) &&
      (r.seletor.codigos.length === 0 || r.seletor.codigos.includes(i.codigo)),
  );
}

/** Avalia as regras sobre a conta: cada violação é um aviso (nunca altera nem bloqueia o outro sistema). */
export function avaliarFaturabilidade(
  regras: readonly (RegraFaturabilidade & { readonly id?: number })[],
  f: FatosFaturabilidade,
): ViolacaoFaturabilidade[] {
  const v: ViolacaoFaturabilidade[] = [];
  for (const r of regras) {
    if (!regraVigente(r, f.convenio, f.dataBase)) continue;
    if (r.seletor.tipoConta && r.seletor.tipoConta !== f.tipoConta) continue;
    const alvo = selecionaItens(r, f);
    const temSeletorDeItem = r.seletor.grupos.length > 0 || r.seletor.codigos.length > 0;
    if (temSeletorDeItem && alvo.length === 0) continue;
    let falhou = false;
    switch (r.exige) {
      case 'senha':
        falhou = vazio(f.senha);
        break;
      case 'guia':
        falhou = vazio(f.guia);
        break;
      case 'cid':
        falhou = vazio(f.cid);
        break;
      case 'carteira-valida':
        falhou = !f.validadeCarteira || f.validadeCarteira.slice(0, 10) < f.dataBase.slice(0, 10);
        break;
      case 'autorizacao':
        falhou = (temSeletorDeItem ? alvo : f.itens).some((i) => vazio(i.autorizacao));
        break;
    }
    if (falhou)
      v.push({
        regra: r.nome,
        exige: r.exige,
        mensagem: `Regra "${r.nome}": falta ${ROTULO_EXIGENCIA[r.exige]}.`,
        bloqueiaFechamento: r.bloqueiaFechamento,
      });
  }
  return v;
}
