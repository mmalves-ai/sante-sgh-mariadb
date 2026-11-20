// Acesso cruzado ao prontuário entre os estabelecimentos da rede (M57, etapa 2; ficha, seção 7: "abrir o registro do
// outro hospital: pep.prontuario.lerRede, só com a DP-42"; regras 6 e 7):
//   POST /api/pep/rede/paciente/:p/estabelecimentos/:est/linha-do-tempo   { motivo, justificativa, pagina }
// A abertura é registrada na trilha do banco da sessão (o motivo e a justificativa) e a leitura, na do banco do outro
// estabelecimento (acesso-rede.ts). As chaves `rede.mpi` e `rede.acessoCruzado` são conferidas aqui (estabelecimento da
// sessão, pela regra de sempre) e no outro (estabelecimento inteiro); desligadas, 403 `recurso-desligado` com o motivo,
// antes de qualquer leitura. O paciente da sessão precisa estar acessível aqui (vínculo assistencial do M15).
import { Body, Controller, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import {
  CHAVE_LIBERACAO_ACESSO_CRUZADO_REDE,
  CHAVE_LIBERACAO_MPI_REDE,
  esquemaPedidoProntuarioRede,
  EVENTOS_AUDITAVEIS,
  type ProntuarioRede,
} from '@sgh/contratos';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { ALERTA_AUDITOR, type AlertaAuditor } from '../acesso/alerta.js';
import {
  REGISTRO_EMERGENCIA,
  type RegistroEmergencia,
  VINCULO_ASSISTENCIAL,
} from '../acesso/emergencia.controller.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { PORTA_REDE, type PortaRede } from '../rede/porta.js';
import { AcessoPacientePep } from './acesso-paciente.js';
import { AcessoProntuarioRede } from './acesso-rede.js';
import { SERVICO_DOCUMENTOS } from './documentos.controller.js';
import type { ServicoDocumentos } from './documentos-servico.js';
import { LiberacaoPep } from './liberacao-pep.js';
import { ESTADO_PRONTUARIO } from './prontuario.controller.js';
import type { EstadoProntuario } from './sessao-prontuario.js';

@Controller('pep/rede')
export class AcessoRedePepController {
  private readonly acesso: AcessoPacientePep;
  private readonly liberacao: LiberacaoPep;
  readonly acessoRede: AcessoProntuarioRede;

  constructor(
    @Inject(SERVICO_DOCUMENTOS) private readonly servico: ServicoDocumentos,
    @Inject(PORTA_REDE) rede: PortaRede,
    @Inject(ESTADO_PRONTUARIO) estado: EstadoProntuario,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional() @Inject(VINCULO_ASSISTENCIAL) vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
    this.liberacao = new LiberacaoPep(configuracao, cache);
    const liberacao = this.liberacao;
    this.acessoRede = new AcessoProntuarioRede({
      rede,
      documentos: servico,
      trilha,
      ligadaNoEstabelecimento: (r, h, chave) => liberacao.ligadaNoEstabelecimento(r, h, chave),
    });
  }

  @Post('paciente/:p/estabelecimentos/:est/linha-do-tempo')
  @HttpCode(200)
  @Permissao('pep.prontuario.lerRede')
  @Auditar(EVENTOS_AUDITAVEIS.prontuarioRedeAberto.codigo)
  async abrir(
    @Param('p') p: string,
    @Param('est') est: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ProntuarioRede> {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    const pedido = esquemaPedidoProntuarioRede.safeParse(corpo ?? {});
    if (!pedido.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Escolha o motivo e escreva a justificativa (5 a 200 letras).',
        { campos: [...new Set(pedido.error.issues.map((i) => i.path.join('.') || 'motivo'))] },
      );
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_MPI_REDE);
    await this.liberacao.exigir(s, CHAVE_LIBERACAO_ACESSO_CRUZADO_REDE);
    const c = { rede: s.rede, hospital: s.hospital };
    await this.servico.exigirPaciente(c, paciente);
    await this.acesso.exigirVinculo(s, paciente, 'pep.prontuario.lerRede', 'pep.prontuario');
    const r = await this.acessoRede.abrir(
      {
        rede: s.rede,
        hospital: s.hospital,
        login: s.login,
        estacao: estacaoDaRequisicao(req),
        correlacao: correlacaoDaRequisicao(req, 'prontuario-rede'),
      },
      paciente,
      est,
      pedido.data,
      await this.servico.profissional(c, s.login),
    );
    // A abertura na trilha da sessão: o outro estabelecimento, o motivo e a justificativa (nunca o conteúdo).
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'RICADPAC',
      idAlvo: String(paciente),
      chaveNaturalAlvo: `rede:${est};motivo:${pedido.data.motivo};j:${pedido.data.justificativa}`.slice(
        0,
        120,
      ),
    };
    return r;
  }
}
