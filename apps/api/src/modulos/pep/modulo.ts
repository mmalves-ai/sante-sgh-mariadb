// Módulo do PEP (F2.2/F2.3, lote 04-02): prontuário (M15), registros clínicos (M22), formulários novos (M45), prescrição
// (M24), prontuário de uso diário (M23), acesso cruzado da rede (M57) e a fila do médico (M27).
// Portas pela regra do F2-L: com o núcleo e o cliente, as PRÓPRIAS sobre o banco do cliente (registros clínicos e fila do
// médico); as que ainda não têm adaptador próprio (prontuário, documentos, prescrição e formulários novos) ficam
// indisponíveis (503, falha fechada) — nunca a memória fora de dev/ci. Sem o núcleo, a memória sintética só em dev/ci;
// fora disso, todas indisponíveis. O cadastro e o MPI da rede vêm pelas regras dos módulos deles.
import { type DynamicModule, Module } from '@nestjs/common';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { fontesSinteticas } from '../../sessao/montar.js';
import { portaDoCadastro } from '../cadastro/modulo.js';
import { PORTA_CADASTRO, type PortaCadastro } from '../cadastro/porta.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { portasDaRede } from '../rede/modulo.js';
import { PORTA_REDE, type PortaRede } from '../rede/porta.js';
import type { ContextoModulo } from '../registro.js';
import { AcessoRedePepController } from './acesso-rede.controller.js';
import { AcessosProntuarioController } from './acessos.controller.js';
import { PORTA_DOCUMENTOS, type PortaDocumentos } from './documentos-porta.js';
import { PortaDocumentosMemoria } from './documentos-porta-memoria.js';
import { DocumentosPepController, SERVICO_DOCUMENTOS } from './documentos.controller.js';
import { ServicoDocumentos } from './documentos-servico.js';
import { PORTA_FORMULARIO_NOVO, type PortaFormularioNovo } from './formulario-novo-porta.js';
import { PortaFormularioNovoMemoria } from './formulario-novo-porta-memoria.js';
import { FormularioNovoController } from './formulario-novo.controller.js';
import { PORTA_PRONTUARIO, type PortaProntuario } from './porta.js';
import { PortaProntuarioMemoria } from './porta-memoria.js';
import {
  portaDocumentosIndisponivel,
  portaFormularioNovoIndisponivel,
  portaPrescricaoIndisponivel,
  portaProntuarioIndisponivel,
  portaRegistroIndisponivel,
} from './portas-indisponiveis.js';
import { PORTA_PRESCRICAO, type PortaPrescricao } from './prescricao-porta.js';
import { PortaPrescricaoMemoria } from './prescricao-porta-memoria.js';
import { PrescricaoController, SERVICO_PRESCRICAO } from './prescricao.controller.js';
import { ServicoPrescricao } from './prescricao-servico.js';
import { ESTADO_PRONTUARIO, ProntuarioController, SERVICO_PRONTUARIO } from './prontuario.controller.js';
import { PORTA_REGISTRO, type PortaRegistro } from './registro-porta.js';
import { PortaRegistroMemoria } from './registro-porta-memoria.js';
import { PortaRegistroPropria } from './registro-porta-propria.js';
import { RegistroClinicoController, SERVICO_REGISTRO } from './registro.controller.js';
import { ServicoRegistro } from './registro-servico.js';
import { ServicoProntuario } from './servico.js';
import { EstadoProntuario } from './sessao-prontuario.js';
import { WorklistMedicoController } from './worklist.controller.js';
import { PORTA_WORKLIST, type PortaWorklist, portaWorklistIndisponivel, PortaWorklistMemoria } from './worklist-porta.js';
import { PortaWorklistPropria } from './worklist-porta-propria.js';

export interface OpcoesModuloPep {
  /** Testes: portas já montadas. */
  readonly cadastro?: PortaCadastro;
  readonly prontuario?: PortaProntuario;
  readonly registro?: PortaRegistro;
  readonly formularioNovo?: PortaFormularioNovo;
  readonly prescricao?: PortaPrescricao;
  readonly documentos?: PortaDocumentos;
  readonly worklist?: PortaWorklist;
  readonly rede?: PortaRede;
  /** Testes: a fonte da liberação por chave só deste módulo (por cima da global). */
  readonly configuracao?: FonteConfiguracao;
}

