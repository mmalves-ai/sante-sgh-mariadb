// Lista de trabalho DICOM e integração com o PACS/RIS (M47, etapa 3; ficha, seções 4, 5, 7 e 8, regras 8, 9 e 11):
//   GET  /api/sadt/imagem/worklist                    os exames de imagem do dia (setor, situação) com a modalidade, o
//                                                      item da MWL, a entrega e o status; as contagens, a chave, o destino
//                                                      e as ações (lista com nomes de pacientes: auditada)
//   POST /api/sadt/imagem/worklist/enviar             sadt.enviarWorklist (os exames que ficaram de fora)
//   POST /api/sadt/imagem/worklist/:id/reenviar       sadt.enviarWorklist (reenvio com o mesmo número de acesso)
//   POST /api/sadt/imagem/worklist/:id/simular        fora de produção: o status que a modalidade mandaria (simulador),
//                                                      pelo mesmo caminho da entrada do PACS
//   POST /api/sadt/imagem/status/:hospital            sadt.receberStatusExame: a entrada do PACS (credencial do parceiro
//                                                      de integração com o escopo estudo.status), idempotente pela chave
//                                                      da mensagem
// Tudo grava no banco do cliente (o item, a fila de integração e a trilha na mesma transação); a chave `imagem.worklist` vale
// para gravar; a lista lê também desligada (consulta). Nenhuma tabela legada é escrita.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  ESCOPO_STATUS_ESTUDO,
  esquemaEnviarWorklist,
  esquemaFiltroWorklist,
  esquemaReenviarWorklist,
  esquemaSimularStatus,
  esquemaStatusExame,
  EVENTOS_AUDITAVEIS,
  PERMISSOES_PACS_CODIGOS as P,
  type RespostaStatusExame,
  type ResultadoWorklist,
  type TelaWorklist,
} from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao, Publica } from '../../autorizacao/decoradores.js';
import { estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, problemaDoCadastro, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import { contextoDoEstabelecimento } from '../cadastro/contexto-nucleo.js';
import { corpo } from '../exames/public-api.js';
import {
  ESTABELECIMENTOS_ENTRADA,
  lerAutorizacaoBasica,
  PORTA_INTEGRACAO,
  type PortaIntegracao,
  segredoConfere,
} from '../integracao/public-api.js';
import { type ServicoPacs } from './aplicacao/pacs.js';

export const SERVICO_PACS = Symbol('SERVICO_PACS');

function filtro(q: unknown) {
  const r = esquemaFiltroWorklist.safeParse(q ?? {});
  if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
  return r.data;
}

@Controller('sadt/imagem')
export class PacsController {
  constructor(
    @Inject(SERVICO_PACS) private readonly servico: ServicoPacs,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(CONFIGURACAO) private readonly configuracao: Configuracao,
    @Optional() @Inject(PORTA_INTEGRACAO) private readonly integracao: PortaIntegracao | null = null,
    @Optional() @Inject(ESTABELECIMENTOS_ENTRADA) private readonly estabelecimentos: readonly string[] = [],
  ) {}

  @Get('worklist')
  @Permissao(P.ler)
  @Auditar(EVENTOS_AUDITAVEIS.worklistLida.codigo)
  tela(@Query() q: unknown, @Req() req: RequisicaoAutorizada): Promise<TelaWorklist> {
    return this.servico.tela(sessaoDe(req), filtro(q));
  }

  @Post('worklist/enviar')
  @HttpCode(201)
  @Permissao(P.reenviar)
  @AuditadoNoHandler(
    'sadt.enviarWorklist: item_lista_trabalho_imagem, a fila de integração e a trilha na mesma transação',
  )
  enviar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoWorklist> {
    const e = corpo(esquemaEnviarWorklist, b);
    return this.servico.enviar(sessaoDe(req), e.exames, 'manual');
  }

  @Post('worklist/:id/reenviar')
  @HttpCode(201)
  @Permissao(P.reenviar)
  @AuditadoNoHandler(
    'sadt.enviarWorklist (reenvio): item_lista_trabalho_imagem, a fila de integração e a trilha juntos',
  )
  reenviar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoWorklist> {
    const e = corpo(esquemaReenviarWorklist, b);
    return this.servico.reenviar(sessaoDe(req), idDaRota(id), e.envios);
  }

  @Post('worklist/:id/simular')
  @HttpCode(201)
  @Permissao(P.reenviar)
  @AuditadoNoHandler(
    'sadt.receberStatusExame (simulador): a mensagem de entrada, o estudo e a trilha na mesma transação',
  )
  simular(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RespostaStatusExame> {
    const e = corpo(esquemaSimularStatus, b);
    return this.servico.simular(sessaoDe(req), idDaRota(id), e.status);
  }

  // ── Entrada do PACS ────────────────────────────────────────────────────────────────────────────────

  @Post('status/:hospital')
  @HttpCode(200)
  @Publica(
    'entrada do PACS: a credencial do parceiro de integração (resumo e escopo estudo.status) é conferida no handler',
  )
  async status(
    @Param('hospital') hospital: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RespostaStatusExame> {
    if (
      !/^[a-z0-9]{1,10}$/.test(hospital) ||
      (this.estabelecimentos.length > 0 && !this.estabelecimentos.includes(hospital))
    )
      throw new ErroProblema('nao-encontrado', 404, 'Estabelecimento não encontrado');
    const rede = this.configuracao.rede ?? 'rede-sintetica';
    // O parceiro não tem sessão: o contexto do núcleo é o do estabelecimento da rota, sem usuário.
    const c = {
      ...contextoDoEstabelecimento(hospital),
      usuario: null,
      correlacao: 'sadt.pacs.status',
      rede,
      hospital,
    };
    const negar = () =>
      new ErroProblema(
        'nao-autenticado',
        401,
        'Credencial do parceiro inválida',
        'Confira o cliente e o segredo.',
      );
    const cred = lerAutorizacaoBasica(req.headers['authorization']);
    if (!cred || !this.integracao) throw negar();
    const registro = await this.integracao.credencial(c, cred.clienteId);
    if (!registro || !segredoConfere(cred.segredo, registro.resumo)) throw negar();
    if (!registro.ativo)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Parceiro desativado',
        'O parceiro não está ativo neste estabelecimento.',
      );
    if (!registro.escopos.includes(ESCOPO_STATUS_ESTUDO))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Fora do escopo do parceiro',
        `A credencial não tem o escopo ${ESCOPO_STATUS_ESTUDO}.`,
      );
    const e = corpo(esquemaStatusExame, b);
    const usuario = `INTG.${registro.codigo}`.slice(0, 31);
    const estacao = estacaoDaRequisicao(req).slice(0, 80);
    const porta = this.servico.porta;
    // A sessão mínima do parceiro, só para resolver os parâmetros do estabelecimento (o visualizador em uso).
    const sessao = {
      req,
      rede,
      hospital,
      login: usuario,
      porta: c,
      pode: () => false,
    } as unknown as SessaoCadastro;
    const visualizador = await this.servico.idVisualizador(sessao).catch(() => null);
    return this.servico
      .receberStatus(
        c,
        e,
        'pacs',
        usuario,
        async (alvo, fn) => {
          const r = await porta.gravarSgh(
            c,
            (x: Parameters<typeof alvo>[0]) => {
              const a = alvo(x);
              return {
                estabelecimento: c.estabelecimento,
                usuario: null,
                acao: 'operacao' as const,
                entidade: 'integracao_mensagem',
                entidadeId: /^\d{1,15}$/.test(a.id) ? Number(a.id) : null,
                dadosDepois: {
                  evento: EVENTOS_AUDITAVEIS.estudoStatusRecebido.codigo,
                  recurso: 'sadt.pacs',
                  operacao: a.operacao,
                  chave: a.chave,
                  paciente: a.paciente,
                  parceiro: usuario,
                  estacao,
                },
                correlacao: e.mensagem.slice(0, 64),
              };
            },
            fn,
          );
          if (porta.destino === 'memoria') {
            const a = alvo(r);
            await this.trilha.registrar({
              evento: EVENTOS_AUDITAVEIS.estudoStatusRecebido.codigo,
              rede,
              hospital,
              usuario,
              estacao,
              correlacao: e.mensagem.slice(0, 64),
              recurso: 'sadt.pacs',
              resultado: 'sucesso',
              tabelaAlvo: 'MEMORIA',
              idAlvo: a.id,
            });
          }
          return r;
        },
        visualizador,
      )
      .catch((x: unknown) => {
        throw x instanceof ErroProblema ? x : problemaDoCadastro(x);
      });
  }
}
