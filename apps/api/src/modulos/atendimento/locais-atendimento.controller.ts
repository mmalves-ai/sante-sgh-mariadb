// Rotas da manutenção dos locais de atendimento (02-REC linha 34). Ler: quem consulta a estrutura dos locais
// (organizacao.local.ler). Manter: quem edita o local (organizacao.local.editar), na unidade da sessão; a inclusão
// do local vem junto com o horário (a declaração do cadastro genérico remete para esta tela). Sem banco próprio, 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoGravacao } from '../agenda/apoio.js';
import { corpo } from '../agenda/agendas.controller.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  esquemaManterLocal,
  type LocaisAtendimentoPropria,
  type LocaisDaUnidade,
} from './locais-atendimento.js';

export const LOCAIS_ATENDIMENTO = Symbol('LOCAIS_ATENDIMENTO');

const MENSAGEM: Record<string, string> = {
  incluir: 'Local incluído.',
  dados: 'Dados do local gravados.',
  horario: 'Horário de funcionamento gravado.',
  encaminhamentos: 'Locais de encaminhamento gravados.',
  visibilidade: 'Locais consultados gravados.',
  usuarios: 'Usuários do local gravados.',
};

@Controller('atendimento/locais')
export class LocaisAtendimentoController {
  constructor(
    @Optional() @Inject(LOCAIS_ATENDIMENTO) private readonly locais: LocaisAtendimentoPropria | null = null,
  ) {}

  private exigirBanco(): LocaisAtendimentoPropria {
    if (!this.locais)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'Os locais de atendimento ficam no banco do estabelecimento, que não está configurado.',
      );
    return this.locais;
  }

  @Get()
  @Permissao('organizacao.local.ler')
  lista(@Req() req: RequisicaoAutorizada): Promise<LocaisDaUnidade> {
    const s = sessaoDe(req);
    return this.exigirBanco().lista({ hospital: s.hospital, login: s.login });
  }

  @Get('usuarios-candidatos')
  @Permissao('organizacao.local.editar')
  candidatos(@Query('termo') termo: string | undefined) {
    const t = (termo ?? '').trim();
    if (t.length < 2) return Promise.resolve([]);
    return this.exigirBanco().candidatos(t);
  }

  @Post()
  @HttpCode(200)
  @Permissao('organizacao.local.editar')
  @AuditadoNoHandler('atendimento.manter_local pelo executor (trilha na mesma transação)')
  async manter(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaManterLocal, b);
    const g = contextoGravacao(s, 'atendimento.manterLocal', true);
    const r = await this.exigirBanco().manter(
      {
        hospital: s.hospital,
        login: s.login,
        correlacao: g.correlacao,
        chaveIdempotencia: g.chaveIdempotencia,
        ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
      },
      e,
    );
    // Inativar o local retira as ligações dos outros locais com ele: a resposta diz quantas saíram.
    const retiradas = e.acao === 'dados' ? r.resultado.itens - 1 : 0;
    const mensagem =
      retiradas > 0
        ? `${MENSAGEM[e.acao]} ${retiradas} ligação(ões) de outros locais com este local foram retiradas.`
        : MENSAGEM[e.acao];
    return { ok: true, resultado: r.resultado, repetida: r.repetida, mensagem };
  }
}
