// Porta das leituras próprias da fila do médico (M27; ficha, seção 4): a previsão de alta da internação e, por exame
// liberado, a visualização registrada pelo outro sistema e a leitura pelo médico no novo. O resto da fila vem das portas
// do M23 (painel "Meus pacientes", pendências de assinatura, completude) e do M24 (prescrições a vencer).
//   - `legado`: READ ONLY pelos repositórios de @sgh/legado;
//   - `memoria`: a sessão sintética (os resultados do prontuário em memória; nada visualizado no outro sistema);
//   - indisponível: 503.
import {
  leiturasDaWorklistMedico,
  type LeiturasDaWorklist,
  type NucleoLegado,
  type PrescricaoARenovarLida,
  prescricoesARenovar,
} from '@sgh/legado';
import { portaIndisponivel } from '../exames/public-api.js';
import type { ContextoDocs, PortaDocumentos } from './documentos-porta.js';

export const PORTA_WORKLIST = Symbol('PORTA_WORKLIST');

export interface FiltroWorklist {
  readonly login: string;
  readonly pacientes: readonly number[];
  readonly registros: readonly number[];
  readonly desde: Date;
}

export interface PortaWorklist {
  readonly destino: 'legado' | 'memoria';
  leituras(c: ContextoDocs, f: FiltroWorklist): Promise<LeiturasDaWorklist>;
  /**
   * As prescrições dos atendimentos da fila que vencem entre `agora` e `ate` (hora local, AAAA-MM-DDTHH:MM:SS) sem a
   * do período seguinte. Opcional: sem ela (memória), a fila usa a leitura do M24 por data e filtra os atendimentos.
   */
  aRenovar?(
    c: ContextoDocs,
    atendimentos: readonly number[],
    agora: string,
    ate: string,
  ): Promise<PrescricaoARenovarLida[]>;
}

/** Hora local do banco (AAAA-MM-DDTHH:MM:SS) como Date de componentes locais (o driver grava os componentes). */
function dataLocal(s: string): Date {
  const [d = '', h = ''] = s.split('T');
  const [a, m, dia] = d.split('-').map(Number);
  const [hh, mm, ss] = h.split(':').map((x) => Number(x.slice(0, 2)));
  return new Date(a ?? 0, (m ?? 1) - 1, dia ?? 1, hh ?? 0, mm ?? 0, ss ?? 0);
}

export function portaWorklistLegado(nucleo: NucleoLegado): PortaWorklist {
  return {
    destino: 'legado',
    leituras: (c, f) =>
      nucleo.lerSomente({ rede: c.rede, hospital: c.hospital, traceId: 'worklist-medico' }, (l) =>
        leiturasDaWorklistMedico(l, { hospital: c.hospital, ...f }),
      ),
    aRenovar: (c, atendimentos, agora, ate) =>
      nucleo.lerSomente({ rede: c.rede, hospital: c.hospital, traceId: 'worklist-medico' }, (l) =>
        prescricoesARenovar(l, { atendimentos, agora: dataLocal(agora), ate: dataLocal(ate) }),
      ),
  };
}

/** Memória: os resultados liberados do prontuário sintético; a previsão de alta da internação sintética (dois dias). */
export class PortaWorklistMemoria implements PortaWorklist {
  readonly destino = 'memoria' as const;
  constructor(private readonly documentos: PortaDocumentos | null) {}

  async leituras(c: ContextoDocs, f: FiltroWorklist): Promise<LeiturasDaWorklist> {
    const desde = f.desde.toISOString().slice(0, 10);
    const resultados = [];
    for (const p of f.pacientes)
      for (const r of (await this.documentos?.resultados(c, p)) ?? [])
        if (r.liberadoEm && r.liberadoEm.slice(0, 10) >= desde)
          resultados.push({
            paciente: p,
            exame: r.exame,
            liberadoEm: r.liberadoEm.slice(0, 10),
            visualizadoNoOutroSistema: false,
            vistoPeloMedico: false,
          });
    const em2dias = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    return { previsoesAlta: f.registros.map((registro) => ({ registro, previsao: em2dias })), resultados };
  }
}

export function portaWorklistIndisponivel(): PortaWorklist {
  return portaIndisponivel<PortaWorklist>(new Set(['leituras']));
}
