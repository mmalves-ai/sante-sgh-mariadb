// Leituras da impressão por estação e da identificação do paciente (01-ADM L79). Sem banco próprio, 503.
// - GET /api/administracao/impressao/catalogo (documento.cadastro.ler): estações, finalidades, impressoras, motivos
//   de reimpressão ativos, unidades, padrões do estabelecimento e da unidade e vínculos das estações;
// - GET /api/documento/identificacoes/atendimento/:id e /internacao/:id (documento.etiqueta.imprimir): o que já saiu
//   da pulseira e da etiqueta, por onde a próxima sai (impressora da estação), os motivos ativos e as reimpressões.
// A gravação acontece na emissão do impresso (atendimento e internação), por `emitirComIdentificacao`.
import { Controller, Get, Inject, Optional, Param, ParseIntPipe, Req } from '@nestjs/common';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problema } from '../administracao/comum.js';
import { IMPRESSAO_IDENTIFICACAO } from '../administracao/impressao-identificacao-emissao.js';
import type { ImpressaoIdentificacaoPropria } from '../administracao/impressao-identificacao-propria.js';
import { sessaoDe } from '../cadastro/comum.js';

@Controller()
export class ImpressaoIdentificacaoController {
  constructor(
    @Optional()
    @Inject(IMPRESSAO_IDENTIFICACAO)
    private readonly porta: ImpressaoIdentificacaoPropria | null = null,
  ) {}

  private banco(): ImpressaoIdentificacaoPropria {
    if (!this.porta)
      throw new ErroProblema('indisponivel', 503, 'Impressão por estação indisponível neste ambiente');
    return this.porta;
  }

  private c(req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return { hospital: s.hospital, login: s.login, ...(req.ip ? { enderecoIp: String(req.ip) } : {}) };
  }

  @Get('administracao/impressao/catalogo')
  @Permissao('documento.cadastro.ler')
  async catalogo(@Req() req: RequisicaoAutorizada) {
    return this.banco()
      .catalogo(this.c(req))
      .catch((x: unknown) => problema(x));
  }

  private async painel(req: RequisicaoAutorizada, alvo: { atendimento: number } | { internacao: number }) {
    const b = this.banco();
    const c = this.c(req);
    try {
      const [situacao, reimpressoes, motivos] = await Promise.all([
        b.situacao(c, alvo),
        b.historico(c, alvo),
        b.motivos(c),
      ]);
      return { ...situacao, motivos, reimpressoes };
    } catch (x) {
      return problema(x);
    }
  }

  @Get('documento/identificacoes/atendimento/:id')
  @Permissao('documento.etiqueta.imprimir')
  async doAtendimento(@Param('id', ParseIntPipe) id: number, @Req() req: RequisicaoAutorizada) {
    return this.painel(req, { atendimento: id });
  }

  @Get('documento/identificacoes/internacao/:id')
  @Permissao('documento.etiqueta.imprimir')
  async daInternacao(@Param('id', ParseIntPipe) id: number, @Req() req: RequisicaoAutorizada) {
    return this.painel(req, { internacao: id });
  }
}
