// Fim da coexistência por hospital (M43; ficha, campo 7): a aba da tela "Migração gradual dos usuários" e a revisão dos
// usuários sem grupo e dos logins de painel. Só leitura; as ações são as rotas do M10 (troca de grupo e bloqueio, com
// a regra 4 no bloqueio do login de painel) e do M19 (conferir o aparelho no setor).
//   GET /api/administracao/coexistencia/migracao/fim           painel do critério (cap-15) e do conjunto do cap-14
//   GET /api/administracao/coexistencia/migracao/fim/revisao   ativos sem grupo e logins de painel (leitura na trilha)
import { resolve } from 'node:path';
import { Controller, Get, Inject, Optional, Req } from '@nestjs/common';
import { PERMISSOES_M43, type RevisaoFimCoexistencia, type TelaFimCoexistencia } from '@sgh/contratos';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  CAMINHO_CATALOGO_LIBERACAO,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { PORTA_RECEPCAO, type PortaRecepcao } from '../recepcao/public-api.js';
import { ServicoFimCoexistencia } from './aplicacao/fim.js';
import { modoRegistroPelaConfiguracao, ServicoRegistroCoex } from './aplicacao/registro.js';
import { PORTA_COEXISTENCIA, type PortaCoexistencia } from './porta.js';

const BASE = 'administracao/coexistencia/migracao/fim';

/** A pasta do registro versionado do fim por hospital (SGH_COEX_FIM; padrão docs/coexistencia/fim). */
export const RAIZ_FIM_COEXISTENCIA = Symbol('RAIZ_FIM_COEXISTENCIA');
export const raizFimDoAmbiente = (env: NodeJS.ProcessEnv): string =>
  resolve(process.cwd(), env['SGH_COEX_FIM'] ?? 'docs/coexistencia/fim');

@Controller()
export class FimCoexistenciaController {
  readonly servico: ServicoFimCoexistencia;

  constructor(
    @Inject(PORTA_COEXISTENCIA) porta: PortaCoexistencia,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Inject(CAMINHO_CATALOGO_LIBERACAO) caminhoCatalogo: string,
    @Optional() @Inject(PORTA_RECEPCAO) recepcao: PortaRecepcao | null = null,
    @Optional() @Inject(RAIZ_FIM_COEXISTENCIA) raizFim: string | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
  ) {
    this.servico = new ServicoFimCoexistencia({
      porta,
      trilha,
      caminhoCatalogo,
      raizFim: raizFim ?? raizFimDoAmbiente(process.env),
      dispositivos: recepcao ? (c) => recepcao.dispositivos(c) : undefined,
      // W0-09 (D-RETRO-REGISTRO-F6): o registro gravado pela tela vale sobre o arquivo quando o modo é 'tela'.
      registroGravado: new ServicoRegistroCoex(
        porta,
        modoRegistroPelaConfiguracao(() => configuracao),
      ).vigente,
    });
  }

  @Get(BASE)
  @Permissao(PERMISSOES_M43.painelFimLer)
  painel(@Req() req: RequisicaoAutorizada): Promise<TelaFimCoexistencia> {
    return this.servico.painel(sessaoDe(req));
  }

  @Get(`${BASE}/revisao`)
  @Permissao(PERMISSOES_M43.usuarioLer)
  revisao(@Req() req: RequisicaoAutorizada): Promise<RevisaoFimCoexistencia> {
    return this.servico.revisao(sessaoDe(req));
  }
}
