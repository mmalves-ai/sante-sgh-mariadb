// M38: o "outro sistema simulado" adultera, na transação SEMPRE desfeita do teste de integração da vigilância diária,
// um evento da trilha que o executor acabou de gravar (o fuso fixo trocado e o retrato do paciente sintético no
// cabeçalho, que o Delphi nunca preenche), para provar que a vigilância aponta a divergência pela estrutura. O
// identificador do retrato fica no banco (a subconsulta não o traz para a aplicação). Nunca confirmada.
import type { Escritor } from '@sgh/legado';

export async function adulterarEventoTrilha(
  e: Escritor,
  idTrilha: string,
  pacienteSintetico: number,
): Promise<void> {
  const n = await e.executar(
    "UPDATE TBCABTRILHA SET FUSO_HORARIO_LOCAL = '-02:00', ID_HTPACIENTE = (SELECT FIRST 1 ID FROM HTPACIENTE WHERE ID_RICADPAC = ?) WHERE ID = ?",
    [pacienteSintetico, idTrilha],
  );
  if (n !== 1) throw new Error('Evento sintético da trilha não adulterado.');
}
