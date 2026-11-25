// Fonte real da forma "equipe" do vínculo assistencial (03-PEP L94): a guarda do prontuário (AcessoPacientePep)
// pergunta à porta da equipe se a conta da sessão está na equipe vigente de um atendimento aberto do paciente.
// Sem a porta (ambiente sem banco próprio), não há vínculo pela equipe (falha fechada).
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { PortaEquipePainelPropria } from './equipe-painel-propria.js';

export function vinculoPelaEquipe(
  porta: Pick<PortaEquipePainelPropria, 'vinculoDoUsuario'> | null,
): ((s: SessaoCadastro, paciente: number) => Promise<boolean>) | null {
  if (!porta) return null;
  return (s, paciente) => porta.vinculoDoUsuario(s.porta, paciente);
}
