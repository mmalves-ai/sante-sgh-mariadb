// Porta das leituras próprias da fila do médico (M27; ficha, seção 4): a previsão de alta da internação, os resultados
// de exame liberados dos pacientes da fila e as prescrições que vencem sem a do período seguinte. O resto da fila vem
// das portas do M23 (painel "Meus pacientes", pendências de assinatura, completude):
//   - `proprio`: o banco do cliente pelo @sgh/nucleo (worklist-porta-propria.ts), só leitura;
//   - `memoria`: a sessão sintética de dev/ci (os resultados do prontuário em memória);
//   - indisponível: fora de dev/ci sem o núcleo, 503 (falha fechada).
// Melhoria: tipos de negócio próprios (data ISO, ids numéricos, booleano), sem a marca de "visto no outro sistema"
// (não há outro sistema: o resultado é visto quando o médico o abre ou dá ciência).
import { portaIndisponivel } from '../exames/public-api.js';
import type { ContextoDocs, PortaDocumentos } from './documentos-porta.js';

export const PORTA_WORKLIST = Symbol('PORTA_WORKLIST');

export interface FiltroWorklist {
  readonly login: string;
  readonly pacientes: readonly number[];
  /** Internações da fila (o `registro` da linha do painel de internados). */
  readonly internacoes: readonly number[];
  /** Início da janela dos resultados (data civil do estabelecimento, à meia-noite). */
  readonly desde: Date;
}

/** Previsão de alta vigente de uma internação (data ISO, AAAA-MM-DD). */
export interface PrevisaoAltaDaFila {
  readonly internacao: number;
  readonly previsao: string;
}

/** Resultado de exame liberado de um paciente da fila. */
export interface ResultadoDaFila {
  readonly paciente: number;
  /** Id do resultado do exame. */
  readonly exame: number;
  /** Data da liberação no fuso do estabelecimento (AAAA-MM-DD). */
  readonly liberadoEm: string;
  /** O médico já abriu o resultado. */
  readonly vistoPeloMedico: boolean;
}

export interface LeiturasDaWorklist {
  readonly previsoesAlta: readonly PrevisaoAltaDaFila[];
  readonly resultados: readonly ResultadoDaFila[];
}

/** Prescrição que vence na janela sem a do período seguinte; `fim` na hora civil do estabelecimento. */
export interface PrescricaoARenovar {
  readonly atendimento: number;
  readonly fim: string | null;
}

export interface PortaWorklist {
  readonly destino: 'proprio' | 'memoria';
  leituras(c: ContextoDocs, f: FiltroWorklist): Promise<LeiturasDaWorklist>;
  /**
   * As prescrições dos atendimentos da fila que vencem entre `agora` e `ate` (hora civil do estabelecimento,
   * AAAA-MM-DDTHH:MM:SS) sem a do período seguinte. Opcional: sem ela (memória), a fila usa a leitura do M24 por data e
   * filtra os atendimentos.
   */
  aRenovar?(
    c: ContextoDocs,
    atendimentos: readonly number[],
    agora: string,
    ate: string,
  ): Promise<PrescricaoARenovar[]>;
}

/** Memória: os resultados liberados do prontuário sintético; a previsão de alta da internação sintética (dois dias). */
export class PortaWorklistMemoria implements PortaWorklist {
  readonly destino = 'memoria' as const;
  constructor(private readonly documentos: PortaDocumentos | null) {}

  async leituras(c: ContextoDocs, f: FiltroWorklist): Promise<LeiturasDaWorklist> {
    const desde = f.desde.toISOString().slice(0, 10);
    const resultados: ResultadoDaFila[] = [];
    for (const p of f.pacientes)
      for (const r of (await this.documentos?.resultados(c, p)) ?? [])
        if (r.liberadoEm && r.liberadoEm.slice(0, 10) >= desde)
          resultados.push({
            paciente: p,
            exame: r.exame,
            liberadoEm: r.liberadoEm.slice(0, 10),
            vistoPeloMedico: false,
          });
    const em2dias = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    return {
      previsoesAlta: f.internacoes.map((internacao) => ({ internacao, previsao: em2dias })),
      resultados,
    };
  }
}

export function portaWorklistIndisponivel(): PortaWorklist {
  return portaIndisponivel<PortaWorklist>(new Set(['leituras']));
}
