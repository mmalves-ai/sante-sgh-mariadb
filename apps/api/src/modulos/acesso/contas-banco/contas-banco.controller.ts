// M59-F1 (ficha do M59, seção 4; painel novo, D-PAINEL-59): "Contas do banco de dados e privilégios", só consulta.
//   GET /api/administracao/acesso/contas-banco          inventário das contas, destino e situação de cada uma
//   GET /api/administracao/acesso/contas-banco/desvios  plano do privilégio mínimo por módulo × catálogo de segurança
//   GET /api/administracao/acesso/contas-banco/imutabilidade  M59-F3 (regra 6): quem ainda apaga registro clínico
// Permissão técnica e sensível acesso.contaBanco.ler (administrador do sistema e auditor): toda leitura permitida
// entra na trilha própria (@Auditar, evento acesso.contaBanco.consultada; sem trilha, 503 e nada sai); a guarda só
// registra a negação. Nenhuma rota revoga: os scripts são da TI, com autorização por passo.
import { resolve } from 'node:path';
import { Controller, Get, Inject, Optional, Req } from '@nestjs/common';
import {
  EVENTOS_AUDITAVEIS,
  PERMISSOES_M59_CODIGOS as P,
  type DesviosPrivilegiosResposta,
  type ImutabilidadeResposta,
  type InventarioContasBancoResposta,
} from '@sgh/contratos';
import { Auditar, Permissao } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { sessaoDe } from '../../cadastro/comum.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../../config/public-api.js';
import { RAIZES_DESLIGAMENTO, type RaizesDesligamento } from '../../coexistencia/public-api.js';
import { PORTA_CONTAS_BANCO, type PortaContasBanco } from './porta.js';
import { ServicoContasBanco } from './servico.js';

const BASE = 'administracao/acesso/contas-banco';

@Controller()
export class ContasBancoController {
  readonly servico: ServicoContasBanco;

  constructor(
    @Inject(PORTA_CONTAS_BANCO) porta: PortaContasBanco,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(RAIZES_DESLIGAMENTO) raizes: RaizesDesligamento | null = null,
  ) {
    this.servico = new ServicoContasBanco({
      porta,
      raizDesligamento:
        raizes?.desligamento ??
        resolve(process.cwd(), process.env['SGH_COEX_DESLIGAMENTO'] ?? 'docs/coexistencia/desligamento'),
      configuracao,
    });
  }

  @Get(BASE)
  @Permissao(P.contaBancoLer)
  @Auditar(EVENTOS_AUDITAVEIS.contasBancoConsultadas.codigo)
  inventario(@Req() req: RequisicaoAutorizada): Promise<InventarioContasBancoResposta> {
    const s = sessaoDe(req);
    return this.servico.inventario({ rede: s.rede, hospital: s.hospital });
  }

  @Get(`${BASE}/desvios`)
  @Permissao(P.contaBancoLer)
  @Auditar(EVENTOS_AUDITAVEIS.contasBancoConsultadas.codigo)
  desvios(@Req() req: RequisicaoAutorizada): Promise<DesviosPrivilegiosResposta> {
    const s = sessaoDe(req);
    return this.servico.desvios({ rede: s.rede, hospital: s.hospital });
  }

  @Get(`${BASE}/imutabilidade`)
  @Permissao(P.contaBancoLer)
  @Auditar(EVENTOS_AUDITAVEIS.contasBancoConsultadas.codigo)
  imutabilidade(@Req() req: RequisicaoAutorizada): Promise<ImutabilidadeResposta> {
    const s = sessaoDe(req);
    return this.servico.imutabilidade({ rede: s.rede, hospital: s.hospital });
  }
}
