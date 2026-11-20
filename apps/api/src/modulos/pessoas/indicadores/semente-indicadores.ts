// W0-06, parte 7d: a base de teste do painel de indicadores de pessoas (a mesma do domínio, conferida à mão em
// dominio-pessoas/src/indicadores/indicadores-pessoas.spec.ts), como fatos datados, mais fatos de fora do 1º trimestre
// de 2026 que não podem entrar. Serve aos testes do serviço e à sessão sintética de dev/ci (a porta em memória a usa
// para o estabelecimento sem fatos próprios), onde o E2E confere os números impressos na tela. Nada vai a banco.
import { CODIGOS_CATEGORIA_SCP } from '@sgh/contratos';
import type { FatosIndicadoresPessoas } from './porta-indicadores-memoria.js';

export const SETOR_CLINICA_SEMENTE = { setor: 10, nomeSetor: 'Clínica' };
export const SETOR_UTI_SEMENTE = { setor: 20, nomeSetor: 'UTI' };
const zero = Object.fromEntries(CODIGOS_CATEGORIA_SCP.map((c) => [c, 0])) as Record<
  (typeof CODIGOS_CATEGORIA_SCP)[number],
  number
>;
export const horasSemente = (p: number, t: number, a: number, e: number, enf: number) => ({
  horasPrevistas: p,
  horasTrabalhadas: t,
  horasAusencia: a,
  horasExtras: e,
  horasEnfermagem: enf,
});

/** A base do domínio como fatos datados, mais fatos de fora do período (que não podem entrar). */
export const SEMENTE_INDICADORES_PESSOAS: FatosIndicadoresPessoas = {
  vinculos: [
    { ...SETOR_CLINICA_SEMENTE, admissao: '2025-01-01', desligamento: null },
    { ...SETOR_CLINICA_SEMENTE, admissao: '2025-06-01', desligamento: '2026-02-10' },
    { ...SETOR_CLINICA_SEMENTE, admissao: '2026-02-15', desligamento: null },
    { ...SETOR_CLINICA_SEMENTE, admissao: '2024-01-01', desligamento: null },
    { ...SETOR_UTI_SEMENTE, admissao: '2020-01-01', desligamento: null },
    { ...SETOR_UTI_SEMENTE, admissao: '2020-01-01', desligamento: null },
    { ...SETOR_UTI_SEMENTE, admissao: '2020-01-01', desligamento: '2026-03-31' },
    { ...SETOR_UTI_SEMENTE, admissao: '2026-01-01', desligamento: null },
    // Admitido depois do fim: fora.
    { ...SETOR_UTI_SEMENTE, admissao: '2026-04-02', desligamento: null },
  ],
  ponto: [
    { ...SETOR_CLINICA_SEMENTE, data: '2026-01-15', ...horasSemente(600, 580, 25, 5, 350) },
    { ...SETOR_CLINICA_SEMENTE, data: '2026-03-31', ...horasSemente(400, 400, 15, 15, 250) },
    { ...SETOR_UTI_SEMENTE, data: '2026-02-01', ...horasSemente(2000, 2050, 50, 100, 1800) },
    { ...SETOR_UTI_SEMENTE, data: '2025-12-31', ...horasSemente(999, 999, 999, 999, 999) },
  ],
  folhaHorasExtras: [
    { ...SETOR_CLINICA_SEMENTE, competencia: '2026-02', valorCent: 50_000 },
    { ...SETOR_UTI_SEMENTE, competencia: '2026-03', valorCent: 150_000 },
    { ...SETOR_UTI_SEMENTE, competencia: '2026-04', valorCent: 999_999 },
  ],
  treinamento: [
    { ...SETOR_CLINICA_SEMENTE, data: '2026-01-20', horas: 30 },
    { ...SETOR_UTI_SEMENTE, data: '2026-03-10', horas: 20 },
    { ...SETOR_UTI_SEMENTE, data: '2026-04-10', horas: 500 },
  ],
  acidentes: [
    { ...SETOR_UTI_SEMENTE, data: '2026-02-20', comAfastamento: true },
    { ...SETOR_CLINICA_SEMENTE, data: '2026-04-01', comAfastamento: false },
  ],
  censo: [
    { ...SETOR_CLINICA_SEMENTE, data: '2026-01-31', pacientesDia: 60 },
    { ...SETOR_CLINICA_SEMENTE, data: '2026-02-28', pacientesDia: 40 },
    { ...SETOR_UTI_SEMENTE, data: '2026-03-31', pacientesDia: 90 },
    { ...SETOR_UTI_SEMENTE, data: '2026-04-30', pacientesDia: 9999 },
  ],
  dimensionamento: [
    // O mais antigo da UTI perde para o último até o fim; o posterior ao fim não vale.
    { ...SETOR_UTI_SEMENTE, data: '2025-06-01', pacientes: { ...zero, minimos: 9 } },
    { ...SETOR_UTI_SEMENTE, data: '2026-02-01', pacientes: { ...zero, intensivos: 5 } },
    { ...SETOR_UTI_SEMENTE, data: '2026-05-01', pacientes: { ...zero, minimos: 9 } },
    { ...SETOR_CLINICA_SEMENTE, data: '2026-01-05', pacientes: { ...zero, minimos: 2, intermediarios: 2 } },
  ],
};
