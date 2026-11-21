// Construtor de formulários novos (M45, etapa 1; ficha, seções 5 e 7; regras 3, 14, 15 e 16):
//   GET  /api/pep/admin/formularios-novos                     as versões (casos que passam, situação e ponte) e a liberação
//   GET  /api/pep/admin/formularios-novos/banco-perguntas     o banco de perguntas para reuso (teto 50)
//   GET  /api/pep/admin/formularios-novos/especialidades      as especialidades em que o modelo fica visível
//   POST /api/pep/admin/formularios-novos/avaliar             os problemas da definição e os casos executados (puro)
//   POST /api/pep/admin/formularios-novos/previa-resumo       o registro-resumo das respostas (puro)
//   GET  /api/pep/admin/formularios-novos/:id                 a versão com os casos recalculados, o hash e a história
//   POST /api/pep/admin/formularios-novos                     pep.salvarFormularioNovo (rascunho; só SGH_)
//   POST /api/pep/admin/formularios-novos/:id/revisao         envia à revisão (definição sem problema, casos verdes)
//   POST /api/pep/admin/formularios-novos/:id/decisao         a comissão aprova ou devolve (nunca a própria versão)
//   POST /api/pep/admin/formularios-novos/:id/publicar        pep.publicarFormularioNovo (crítica: a senha; hash visto)
//   POST /api/pep/admin/formularios-novos/:id/aposentar       aposenta a versão publicada (crítica: a senha; motivo)
// Toda gravação com a SGH_TRILHA na mesma transação e o ator real; o estabelecimento vem da sessão (o ID de outro não
// é achado). A publicação vira modelo do prontuário só com a chave `pep.formularioNovo.modeloLegado` (desligada até o
// cenário do M36); desligada, a versão publicada vale só no Sante SGH (ponte so-sante). Ligada, o executor tem de poder
// gravar: a recusa dele recusa a publicação com o motivo (nunca cai em so-sante sem aviso).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  CHAVE_LIBERACAO_FORMULARIO_NOVO,
  CHAVE_PONTE_FORMULARIO_NOVO,
  type EspecialidadeFormularioNovo,
  esquemaAposentarFormularioNovo,
  esquemaBuscarPerguntaDoBanco,
  esquemaCasoFormularioNovo,
  esquemaDecidirRevisaoFormularioNovo,
  esquemaDefinicaoFormularioNovo,
  esquemaEnviarRevisaoFormularioNovo,
  esquemaPreviaResumoFormularioNovo,
  esquemaPublicarFormularioNovo,
  esquemaSalvarFormularioNovo,
  EVENTOS_AUDITAVEIS,
  type ListaFormulariosNovos,
  type PerguntaDoBanco,
  type ResultadoCasoFormularioNovo,
  type ResultadoFormularioNovo,
  type VersaoFormularioNovoDetalhe,
} from '@sgh/contratos';
import { conferirDefinicao, executarCasos, rtfDoResumo, textoDoResumo } from '@sgh/dominio-pep';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import {
  contextoOperacao,
  idDaRota,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import {
  exigirExecucaoDaPonte,
  FORMATO_DEFINICAO_FORMULARIO_NOVO,
  ServicoFormularioNovo,
} from './formulario-novo-servico.js';
import {
  type GravadorFormularioNovo,
  PORTA_FORMULARIO_NOVO,
  type PortaFormularioNovo,
} from './formulario-novo-porta.js';

const TABELA = 'SGH_PEP_FORMNOVO';
const E = EVENTOS_AUDITAVEIS;
const esquemaAvaliar = z.object({
  definicao: esquemaDefinicaoFormularioNovo,
  casos: z.array(esquemaCasoFormularioNovo).max(50),
});

@Controller('pep/admin/formularios-novos')
export class FormularioNovoController {
  private readonly apoio: ApoioGravacao<GravadorFormularioNovo>;
  private readonly ponte: ApoioGravacao<GravadorFormularioNovo>;

  constructor(
    @Inject(PORTA_FORMULARIO_NOVO) private readonly porta: PortaFormularioNovo,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_LIBERACAO_FORMULARIO_NOVO, nome: 'o construtor de formulários novos', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.ponte = new ApoioGravacao(
      {
        chave: CHAVE_PONTE_FORMULARIO_NOVO,
        nome: 'a criação do formulário novo como modelo do prontuário',
        operacoes: {},
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private servico(): ServicoFormularioNovo {
    return new ServicoFormularioNovo(this.porta);
  }

  private async senha(req: RequisicaoAutorizada, senha: string): Promise<number> {
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    return reautenticar(this.sessoes, this.resolvedor, req, senha);
  }

  private resultado(
    id: number,
    versao: number,
    versaoLinha: string,
    estado: ResultadoFormularioNovo['estado'],
    mensagem: string,
    ponte: ResultadoFormularioNovo['ponte'] = null,
  ): ResultadoFormularioNovo {
    return { id, versao, versaoLinha, estado, ponte, mensagem };
  }

  @Get()
  @Permissao('pep.admin.ler')
  async lista(@Req() req: RequisicaoAutorizada): Promise<ListaFormulariosNovos> {
    const s = sessaoDe(req);
    const [l, p, versoes] = await Promise.all([
      this.apoio.liberacao(s),
      this.ponte.liberacao(s),
      this.servico().lista(s.porta),
    ]);
    return { ligada: l.ligada, motivo: l.motivo, ponte: { ligada: p.ligada, motivo: p.motivo }, versoes };
  }

  @Get('banco-perguntas')
  @Permissao('pep.admin.ler')
  banco(
    @Query('termo') termo: string | undefined,
    @Query('tipo') tipo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PerguntaDoBanco[]> {
    const e = corpo(esquemaBuscarPerguntaDoBanco, { termo: termo ?? '', tipo: tipo || null });
    return this.servico().bancoDePerguntas(sessaoDe(req).porta, e.termo, e.tipo);
  }

  @Get('especialidades')
  @Permissao('pep.admin.ler')
  especialidades(@Req() req: RequisicaoAutorizada): Promise<EspecialidadeFormularioNovo[]> {
    return this.servico().especialidades(sessaoDe(req).porta);
  }

  @Post('avaliar')
  @HttpCode(200)
  @Permissao('pep.admin.ler')
  @AuditadoNoHandler('avaliação pura da definição e dos casos: nada é gravado (POST pelo tamanho do pedido)')
  async avaliar(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ problemas: ReturnType<typeof conferirDefinicao>; resultados: ResultadoCasoFormularioNovo[] }> {
    const e = corpo(esquemaAvaliar, b);
    const problemas = conferirDefinicao(e.definicao);
    const hoje = await this.porta.hoje(sessaoDe(req).porta);
    return { problemas, resultados: problemas.length ? [] : executarCasos(e.definicao, e.casos, hoje) };
  }

  @Post('previa-resumo')
  @HttpCode(200)
  @Permissao('pep.admin.ler')
  @AuditadoNoHandler('prévia pura do registro-resumo: nada é gravado (POST pelo tamanho do pedido)')
  async previa(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ texto: string; rtf: string }> {
    const e = corpo(esquemaPreviaResumoFormularioNovo, b);
    if (conferirDefinicao(e.definicao).length)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Corrija a definição antes da prévia.',
      );
    const hoje = await this.porta.hoje(sessaoDe(req).porta);
    try {
      return {
        texto: textoDoResumo(e.definicao, e.versao, e.respostas, hoje),
        rtf: rtfDoResumo(e.definicao, e.versao, e.respostas, hoje),
      };
    } catch (x) {
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', (x as Error).message, {
        codigo: 'resposta-invalida',
      });
    }
  }

  @Get(':id')
  @Permissao('pep.admin.ler')
  detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<VersaoFormularioNovoDetalhe> {
    return this.servico().detalhe(sessaoDe(req).porta, idDaRota(id));
  }

  @Post()
  @HttpCode(201)
  @Permissao('pep.formularioNovo.editar')
  @AuditadoNoHandler(
    'pep.salvarFormularioNovo: SGH_PEP_FORMNOVO, SGH_PEP_FORMNOVO_CASO, SGH_PEP_FORMNOVO_EVT e SGH_TRILHA',
  )
  async salvar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFormularioNovo> {
    const s = sessaoDe(req);
    const e = corpo(esquemaSalvarFormularioNovo, b);
    if (e.id === null && e.baseadoEm === null)
      await this.servico().conferirCodigoNovo(s.porta, e.definicao.codigo);
    const r = await this.apoio.sgh(
      s,
      E.formularioNovoSalvo.codigo,
      'pep.formularioNovo',
      (x: { id: number; versao: number }) => ({
        tabela: TABELA,
        id: String(x.id),
        chave: `${e.definicao.codigo}:v${x.versao}`,
      }),
      (g) =>
        g.salvar({
          id: e.id,
          baseadoEm: e.baseadoEm,
          codigo: e.definicao.codigo,
          titulo: e.definicao.titulo,
          tipoRegistro: e.definicao.tipoRegistro,
          formato: FORMATO_DEFINICAO_FORMULARIO_NOVO,
          definicao: e.definicao,
          casos: e.casos.map((c) => ({ nome: c.nome, caso: c })),
          autor: s.login,
          versaoEsperada: e.versaoEsperada,
        }),
    );
    return this.resultado(r.id, r.versao, r.versaoLinha, 'rascunho', 'Rascunho salvo.');
  }

  private async mudar(
    s: SessaoCadastro,
    id: number,
    evento: string,
    passo: Parameters<GravadorFormularioNovo['mudar']>[0]['passo'],
    versaoEsperada: string | null,
    chave: string,
  ) {
    return this.apoio.sgh(s, evento, 'pep.formularioNovo', { tabela: TABELA, id: String(id), chave }, (g) =>
      g.mudar({ id, por: s.login, versaoEsperada, passo }),
    );
  }

  @Post(':id/revisao')
  @HttpCode(201)
  @Permissao('pep.formularioNovo.editar')
  @AuditadoNoHandler(
    'pep.salvarFormularioNovo (revisão): SGH_PEP_FORMNOVO, SGH_PEP_FORMNOVO_EVT e SGH_TRILHA',
  )
  async revisao(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFormularioNovo> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEnviarRevisaoFormularioNovo, { ...(b as object), id: idDaRota(id) });
    const v = await this.servico().conferirEnvio(s.porta, e.id);
    const r = await this.mudar(
      s,
      e.id,
      E.formularioNovoRevisao.codigo,
      { tipo: 'revisao' },
      e.versaoEsperada,
      `${v.codigo}:v${v.versao}:revisao`,
    );
    return this.resultado(
      e.id,
      v.versao,
      r.versaoLinha,
      'revisao',
      'Enviado à revisão da comissão de prontuário.',
    );
  }

  @Post(':id/decisao')
  @HttpCode(201)
  @Permissao('pep.formularioNovo.aprovar')
  @AuditadoNoHandler(
    'pep.salvarFormularioNovo (decisão da comissão): SGH_PEP_FORMNOVO, SGH_PEP_FORMNOVO_EVT e SGH_TRILHA',
  )
  async decisao(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFormularioNovo> {
    const s = sessaoDe(req);
    const e = corpo(esquemaDecidirRevisaoFormularioNovo, { ...(b as object), id: idDaRota(id) });
    const v =
      e.decisao === 'aprovar'
        ? await this.servico().conferirDecisao(s.porta, e.id, s.login)
        : await this.servico().lerVersao(s.porta, e.id);
    const passo =
      e.decisao === 'aprovar'
        ? ({ tipo: 'aprovado', parecer: e.parecer } as const)
        : ({ tipo: 'devolvido', parecer: e.parecer } as const);
    const r = await this.mudar(
      s,
      e.id,
      E.formularioNovoRevisao.codigo,
      passo,
      e.versaoEsperada,
      `${v.codigo}:v${v.versao}:${passo.tipo}`,
    );
    return this.resultado(
      e.id,
      v.versao,
      r.versaoLinha,
      e.decisao === 'aprovar' ? 'revisao' : 'rascunho',
      e.decisao === 'aprovar'
        ? 'Versão aprovada: pode ser publicada.'
        : 'Versão devolvida ao rascunho, com o parecer.',
    );
  }

  @Post(':id/publicar')
  @HttpCode(201)
  @Permissao('pep.formularioNovo.publicar')
  @AuditadoNoHandler(
    'pep.publicarFormularioNovo: SGH_PEP_FORMNOVO e SGH_PEP_FORMNOVO_EVT com a SGH_TRILHA; com a ponte liberada, o modelo do prontuário pelo executor',
  )
  async publicar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFormularioNovo> {
    const s = sessaoDe(req);
    const e = corpo(esquemaPublicarFormularioNovo, { ...(b as object), id: idDaRota(id) });
    const reautenticadoEm = await this.senha(req, e.senha);
    const { v, hash, definicao } = await this.servico().conferirPublicacao(
      s.porta,
      e.id,
      e.contentHashEsperado,
      s.login,
    );
    await this.apoio.exigirLiberacao(s);
    const ponte = await this.ponte.liberacao(s);
    const operacao = 'pep.publicarFormularioNovo';
    if (ponte.ligada) {
      // A ponte ligada exige o executor: a recusa dele (ou o erro ao consultá-lo) não vira publicação só no Sante SGH.
      exigirExecucaoDaPonte(
        await this.porta.podeGravar(s.porta, operacao).catch((x: unknown) => {
          throw problemaDoCadastro(x);
        }),
      );
      const r = await this.porta
        .executar(
          s.porta,
          operacao,
          await this.servico().entradaDaPublicacao(s.porta, v, definicao, hash, e.versaoEsperada),
          { ...contextoOperacao(s, operacao), reautenticadoEm },
        )
        .catch((x: unknown) => {
          throw problemaDoCadastro(x);
        });
      const atual = await this.servico().lerVersao(s.porta, v.id);
      return this.resultado(
        v.id,
        v.versao,
        atual.versaoLinha,
        'publicado',
        `Versão publicada e criada no prontuário como o modelo ${String(r.resultado['codigo'] ?? '')}.`,
        'modelo-legado',
      );
    }
    const r = await this.mudar(
      s,
      v.id,
      E.formularioNovoPublicado.codigo,
      {
        tipo: 'publicado',
        contentHash: hash,
        ponte: 'so-sante',
        idModeloLegado: null,
        codModelo: null,
        ligacoes: null,
      },
      e.versaoEsperada,
      `${v.codigo}:v${v.versao}:${hash.slice(0, 16)}`,
    );
    return this.resultado(
      v.id,
      v.versao,
      r.versaoLinha,
      'publicado',
      'Versão publicada. Ela ainda não aparece no prontuário: vale só neste sistema até a criação do modelo ser liberada.',
      'so-sante',
    );
  }

  @Post(':id/aposentar')
  @HttpCode(201)
  @Permissao('pep.formularioNovo.aposentar')
  @AuditadoNoHandler(
    'pep.salvarFormularioNovo (aposentadoria): SGH_PEP_FORMNOVO, SGH_PEP_FORMNOVO_EVT e SGH_TRILHA',
  )
  async aposentar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFormularioNovo> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAposentarFormularioNovo, { ...(b as object), id: idDaRota(id) });
    await this.senha(req, e.senha);
    const v = await this.servico().conferirAposentadoria(s.porta, e.id);
    const r = await this.mudar(
      s,
      e.id,
      E.formularioNovoAposentado.codigo,
      { tipo: 'aposentado', motivo: e.motivo },
      null,
      `${v.codigo}:v${v.versao}:aposentado`,
    );
    return this.resultado(
      e.id,
      v.versao,
      r.versaoLinha,
      'aposentado',
      'Versão aposentada. Os registros já feitos continuam legíveis.',
    );
  }
}
