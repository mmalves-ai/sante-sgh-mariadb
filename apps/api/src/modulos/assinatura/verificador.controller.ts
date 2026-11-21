// Verificador público de documentos (M49, etapa 3; ficha, seção 7; regra 9). Rotas:
//   GET /api/publico/verificar/:codigo      (pública, sem login; limite de taxa; só tipo, datas, profissional e resultado)
//   GET /api/documento/verificador/painel   (documento.verificador.ler: as consultas dos últimos 30 dias, agregadas)
// A página pública é /verificar/:codigo (o QR do documento assinado aponta para ela; aplicação do portal, sem a casca).
import { Controller, Get, Header, Inject, Param, Req } from '@nestjs/common';
import type { PainelVerificador, VerificacaoPublica } from '@sgh/contratos';
import { AuditadoNoHandler, Permissao, Publica } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { sessaoDe } from '../cadastro/comum.js';
import type { ServicoVerificador } from './aplicacao/verificador.js';

export const SERVICO_VERIFICADOR = Symbol('SERVICO_VERIFICADOR');

interface ReqPublica {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly ip?: string;
}

@Controller()
export class VerificadorController {
  constructor(@Inject(SERVICO_VERIFICADOR) private readonly servico: ServicoVerificador) {}

  @Get('publico/verificar/:codigo')
  @Header('cache-control', 'no-store')
  @Header('x-robots-tag', 'noindex')
  @Publica(
    'verificador público do documento assinado pelo código do QR (sem conteúdo clínico nem dado do paciente)',
  )
  @AuditadoNoHandler(
    'documento.registrarConsultaPublica: consulta_verificacao_documento (origem mascarada) com a trilha na mesma transação',
  )
  verificar(@Param('codigo') codigo: string, @Req() req: ReqPublica): Promise<VerificacaoPublica> {
    return this.servico.verificar(
      String(codigo ?? '').slice(0, 80),
      req.ip ?? null,
      correlacaoDaRequisicao(req, 'verificador'),
    );
  }

  // Leitura agregada, sem trilha (contagens por dia e resultado; nada por pessoa nem por documento).
  @Get('documento/verificador/painel')
  @Permissao('documento.verificador.ler')
  painel(@Req() req: RequisicaoAutorizada): Promise<PainelVerificador> {
    return this.servico.painel(sessaoDe(req));
  }
}
