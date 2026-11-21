// Entradas das operações só do novo da cirurgia segura e do rastreio no bloco (ficha do M46, etapa 2; seção 5,
// operações próprias do sistema): cirurgia.confirmarItemChecklist, cirurgia.concluirMomentoChecklist, a exceção da trava da
// incisão (urgência, por supervisor, com motivo) e cirurgia.moverPacienteBloco. Validadas na tela, na API e na gravação
// (o mesmo Zod). O agendamento é o id do agendamento cirúrgico; o local e o tipo de movimentação são os IDs do cadastro do bloco.
// Datas e horas locais AAAA-MM-DDTHH:mm (o servidor confere contra o relógio do banco).
import { z } from 'zod';
import { esquemaChaveAto, esquemaDataHoraLocal } from '../enfermagem/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import {
  CODIGOS_MOMENTO_CHECKLIST,
  CODIGOS_MOVIMENTO_BLOCO,
  DESTINOS_SAIDA_BLOCO,
  RESPOSTAS_CHECKLIST,
} from './bloco-seguro-vocabulario.js';

const id = z.number().int().positive().max(2_147_483_647);
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const opcional = (max: number) => livre(max).nullable().default(null);
const enumDe = <T extends readonly { codigo: string }[]>(l: T) =>
  z.enum(l.map((x) => x.codigo) as [T[number]['codigo'], ...T[number]['codigo'][]]);

// ── cirurgia.confirmarItemChecklist ─────────────────────────────────────────────────────────────────────────────

export const esquemaRespostaItemChecklist = z
  .object({
    item: z.string().regex(/^[a-zA-Z]{3,30}$/, 'Item do checklist inválido.'),
    resposta: enumDe(RESPOSTAS_CHECKLIST),
    observacao: opcional(255),
  })
  .strict();

export const esquemaConfirmarItensChecklist = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    momento: z.enum(CODIGOS_MOMENTO_CHECKLIST),
    /** A versão do checklist que a tela viu (0: nenhum aberto); outra gravação no meio recusa (`checklist-mudou`). */
    versaoVista: z.number().int().min(0),
    /** O horário da confirmação (a hora em que o circulante conferiu o item). */
    em: esquemaDataHoraLocal,
    itens: z.array(esquemaRespostaItemChecklist).min(1).max(20),
  })
  .strict()
  .refine((e) => new Set(e.itens.map((i) => i.item)).size === e.itens.length, {
    message: 'Item repetido no mesmo pedido.',
    path: ['itens'],
  });
export type ConfirmarItensChecklistEntrada = z.infer<typeof esquemaConfirmarItensChecklist>;

// ── cirurgia.concluirMomentoChecklist ───────────────────────────────────────────────────────────────────────────

export const esquemaConcluirMomentoChecklist = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    momento: z.enum(CODIGOS_MOMENTO_CHECKLIST),
    versaoVista: z.number().int().min(1),
    em: esquemaDataHoraLocal,
  })
  .strict();
export type ConcluirMomentoChecklistEntrada = z.infer<typeof esquemaConcluirMomentoChecklist>;

// ── Exceção da trava da incisão (regra 2) ───────────────────────────────────────────────────────────────────────

export const esquemaExcecaoIncisao = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    versaoVista: z.number().int().min(0),
    /** O supervisor declara a urgência (a eletiva não tem exceção). */
    urgencia: z.literal(true),
    motivo: livre(400).pipe(z.string().min(10, 'Descreva o motivo (ao menos 10 caracteres).')),
    em: esquemaDataHoraLocal,
  })
  .strict();
export type ExcecaoIncisaoEntrada = z.infer<typeof esquemaExcecaoIncisao>;

// ── cirurgia.moverPacienteBloco ─────────────────────────────────────────────────────────────────────────────────

export const esquemaMoverPacienteBloco = z
  .object({
    agendamento: id,
    chave: esquemaChaveAto,
    /** O último movimento que a tela viu (0: nenhum); outro gravado no meio recusa (`rastreio-mudou`). */
    ultimoVisto: z.number().int().min(0),
    tipo: z.enum(CODIGOS_MOVIMENTO_BLOCO),
    /** O local para onde o paciente vai (ID do cadastro do bloco); a saída do bloco não tem local. */
    local: z.number().int().min(1).max(32767).nullable().default(null),
    /** A sala cirúrgica, quando o local é a sala. */
    salaCirurgica: z.number().int().min(1).max(32767).nullable().default(null),
    em: esquemaDataHoraLocal,
    destino: enumDe(DESTINOS_SAIDA_BLOCO).nullable().default(null),
    observacao: opcional(255),
  })
  .strict()
  .refine((m) => (m.tipo === 'alta') === (m.destino !== null), {
    message: 'O destino vai só na saída do bloco, e a saída exige o destino.',
    path: ['destino'],
  })
  .refine((m) => m.tipo === 'alta' || m.tipo === 'cancelamentoAlta' || m.local !== null, {
    message: 'Informe o local do bloco.',
    path: ['local'],
  });
export type MoverPacienteBlocoEntrada = z.infer<typeof esquemaMoverPacienteBloco>;
