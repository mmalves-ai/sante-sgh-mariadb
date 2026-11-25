// Fonte real da forma "equipe" do vínculo assistencial (03-PEP L94): a guarda do prontuário (AcessoPacientePep)
// pergunta à porta da equipe se a conta da sessão está na equipe vigente de um atendimento aberto do paciente.
// O módulo do PEP (global) provê VINCULO_ASSISTENCIAL com `VinculoAssistencialPelaEquipe`, e assim TODA rota que monta
// a guarda (prontuário, registros, prescrição, documentos, exame físico, nutrição, CCIH...) enxerga a equipe.
// Sem a porta (ambiente sem banco próprio), não há vínculo pela equipe (falha fechada).
import type { FormaVinculo, VinculoAssistencialPort } from '@sgh/dominio-acesso';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { PortaEquipePainelPropria } from './equipe-painel-propria.js';

/** A porta de vínculo que sabe responder pela sessão (cliente, estabelecimento e conta), além do login. */
export interface VinculoPelaSessao extends VinculoAssistencialPort {
  vinculoNaSessao(s: SessaoCadastro, paciente: number): Promise<FormaVinculo | null>;
}

/** Provedor real de VINCULO_ASSISTENCIAL: a forma "equipe" pela equipe assistencial no banco do cliente. */
export class VinculoAssistencialPelaEquipe implements VinculoPelaSessao {
  constructor(private readonly porta: Pick<PortaEquipePainelPropria, 'vinculoDoUsuario'>) {}

  /** Só com o login não se sabe o cliente nem o estabelecimento: sem vínculo (falha fechada). */
  vinculo(): Promise<FormaVinculo | null> {
    return Promise.resolve(null);
  }

  async vinculoNaSessao(s: SessaoCadastro, paciente: number): Promise<FormaVinculo | null> {
    return (await this.porta.vinculoDoUsuario(s.porta, paciente)) ? 'equipe' : null;
  }
}

/** A consulta pela sessão da porta de vínculo, quando ela sabe responder assim; senão null. */
export function vinculoNaSessaoDe(
  v: VinculoAssistencialPort,
): ((s: SessaoCadastro, paciente: number) => Promise<FormaVinculo | null>) | null {
  const f = (v as Partial<VinculoPelaSessao>).vinculoNaSessao;
  return typeof f === 'function' ? (s, paciente) => f.call(v, s, paciente) : null;
}
