// Cliente da hierarquia da CID-10 e do perfil epidemiológico por capítulo (F7, 09-AREA linha 83), validado na chegada.
// Só leitura: as rotas devolvem contagens (nenhum dado de pessoa).
import { z } from 'zod';
import { ler, qs } from '../../exames/api-exames.js';

const A = '/api/qualidade/vigilancia/perfil-cid';

const capitulo = z.object({
  codigo: z.string(),
  numero: z.number(),
  inicial: z.string(),
  final: z.string(),
  descricao: z.string(),
});
const agrupamento = z.object({
  codigo: z.string(),
  capitulo: z.string(),
  pai: z.string().nullable(),
  nivel: z.enum(['grupo', 'subgrupo']),
  inicial: z.string(),
  final: z.string(),
  descricao: z.string(),
});

export const esquemaLocalizacaoCid = z.object({
  cid: z.string(),
  categoria: z.string(),
  descricao: z.string().nullable(),
  capitulo,
  agrupamentos: z.array(agrupamento),
});
export type LocalizacaoCidTela = z.infer<typeof esquemaLocalizacaoCid>;

export interface NoPerfilTela {
  codigo: string;
  descricao: string;
  nivel: 'capitulo' | 'grupo' | 'subgrupo';
  diagnosticos: number;
  percentual: number;
  filhos: NoPerfilTela[];
}
const no: z.ZodType<NoPerfilTela> = z.lazy(() =>
  z.object({
    codigo: z.string(),
    descricao: z.string(),
    nivel: z.enum(['capitulo', 'grupo', 'subgrupo']),
    diagnosticos: z.number(),
    percentual: z.number(),
    filhos: z.array(no),
  }),
);

export const esquemaPerfilCid = z.object({
  desde: z.string(),
  ate: z.string(),
  total: z.number(),
  semCapitulo: z.number(),
  atendimentos: z.number(),
  pacientes: z.number(),
  capitulos: z.array(no),
});
export type PerfilCidTela = z.infer<typeof esquemaPerfilCid>;

export interface FiltroPerfilCidTela {
  desde: string;
  ate: string;
  principal: boolean;
  suspeitos: boolean;
}

export const lerPerfilCid = (f: FiltroPerfilCidTela): Promise<PerfilCidTela> =>
  ler(
    `${A}${qs({ desde: f.desde, ate: f.ate, principal: f.principal || null, suspeitos: f.suspeitos || null })}`,
    esquemaPerfilCid,
  );

export const localizarCidNaHierarquia = (cid: string): Promise<LocalizacaoCidTela> =>
  ler(`${A}/cid/${encodeURIComponent(cid)}`, esquemaLocalizacaoCid);