export interface PortasPep {
  readonly prontuario: PortaProntuario;
  readonly registro: PortaRegistro;
  readonly formularioNovo: PortaFormularioNovo;
  readonly prescricao: PortaPrescricao;
  readonly documentos: PortaDocumentos;
  readonly worklist: PortaWorklist;
}

/** As portas do PEP pela regra do módulo; as dadas nas opções (testes) têm precedência. */
export function portasDoPep(ctx: ContextoModulo, o: OpcoesModuloPep = {}): PortasPep {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    const nucleo = ctx.nucleo;
    return {
      prontuario: o.prontuario ?? portaProntuarioIndisponivel(),
      registro: o.registro ?? new PortaRegistroPropria(nucleo, cliente),
      formularioNovo: o.formularioNovo ?? portaFormularioNovoIndisponivel(),
      prescricao: o.prescricao ?? portaPrescricaoIndisponivel(),
      documentos: o.documentos ?? portaDocumentosIndisponivel(),
      worklist: o.worklist ?? new PortaWorklistPropria(nucleo, cliente),
    };
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) {
    const trilhaMemoria = ctx.trilha instanceof RegistradorTrilhaMemoria ? ctx.trilha : null;
    const registro = o.registro ?? new PortaRegistroMemoria(ctx.trilha);
    const documentos =
      o.documentos ??
      new PortaDocumentosMemoria(ctx.trilha, registro instanceof PortaRegistroMemoria ? registro : null);
    return {
      prontuario: o.prontuario ?? new PortaProntuarioMemoria(trilhaMemoria),
      registro,
      formularioNovo: o.formularioNovo ?? new PortaFormularioNovoMemoria(),
      prescricao: o.prescricao ?? new PortaPrescricaoMemoria(ctx.trilha),
      documentos,
      worklist: o.worklist ?? new PortaWorklistMemoria(documentos),
    };
  }
  return {
    prontuario: o.prontuario ?? portaProntuarioIndisponivel(),
    registro: o.registro ?? portaRegistroIndisponivel(),
    formularioNovo: o.formularioNovo ?? portaFormularioNovoIndisponivel(),
    prescricao: o.prescricao ?? portaPrescricaoIndisponivel(),
    documentos: o.documentos ?? portaDocumentosIndisponivel(),
    worklist: o.worklist ?? portaWorklistIndisponivel(),
  };
}

@Module({})
export class ModuloPep {}

export async function moduloPep(ctx: ContextoModulo, opcoes: OpcoesModuloPep = {}): Promise<DynamicModule> {
  const p = portasDoPep(ctx, opcoes);
  const cadastro = opcoes.cadastro ?? (await portaDoCadastro(ctx));
  const rede = opcoes.rede ?? (await portasDaRede(ctx)).mpi;
  return {
    module: ModuloPep,
    controllers: [
      ProntuarioController,
      AcessosProntuarioController,
      RegistroClinicoController,
      FormularioNovoController,
      PrescricaoController,
      AcessoRedePepController,
      DocumentosPepController,
      WorklistMedicoController,
    ],
    providers: [
      { provide: PORTA_CADASTRO, useValue: cadastro },
      { provide: PORTA_REDE, useValue: rede },
      { provide: PORTA_PRONTUARIO, useValue: p.prontuario },
      { provide: SERVICO_PRONTUARIO, useValue: new ServicoProntuario(p.prontuario, cadastro) },
      { provide: ESTADO_PRONTUARIO, useValue: new EstadoProntuario() },
      { provide: PORTA_REGISTRO, useValue: p.registro },
      { provide: SERVICO_REGISTRO, useValue: new ServicoRegistro(p.registro) },
      { provide: PORTA_FORMULARIO_NOVO, useValue: p.formularioNovo },
      { provide: PORTA_PRESCRICAO, useValue: p.prescricao },
      { provide: SERVICO_PRESCRICAO, useValue: new ServicoPrescricao(p.prescricao) },
      { provide: PORTA_DOCUMENTOS, useValue: p.documentos },
      { provide: SERVICO_DOCUMENTOS, useValue: new ServicoDocumentos(p.documentos) },
      { provide: PORTA_WORKLIST, useValue: p.worklist },
      ...(opcoes.configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: opcoes.configuracao }] : []),
    ],
    exports: [
      PORTA_PRONTUARIO,
      PORTA_REGISTRO,
      PORTA_PRESCRICAO,
      PORTA_DOCUMENTOS,
      SERVICO_DOCUMENTOS,
      PORTA_WORKLIST,
      ESTADO_PRONTUARIO,
    ],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloPep(ctx);
}
