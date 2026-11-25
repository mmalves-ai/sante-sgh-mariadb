// Rotas do cadastro editável do catálogo da prescrição (03-PEP L106, C1-115). Ler: quem lê os cadastros da prescrição
// (pep.cadastroPrescricao.ler). Gravar, pela permissão de cada cadastro: frequências (pep.frequenciaPrescricao.editar),
// condições "se necessário" (pep.condicaoSeNecessario.editar ou .criar), item não padronizado (pep.itemNaoPadronizado
// .criar; tirar de uso, .inativar) e complementos do item (pep.parametroClinicoItem.editar). Sem banco próprio, 503.
//   GET  pep/prescricao/catalogo/apoio                       opções dos combos (setores, vias, unidades, tipos…)
//   GET  pep/prescricao/catalogo/frequencias                 frequências com os dias e os setores
//   POST pep/prescricao/catalogo/frequencias                 inclui ou altera (com a versão lida)
//   GET  pep/prescricao/catalogo/condicoes                   condições "se necessário"
//   POST pep/prescricao/catalogo/condicoes                   inclui ou altera
//   POST pep/prescricao/catalogo/nao-padronizados            inclui o item não padronizado com as vias
//   POST pep/prescricao/catalogo/nao-padronizados/:id/situacao  tira de uso ou volta (nunca apaga)
//   GET  pep/prescricao/catalogo/itens/:id/complementos      frequências aceitas, setores, sinônimos e conflitos
//   POST pep/prescricao/catalogo/itens/:id/complementos      inclui um complemento
//   POST pep/prescricao/catalogo/itens/:id/complementos/retirar  retira um complemento (marca, não apaga)
// Cada gravação vai pelo executor do núcleo, com a trilha na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao, PermissaoOu } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import {
  CADASTRO_CATALOGO_PRESCRICAO,
  type CadastroCatalogoPrescricaoPropria,
} from './prescricao-propria-cadastro.js';

const LER = 'pep.cadastroPrescricao.ler';
const AUD = 'pep.catalogo pelo executor (trilha na mesma transação)';

@Controller('pep/prescricao/catalogo')
export class PrescricaoCadastroController {
  constructor(
    @Optional()
    @Inject(CADASTRO_CATALOGO_PRESCRICAO)
    private readonly cadastro: CadastroCatalogoPrescricaoPropria | null = null,
  ) {}

  private banco(): CadastroCatalogoPrescricaoPropria {
    if (!this.cadastro)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O cadastro do catálogo da prescrição fica no banco do estabelecimento, que não está configurado.',
      );
    return this.cadastro;
  }

  private ctx(req: RequisicaoAutorizada, operacao: string) {
    const s = sessaoDe(req);
    const g = contextoGravacao(s, operacao, false);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }
  private leitura(req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return { hospital: s.hospital, login: s.login };
  }

  @Get('apoio')
  @Permissao(LER)
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.banco().apoio(this.leitura(req));
  }

  @Get('frequencias')
  @Permissao(LER)
  async frequencias(@Req() req: RequisicaoAutorizada) {
    return { frequencias: await this.banco().frequencias(this.leitura(req)) };
  }

  @Post('frequencias')
  @HttpCode(200)
  @Permissao('pep.frequenciaPrescricao.editar')
  @AuditadoNoHandler(AUD)
  gravarFrequencia(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco().gravarFrequencia(this.ctx(req, 'pep.catalogo.frequencia'), b);
  }

  @Get('condicoes')
  @Permissao(LER)
  async condicoes(@Req() req: RequisicaoAutorizada) {
    return { condicoes: await this.banco().condicoes(this.leitura(req)) };
  }

  @Post('condicoes')
  @HttpCode(200)
  @Permissao('pep.condicaoSeNecessario.editar')
  @PermissaoOu('pep.condicaoSeNecessario.criar')
  @AuditadoNoHandler(AUD)
  gravarCondicao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco().gravarCondicao(this.ctx(req, 'pep.catalogo.condicao'), b);
  }

  @Post('nao-padronizados')
  @HttpCode(201)
  @Permissao('pep.itemNaoPadronizado.criar')
  @AuditadoNoHandler(AUD)
  incluirNaoPadronizado(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco().incluirNaoPadronizado(this.ctx(req, 'pep.catalogo.naoPadronizado'), b);
  }

  @Post('nao-padronizados/:id/situacao')
  @HttpCode(200)
  @Permissao('pep.itemNaoPadronizado.inativar')
  @AuditadoNoHandler(AUD)
  situacaoNaoPadronizado(@Param('id') i: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco().situacaoNaoPadronizado(this.ctx(req, 'pep.catalogo.naoPadronizado'), idDaRota(i), b);
  }

  @Get('itens/:id/complementos')
  @Permissao(LER)
  complementos(@Param('id') i: string, @Req() req: RequisicaoAutorizada) {
    return this.banco().complementos(this.leitura(req), idDaRota(i));
  }

  @Post('itens/:id/complementos')
  @HttpCode(201)
  @Permissao('pep.parametroClinicoItem.editar')
  @AuditadoNoHandler(AUD)
  incluirComplemento(@Param('id') i: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco().incluirComplemento(this.ctx(req, 'pep.catalogo.complemento'), idDaRota(i), b);
  }

  @Post('itens/:id/complementos/retirar')
  @HttpCode(200)
  @Permissao('pep.parametroClinicoItem.editar')
  @AuditadoNoHandler(AUD)
  retirarComplemento(@Param('id') i: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.banco().retirarComplemento(this.ctx(req, 'pep.catalogo.complemento'), idDaRota(i), b);
  }
}
