// W0-04 (M1, mercado: dispositivos invasivos do paciente): a aba de dispositivos do prontuário usa o MESMO registro
// da CCIH (SGH_QUA_DISPOSITIVO): inserção, sítio, retirada e, por turno, o checklist do bundle de manutenção. O alerta
// de permanência longa (a sonda vesical acima de 48 horas sem a indicação revisada nas últimas 24 horas) e os
// dispositivos-dia saem do mesmo registro que alimenta os denominadores da CCIH. Base: Anvisa, Medidas de prevenção
// de infecção relacionada à assistência à saúde (2017), capítulos de ITU, IPCS e PAV.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import type { TipoDispositivoInvasivo } from './ccih.js';

export const TURNOS_BUNDLE = [
  { codigo: 'manha', rotulo: 'Manhã', inicio: 7, fim: 13 },
  { codigo: 'tarde', rotulo: 'Tarde', inicio: 13, fim: 19 },
  { codigo: 'noite', rotulo: 'Noite', inicio: 19, fim: 7 },
] as const;
export type TurnoBundle = (typeof TURNOS_BUNDLE)[number]['codigo'];
export const CODIGOS_TURNO_BUNDLE = TURNOS_BUNDLE.map((t) => t.codigo) as [TurnoBundle, ...TurnoBundle[]];

/** Os itens do bundle de manutenção por tipo de dispositivo (o primeiro de cada um é a indicação revisada). */
export const ITENS_BUNDLE: Readonly<
  Partial<Record<TipoDispositivoInvasivo, readonly { codigo: string; rotulo: string }[]>>
> = {
  sondaVesical: [
    { codigo: 'indicacao', rotulo: 'Indicação de manter a sonda revisada no turno' },
    { codigo: 'sistemaFechado', rotulo: 'Sistema de drenagem fechado e sem dobras' },
    { codigo: 'bolsaAbaixo', rotulo: 'Bolsa abaixo do nível da bexiga, sem tocar o chão' },
    { codigo: 'higieneMeato', rotulo: 'Higiene do meato uretral feita' },
    { codigo: 'fixacao', rotulo: 'Sonda fixada corretamente' },
  ],
  cvc: [
    { codigo: 'indicacao', rotulo: 'Necessidade do cateter revisada no turno' },
    { codigo: 'curativo', rotulo: 'Curativo íntegro, limpo, seco e datado' },
    { codigo: 'desinfeccao', rotulo: 'Conectores desinfetados antes de cada acesso' },
    { codigo: 'equipos', rotulo: 'Equipos e conectores dentro do prazo de troca' },
  ],
  ventilacaoMecanica: [
    { codigo: 'indicacao', rotulo: 'Possibilidade de extubação avaliada no turno' },
    { codigo: 'cabeceira', rotulo: 'Cabeceira elevada entre 30 e 45 graus' },
    { codigo: 'sedacao', rotulo: 'Interrupção diária da sedação avaliada' },
    { codigo: 'higieneOral', rotulo: 'Higiene oral com antisséptico feita' },
    { codigo: 'cuff', rotulo: 'Pressão do balonete conferida' },
  ],
};

/** Permanência acima da qual o dispositivo pede a indicação revisada nas últimas 24 horas (alerta). */
export const LIMITE_PERMANENCIA_HORAS: Readonly<Partial<Record<TipoDispositivoInvasivo, number>>> = {
  sondaVesical: 48,
  cvc: 7 * 24,
};

/** O checklist do bundle de um dispositivo num turno. */
export const esquemaRegistrarBundle = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  turno: z.enum(CODIGOS_TURNO_BUNDLE),
  /** Cada item do bundle do tipo: feito (true) ou não (false). */
  itens: z.record(z.string().regex(/^[a-zA-Z]{2,20}$/), z.boolean()),
  observacao: textoCp1252(200).nullable(),
});
export type RegistrarBundleEntrada = z.infer<typeof esquemaRegistrarBundle>;

/**
 * Revisão do W0-04 (regras_governanca do pacote, "Checagem/anotação de enfermagem"): corrigir o checklist do turno por
 * versão, pelo autor e com justificativa (o turno e o dispositivo não mudam: o lançado no dispositivo errado se estorna
 * e se registra de novo no certo).
 */
export const esquemaCorrigirBundle = z.object({
  versao: z.number().int().min(1),
  itens: z.record(z.string().regex(/^[a-zA-Z]{2,20}$/), z.boolean()),
  observacao: textoCp1252(200).nullable(),
  justificativa: textoCp1252(500).pipe(z.string().trim().min(10)),
});
export type CorrigirBundleEntrada = z.infer<typeof esquemaCorrigirBundle>;

export interface BundleDispositivoLido {
  readonly id: number;
  readonly dispositivo: number;
  readonly data: string;
  readonly turno: TurnoBundle;
  readonly itens: Readonly<Record<string, boolean>>;
  readonly conforme: boolean;
  readonly indicacaoRevisada: boolean;
  readonly observacao: string | null;
  readonly registradoPor: string;
  readonly registradoEm: string;
  /** Revisão do W0-04: a versão (correção) e o estorno (fica visível como inativo, fora do alerta e da conformidade). */
  readonly versao?: number;
  readonly estornadoEm?: string | null;
  readonly estornadoPor?: string | null;
  readonly motivoEstorno?: string | null;
}

/** O alerta de permanência longa do dispositivo. */
export interface AlertaPermanencia {
  readonly horas: number;
  readonly limiteHoras: number;
  /** A última indicação revisada (bundle com o item "indicacao" marcado), quando houver. */
  readonly ultimaIndicacao: string | null;
}
