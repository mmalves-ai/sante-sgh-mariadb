// Massa sintética do prontuário (M15): um registro SINTÉTICO gravado "por fora" do novo (como o SPDATA gravaria:
// cabeçalho e conteúdo, com o ID explícito para não avançar os generators), SEMPRE dentro da transação desfeita
// do teste de integração (nunca confirmada). Usa o paciente, o atendimento, o modelo e o profissional de um
// registro existente (só IDs); o texto é o corpus sintético marcado.
import type { Escritor } from '@sgh/legado';

export interface RegistroSinteticoGravado {
  readonly id: number;
}

/** Grava o cabeçalho e o conteúdo (texto CP1252 e formulário UTF-8, os bytes como vierem) na transação dada. */
export async function gravarRegistroPorFora(
  e: Escritor,
  base: number,
  rtf: Buffer,
  xml: Buffer,
): Promise<RegistroSinteticoGravado> {
  const [b] = await e.consultar(
    `SELECT c.ID_HTATENDIMENTO A, c.ID_HTPACIENTE H, c.ID_EVOLUCAO M, c.ID_TBCBOPRO_EVOLUCAO P,
            (SELECT MAX(z.ID_CABEVOL) FROM PRCABEVOL z) MX, (SELECT MAX(y.ID) FROM PRCONTEVOL y) MC
       FROM PRCABEVOL c WHERE c.ID_CABEVOL = ?`,
    [base],
    { teto: 1 },
  );
  if (!b) throw new Error('Registro base da massa não encontrado.');
  const id = Number(b['MX']) + 1_000_000;
  const idc = Number(b['MC']) + 1_000_000;
  await e.executar(
    `INSERT INTO PRCABEVOL (ID_CABEVOL, ID_HTATENDIMENTO, ID_HTPACIENTE, ID_EVOLUCAO, DATA_HORA_EVOLUCAO, ID_TBCBOPRO_EVOLUCAO)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [id, b['A'], b['H'], b['M'], b['P']],
  );
  await e.executar('INSERT INTO PRCONTEVOL (ID, ID_PRCABEVOL, EVOLUCAO, EVOLUCAO_XML) VALUES (?, ?, ?, ?)', [
    idc,
    id,
    rtf,
    xml,
  ]);
  return { id };
}
