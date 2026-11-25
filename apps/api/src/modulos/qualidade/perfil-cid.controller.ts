// Hierarquia da CID-10 e perfil epidemiológico por capítulo (F7, 09-AREA linha 83). Só leitura. Rotas:
//   GET /api/qualidade/vigilancia/perfil-cid/hierarquia       capítulos, grupos e subgrupos vigentes da CID-10
//   GET /api/qualidade/vigilancia/perfil-cid/cid/:codigo      capítulo, grupo e subgrupos de um código (ex.: I21.9)
//   GET /api/qualidade/vigilancia/perfil-cid?desde&ate&principal&suspeitos
//                                                             ocorrências de diagnóstico do estabelecimento no período,
//                                                             por capítulo, grupo e subgrupo
// A permissão é a de consulta da vigilância epidemiológica (qualidade.agravo.ler). Só contagens: nenhum dado de pessoa
// sai da rota, e por isso a leitura não vai à trilha de conteúdo clínico.
import { Controller, Get, Inject, Optional, Param, Query, Req } from '@nestjs/common';
import { PERMISSOES_AGRAVO as P } from '@sgh/contratos';
import { MENSAGENS_PERFIL_CID, normalizarCid, periodoDoPerfilCid } from '@sgh/dominio-qualidade';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import type { PortaPerfilCidPropria } from './porta-perfil-cid-propria.js';

export const PORTA_PERFIL_CID = Symbol('PORTA_PERFIL_CID');

const indisponivel = () =>
  new ErroProblema(
    'indisponivel',
    503,
    'Perfil epidemiológico',
    'O perfil pela CID-10 precisa do banco do cliente configurado.',
  );
const invalido = (detalhe: string) => new ErroProblema('entrada-invalida', 400, 'Dados inválidos', detalhe);
const sim = (v?: string) => v === 'true' || v === '1';

@Controller('qualidade/vigilancia/perfil-cid')
export class PerfilCidController {
  constructor(
    @Optional()
    @Inject(PORTA_PERFIL_CID)
    private readonly porta: PortaPerfilCidPropria | null = null,
  ) {}

  private p(): PortaPerfilCidPropria {
    if (!this.porta) throw indisponivel();
    return this.porta;
  }

  @Get('hierarquia')
  @Permissao(P.ler)
  hierarquia(@Req() req: RequisicaoAutorizada) {
    return this.p().hierarquia(sessaoDe(req).porta);
  }

  @Get('cid/:codigo')
  @Permissao(P.ler)
  async cid(@Param('codigo') codigo: string, @Req() req: RequisicaoAutorizada) {
    const cid = normalizarCid(codigo);
    if (!cid) throw invalido(MENSAGENS_PERFIL_CID.cidInvalido);
    const r = await this.p().localizar(sessaoDe(req).porta, cid);
    if (!r)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'CID não encontrado',
        MENSAGENS_PERFIL_CID.cidForaDaHierarquia,
      );
    return r;
  }

  @Get()
  @Permissao(P.ler)
  perfil(
    @Req() req: RequisicaoAutorizada,
    @Query('desde') desde?: string,
    @Query('ate') ate?: string,
    @Query('principal') principal?: string,
    @Query('suspeitos') suspeitos?: string,
  ) {
    const hoje = new Date().toISOString().slice(0, 10);
    const inicioMes = `${hoje.slice(0, 7)}-01`;
    const periodo = periodoDoPerfilCid(desde || inicioMes, ate || hoje);
    if (!periodo) throw invalido(MENSAGENS_PERFIL_CID.periodoInvalido);
    return this.p().perfil(sessaoDe(req).porta, {
      ...periodo,
      apenasPrincipal: sim(principal),
      incluirSuspeitos: sim(suspeitos),
    });
  }
}
