// Configuração do faturamento SUS (C1-051, 06-SUS linha 53) — `Faturamento > Faturamento SUS > Configuração`:
//   GET  /api/sus/configuracao                              permissões por usuário e setor, parâmetros por instrumento
//   POST /api/sus/configuracao/permissoes                   dar a permissão { usuario, setor, tipo, vigência }
//   POST /api/sus/configuracao/permissoes/:id/encerrar      encerrar pela vigência { vigenciaFim, versao } (nada apagado)
//   PUT  /api/sus/configuracao/parametros/:instrumento      gravar os parâmetros do instrumento { campos, versao }
// As regras são do domínio (configuracao-sus.ts); o serviço confere a versão e grava a trilha na mesma transação.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  type ConfiguracaoSusTela,
  esquemaEncerrarPermissaoSetorSus,
  esquemaGravarParametrosInstrumentoSus,
  esquemaIncluirPermissaoSetorSus,
  INSTRUMENTOS_PARAMETRO_SUS,
  type InstrumentoParametroSus,
  type ParametrosInstrumentoSus,
  type PermissaoSetorSusLida,
} from '@sgh/contratos';
import type { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import { PORTA_CONFIGURACAO_SUS, type PortaConfiguracaoSus } from './porta-configuracao.js';
import {
  ACAO_EDITAR_CONFIGURACAO_SUS,
  ServicoConfiguracaoSus,
  type SessaoConfiguracaoSus,
} from './servico-configuracao.js';
import { hojeLocal } from './sus.controller.js';

const TRILHA = 'faturamento.sus.configuracao: a linha gravada com a trilha_auditoria na mesma transação';

function validar<T>(esquema: z.ZodType<T>, v: unknown): T {
  const r = esquema.safeParse(v);
  if (!r.success)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Dados inválidos',
      r.error.issues[0]?.message ?? 'Confira os campos.',
      { campos: [...new Set(r.error.issues.map((i) => i.path.map(String).join('.')))] },
    );
  return r.data;
}

@Controller('sus/configuracao')
export class ConfiguracaoSusController {
  private readonly servico: ServicoConfiguracaoSus | null;

  constructor(@Optional() @Inject(PORTA_CONFIGURACAO_SUS) porta: PortaConfiguracaoSus | null = null) {
    this.servico = porta ? new ServicoConfiguracaoSus(porta) : null;
  }

  private sessao(req: RequisicaoAutorizada): { sv: ServicoConfiguracaoSus; s: SessaoConfiguracaoSus } {
    if (!this.servico)
      throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return {
      sv: this.servico,
      s: {
        rede: s.rede,
        hospital: s.hospital,
        estabelecimento: s.porta.estabelecimento,
        usuario: s.porta.usuario,
        correlacao: s.porta.correlacao,
        hoje: hojeLocal(),
        pode: (acao) => s.pode(acao),
      },
    };
  }

  @Get()
  @Permissao('faturamento.sus.ler')
  tela(@Req() req: RequisicaoAutorizada): Promise<ConfiguracaoSusTela> {
    const { sv, s } = this.sessao(req);
    return sv.tela(s);
  }

  @Post('permissoes')
  @HttpCode(201)
  @Permissao(ACAO_EDITAR_CONFIGURACAO_SUS)
  @AuditadoNoHandler(TRILHA)
  incluir(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown): Promise<PermissaoSetorSusLida> {
    const { sv, s } = this.sessao(req);
    return sv.incluirPermissao(s, validar(esquemaIncluirPermissaoSetorSus, corpo));
  }

  @Post('permissoes/:id/encerrar')
  @HttpCode(200)
  @Permissao(ACAO_EDITAR_CONFIGURACAO_SUS)
  @AuditadoNoHandler(TRILHA)
  encerrar(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ): Promise<PermissaoSetorSusLida> {
    const { sv, s } = this.sessao(req);
    return sv.encerrarPermissao(s, id, validar(esquemaEncerrarPermissaoSetorSus, corpo));
  }

  @Put('parametros/:instrumento')
  @HttpCode(200)
  @Permissao(ACAO_EDITAR_CONFIGURACAO_SUS)
  @AuditadoNoHandler(TRILHA)
  parametros(
    @Req() req: RequisicaoAutorizada,
    @Param('instrumento') instrumento: string,
    @Body() corpo: unknown,
  ): Promise<ParametrosInstrumentoSus> {
    if (!(INSTRUMENTOS_PARAMETRO_SUS as readonly string[]).includes(instrumento))
      throw new ErroProblema('nao-encontrado', 404, 'Instrumento sem parâmetros próprios');
    const { sv, s } = this.sessao(req);
    return sv.gravarParametros(
      s,
      instrumento as InstrumentoParametroSus,
      validar(esquemaGravarParametrosInstrumentoSus, corpo),
    );
  }
}
