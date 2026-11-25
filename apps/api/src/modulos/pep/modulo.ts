// Módulo do PEP (F2.2/F2.3, lote 04-02): prontuário (M15), registros clínicos (M22), formulários novos (M45), prescrição
// (M24), prontuário de uso diário (M23), acesso cruzado da rede (M57) e a fila do médico (M27).
// Portas pela regra do F2-L: com o núcleo e o cliente, as PRÓPRIAS sobre o banco do cliente (registros clínicos e fila do
// médico); as que ainda não têm adaptador próprio (prontuário, documentos, prescrição e formulários novos) ficam
// indisponíveis (503, falha fechada) — nunca a memória fora de dev/ci. Sem o núcleo, a memória sintética só em dev/ci;
// fora disso, todas indisponíveis. O cadastro e o MPI da rede vêm pelas regras dos módulos deles.
import { type DynamicModule, Module } from '@nestjs/common';
import { criarArmazemLocal, lerRaizArquivos } from '@sgh/nucleo';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { fontesSinteticas } from '../../sessao/montar.js';
import { portaDoCadastro } from '../cadastro/modulo.js';
import { PORTA_CADASTRO, type PortaCadastro } from '../cadastro/porta.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { portasDaRede } from '../rede/modulo.js';
import { PORTA_REDE, type PortaRede } from '../rede/porta.js';
import { type ContextoModulo, modulosPedidos } from '../registro.js';
import { AcessoRedePepController } from './acesso-rede.controller.js';
import { AcessosProntuarioController } from './acessos.controller.js';
import { PORTA_DOCUMENTOS, type PortaDocumentos } from './documentos-porta.js';
import { PortaDocumentosMemoria } from './documentos-porta-memoria.js';
import { PortaDocumentosPropria } from './documentos-porta-propria.js';
import {
  DocumentosPepController,
  ESTUDOS_IMAGEM_PEP,
  type FonteEstudosImagem,
  SERVICO_DOCUMENTOS,
} from './documentos.controller.js';
import { ServicoDocumentos } from './documentos-servico.js';
import { PORTA_FORMULARIO_NOVO, type PortaFormularioNovo } from './formulario-novo-porta.js';
import { PortaFormularioNovoMemoria } from './formulario-novo-porta-memoria.js';
import { PortaFormularioNovoPropria } from './formulario-novo-porta-propria.js';
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
import { PortaPrescricaoPropria } from './prescricao-porta-propria.js';
import { PrescricaoController, SERVICO_PRESCRICAO } from './prescricao.controller.js';
import { ServicoPrescricao } from './prescricao-servico.js';
import { PortaProntuarioPropria } from './prontuario-porta-propria.js';
import { ESTADO_PRONTUARIO, ProntuarioController, SERVICO_PRONTUARIO } from './prontuario.controller.js';
import { PORTA_REGISTRO, type PortaRegistro } from './registro-porta.js';
import { PortaRegistroMemoria } from './registro-porta-memoria.js';
import { PortaRegistroPropria } from './registro-porta-propria.js';
import { RegistroClinicoController, SERVICO_REGISTRO } from './registro.controller.js';
import { ServicoRegistro } from './registro-servico.js';
import { ServicoProntuario } from './servico.js';
import { EstadoProntuario } from './sessao-prontuario.js';
import { EquipePainelController } from './equipe-painel.controller.js';
import { PORTA_EQUIPE_PAINEL, PortaEquipePainelPropria } from './equipe-painel-propria.js';
import { SumarioAltaSecoesController } from './sumario-alta-secoes.controller.js';
import { FARMACOVIGILANCIA, FarmacovigilanciaController } from './farmacovigilancia.controller.js';
import { FarmacovigilanciaPropria } from './farmacovigilancia-propria.js';
import { PrescricaoCadastroController } from './prescricao-cadastro.controller.js';
import {
  CADASTRO_CATALOGO_PRESCRICAO,
  CadastroCatalogoPrescricaoPropria,
} from './prescricao-propria-cadastro.js';
import { NOTAS_PACIENTE, NotasPacienteController } from './notas-paciente.controller.js';
import { NotasPacientePropria } from './notas-paciente-propria.js';
import { ObrigatoriedadeDocumentoController } from './obrigatoriedade-documento.controller.js';
import {
  PORTA_OBRIGATORIEDADE_DOCUMENTO,
  PortaObrigatoriedadeDocumentoPropria,
} from './obrigatoriedade-documento-propria.js';
import {
  ANOTACOES_ADMINISTRATIVAS,
  AnotacoesAdministrativasController,
} from './anotacoes-administrativas.controller.js';
import { AnotacoesAdministrativasPropria } from './anotacoes-administrativas-propria.js';
import { PORTA_SUMARIO_SECOES, PortaSumarioSecoesPropria } from './sumario-alta-secoes-propria.js';
import { ResultadosGruposController } from './resultados-grupos.controller.js';
import { PORTA_GRUPOS_RESULTADO, PortaGruposResultadoPropria } from './resultados-grupos-propria.js';
import { PainelFiltrosController } from './painel-filtros.controller.js';
import { PORTA_PAINEL_FILTROS, PortaPainelFiltrosPropria } from './painel-filtros-propria.js';
import { WorklistMedicoController } from './worklist.controller.js';
import {
  PORTA_WORKLIST,
  type PortaWorklist,
  portaWorklistIndisponivel,
  PortaWorklistMemoria,
} from './worklist-porta.js';
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
      prontuario: o.prontuario ?? new PortaProntuarioPropria(nucleo, cliente),
      registro: o.registro ?? new PortaRegistroPropria(nucleo, cliente),
      formularioNovo: o.formularioNovo ?? new PortaFormularioNovoPropria(nucleo, cliente),
      prescricao: o.prescricao ?? new PortaPrescricaoPropria(nucleo, cliente),
      // O conteúdo do anexo no disco da instalação (ADR 0004); sem ARQUIVOS_RAIZ, abrir o anexo responde 503.
      documentos:
        o.documentos ??
        new PortaDocumentosPropria(
          nucleo,
          cliente,
          undefined,
          lerRaizArquivos(ctx.env) ? criarArmazemLocal(nucleo, { env: ctx.env }) : null,
        ),
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
  // Os estudos de imagem do paciente no prontuário (05-SADT linha 20): o serviço da lista de trabalho DICOM do SADT
  // (módulo global), quando o SADT está no processo; sem ele, a aba sai vazia. A importação é tardia: o SADT importa
  // este módulo (ciclo na carga).
  const comSadt = (() => {
    try {
      return modulosPedidos(ctx.env).includes('sadt');
    } catch {
      return false;
    }
  })();
  const estudosImagem = comSadt
    ? [
        {
          provide: ESTUDOS_IMAGEM_PEP,
          useFactory: (pacs?: FonteEstudosImagem | null) => pacs ?? null,
          inject: [{ token: (await import('../sadt/pacs.controller.js')).SERVICO_PACS, optional: true }],
        },
      ]
    : [];
  const p = portasDoPep(ctx, opcoes);
  const cadastro = opcoes.cadastro ?? (await portaDoCadastro(ctx));
  const rede = opcoes.rede ?? (await portasDaRede(ctx)).mpi;
  return {
    module: ModuloPep,
    // Global: o portal-medico injeta as portas deste módulo (montagem da onda 4).
    global: true,
    controllers: [
      ProntuarioController,
      AcessosProntuarioController,
      RegistroClinicoController,
      FormularioNovoController,
      PrescricaoController,
      AcessoRedePepController,
      DocumentosPepController,
      WorklistMedicoController,
      EquipePainelController,
      PainelFiltrosController,
      SumarioAltaSecoesController,
      FarmacovigilanciaController,
      PrescricaoCadastroController,
      NotasPacienteController,
      ObrigatoriedadeDocumentoController,
      AnotacoesAdministrativasController,
      ResultadosGruposController,
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
      ...estudosImagem,
      // F3.3 (L90, L91, L94): painel no banco, configuração por setor e equipe assistencial; sem núcleo, 503.
      {
        provide: PORTA_EQUIPE_PAINEL,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaEquipePainelPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F3.3 (L90): filtros salvos do painel (vários por usuário, padrão único, colunas com largura); sem núcleo, 503.
      {
        provide: PORTA_PAINEL_FILTROS,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaPainelFiltrosPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F3.3 (L124): seções configuráveis do sumário de alta; sem núcleo, 503 no cadastro e sem trava na finalização.
      {
        provide: PORTA_SUMARIO_SECOES,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaSumarioSecoesPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F3.3 (L128): grupos comparativos de resultados e filtro salvo; sem núcleo, 503.
      {
        provide: PORTA_GRUPOS_RESULTADO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaGruposResultadoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // 03-PEP L106 (C1-115): cadastro editável do catálogo da prescrição; sem núcleo, 503.
      {
        provide: CADASTRO_CATALOGO_PRESCRICAO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new CadastroCatalogoPrescricaoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F78.03-1 (03-PEP L103 e L104): reação adversa no paciente e lista de uso contínuo; sem núcleo, 503.
      {
        provide: FARMACOVIGILANCIA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new FarmacovigilanciaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // 03-PEP L102: notas e lembretes livres sobre o paciente; sem núcleo, 503.
      {
        provide: NOTAS_PACIENTE,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new NotasPacientePropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // 03-PEP L132: documentos exigidos por diagnóstico, idade ou setor (regras e lista do profissional); sem núcleo, 503.
      {
        provide: PORTA_OBRIGATORIEDADE_DOCUMENTO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaObrigatoriedadeDocumentoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // 03-PEP L147: anotação administrativa do caso (registro não clínico da equipe); sem núcleo, 503.
      {
        provide: ANOTACOES_ADMINISTRATIVAS,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new AnotacoesAdministrativasPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
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
