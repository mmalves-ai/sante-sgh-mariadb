// Painel "Indicadores de pessoas" (W0-06, parte 7; M4 de mercado; `Gestão de pessoas > Indicadores`):
//   GET /api/pessoas/indicadores/apoio                         hoje, setores do filtro e as horas da COFEN que valem
//   GET /api/pessoas/indicadores?inicio=&fim=&hospital=&setor= os seis indicadores com ficha técnica e parcelas
// Só leitura (permissão `pessoas.indicadores.ler`); o estabelecimento é o da sessão.
import { Controller, Get, Inject, Optional, Query, Req } from '@nestjs/common';
import type { ApoioIndicadoresPessoas, PainelIndicadoresPessoas } from '@sgh/contratos';
import { Permissao } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { sessaoDe } from '../../cadastro/comum.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../../config/public-api.js';
import { PORTA_INDICADORES_PESSOAS, type PortaIndicadoresPessoas } from './porta-indicadores.js';
import { PERMISSOES_INDICADORES_PESSOAS, ServicoIndicadoresPessoas } from './servico-indicadores.js';

const P = PERMISSOES_INDICADORES_PESSOAS;

/** A query chega como texto: o setor vira número (texto que não é número fica como está e o Zod recusa). */
export function filtroDaQuery(q: Record<string, string | undefined>): Record<string, unknown> {
  const vazio = (v: string | undefined) => v === undefined || v.trim() === '';
  const setor = q['setor'];
  return {
    inicio: q['inicio'],
    fim: q['fim'],
    hospital: vazio(q['hospital']) ? null : q['hospital'],
    setor: vazio(setor) ? null : /^\d+$/.test(String(setor)) ? Number(setor) : setor,
  };
}

@Controller('pessoas/indicadores')
export class IndicadoresPessoasController {
  readonly servico: ServicoIndicadoresPessoas;

  constructor(
    @Inject(PORTA_INDICADORES_PESSOAS) porta: PortaIndicadoresPessoas,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
  ) {
    this.servico = new ServicoIndicadoresPessoas(porta, configuracao);
  }

  @Get('apoio')
  @Permissao(P.ler)
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioIndicadoresPessoas> {
    return this.servico.apoio(sessaoDe(req));
  }

  @Get()
  @Permissao(P.ler)
  painel(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PainelIndicadoresPessoas> {
    return this.servico.painel(sessaoDe(req), filtroDaQuery(q));
  }
}
