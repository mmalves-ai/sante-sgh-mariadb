// Fila do médico na página inicial (M27; ficha, seções 4 e 7; regras 1 a 4):
//   GET /api/pep/worklist/medico   os pacientes com vínculo assistencial do médico da sessão, com as pendências, na
//                                  ordem de prioridade e prazo (auditado: lista com nomes de pacientes)
// A chave `inicio.worklistMedico` (SGH_CFG_LIBERACAO) por estabelecimento, setor, grupo ou pessoa: desligada, 403
// `recurso-desligado` e a página inicial esconde o componente. Só leitura: as ações são as telas do prontuário.
import { Controller, Get, Inject, Optional, Req } from '@nestjs/common';
import { CHAVES_INICIO, EVENTOS_AUDITAVEIS, PERMISSOES_INICIO, type WorklistMedico } from '@sgh/contratos';
import { Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ServicoWorklistMedico } from './aplicacao/worklist-medico.js';
import { SERVICO_DOCUMENTOS } from './documentos.controller.js';
import type { ServicoDocumentos } from './documentos-servico.js';
import { LiberacaoPep } from './liberacao-pep.js';
import { PORTA_PRESCRICAO, type PortaPrescricao } from './prescricao-porta.js';
import { PORTA_WORKLIST, type PortaWorklist } from './worklist-porta.js';

@Controller('pep/worklist')
export class WorklistMedicoController {
  readonly servico: ServicoWorklistMedico;
  private readonly liberacao: LiberacaoPep;

  constructor(
    @Inject(SERVICO_DOCUMENTOS) documentos: ServicoDocumentos,
    @Inject(PORTA_WORKLIST) worklist: PortaWorklist,
    @Optional() @Inject(PORTA_PRESCRICAO) prescricao: PortaPrescricao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoWorklistMedico(documentos, prescricao, worklist);
    this.liberacao = new LiberacaoPep(configuracao, cache);
  }

  @Get('medico')
  @Permissao(PERMISSOES_INICIO.worklistMedicoLer)
  @Auditar(EVENTOS_AUDITAVEIS.inicioWorklistMedicoLida.codigo)
  async medico(@Req() req: RequisicaoAutorizada): Promise<WorklistMedico> {
    const s = sessaoDe(req);
    await this.liberacao.exigir(s, CHAVES_INICIO.medico);
    const r = await this.servico.fila(s.porta, s.login).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    req.sghAlvo = { tabelaAlvo: 'ATCABECATEND', chaveNaturalAlvo: `worklist-medico;n:${r.total}` };
    return r;
  }
}
