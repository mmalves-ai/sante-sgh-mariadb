// Cliente da lista de trabalho DICOM (M47, etapa 3), validado pelos contratos. As gravações vão com o CSRF e a
// Idempotency-Key (uma por intenção de gravar); o código da recusa (ex.: mwl-desatualizado, recurso-desligado) fica em
// `problema.codigo` para a tela mostrar o texto certo.
import {
  esquemaEstudosDoPaciente,
  esquemaRespostaStatusExame,
  esquemaResultadoWorklist,
  esquemaTelaWorklist,
  type EstudosDoPaciente,
  type FiltroWorklist,
  type RespostaStatusExame,
  type ResultadoWorklist,
  type StatusEstudo,
  type TelaWorklist,
} from '@sgh/contratos';
import { enviar, ler, novaChave, qs } from '../exames/api-exames.js';

const BASE = '/api/sadt/imagem';

export const lerWorklist = (f: FiltroWorklist = {}): Promise<TelaWorklist> =>
  ler(
    `${BASE}/worklist${qs({ data: f.data, setor: f.setor, situacao: f.situacao, termo: f.termo })}`,
    esquemaTelaWorklist,
  );

export const enviarWorklist = (exames: readonly number[]): Promise<ResultadoWorklist> =>
  enviar(`${BASE}/worklist/enviar`, { exames }, esquemaResultadoWorklist, novaChave('mwl-enviar'));

export const reenviarWorklist = (id: number, envios: number): Promise<ResultadoWorklist> =>
  enviar(`${BASE}/worklist/${id}/reenviar`, { envios }, esquemaResultadoWorklist, novaChave('mwl-reenviar'));

export const simularStatus = (id: number, status: StatusEstudo): Promise<RespostaStatusExame> =>
  enviar(`${BASE}/worklist/${id}/simular`, { status }, esquemaRespostaStatusExame, novaChave('mwl-simular'));

export const lerImagensDoPaciente = (paciente: number): Promise<EstudosDoPaciente> =>
  ler(`/api/pep/paciente/${paciente}/imagens`, esquemaEstudosDoPaciente);
