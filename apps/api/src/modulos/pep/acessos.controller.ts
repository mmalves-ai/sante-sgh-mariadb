// Registro de acesso ao prontuário (M15; ficha, seção 7) — `Administração > Auditoria e privacidade >
// Registro de acesso ao prontuário`: as leituras do prontuário (quem, quando, de onde, paciente e registro por
// ID, parte aberta e motivo; o ator real numa sessão "como"), por paciente, usuário e período, 100 por página.
// Papéis Auditor (e a opção de auditoria do PEP); exportar é só do perfil. Nenhum dado clínico nem nome.
//   GET /api/administracao/auditoria/acessos-prontuario?paciente&usuario&de&ate&pagina
//   GET /api/administracao/auditoria/acessos-prontuario/exportar?…   CSV (separador ";")
import { Controller, Get, Header, Inject, Query, Req, Res } from '@nestjs/common';
import { esquemaFiltrosAcessos, type FiltrosAcessos, type ListaAcessos } from '@sgh/contratos';
import { Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import { SERVICO_PRONTUARIO } from './prontuario.controller.js';
import { csvAcessos, type ServicoProntuario } from './servico.js';

interface RespostaCsv {
  header(nome: string, valor: string): RespostaCsv;
}

function filtros(q: Record<string, string>): FiltrosAcessos {
  const f = esquemaFiltrosAcessos.safeParse(q);
  if (!f.success) throw new ErroProblema('entrada-invalida', 400, 'Filtro inválido', 'Confira os filtros.');
  return f.data;
}

function chave(f: FiltrosAcessos, n: number): string {
  // Na trilha, os filtros por ID e a quantidade (o usuário consultado entra como filtro, sem dado clínico).
  return [`pac:${f.paciente ?? '-'}`, `usu:${f.usuario ? 'sim' : '-'}`, `p:${f.pagina}`, `n:${n}`].join(';');
}

@Controller('administracao/auditoria/acessos-prontuario')
export class AcessosProntuarioController {
  constructor(@Inject(SERVICO_PRONTUARIO) private readonly servico: ServicoProntuario) {}

  @Get()
  @Permissao('auditoria.acessos.ler')
  @Auditar('auditoria.acessos.consultados')
  async listar(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaAcessos> {
    const s = sessaoDe(req);
    const f = filtros(q);
    const r = await this.servico.acessos(s.porta, f);
    req.sghAlvo = {
      tabelaAlvo: 'SGH_TRILHA',
      ...(f.paciente ? { paciente: f.paciente } : {}),
      chaveNaturalAlvo: chave(f, r.itens.length),
    };
    return r;
  }

  @Get('exportar')
  @Permissao('auditoria.acessos.exportar')
  @Auditar('auditoria.acessos.exportados')
  @Header('content-type', 'text/csv; charset=utf-8')
  async exportar(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: RespostaCsv,
  ): Promise<string> {
    const s = sessaoDe(req);
    const f = filtros(q);
    const r = await this.servico.acessos(s.porta, f);
    req.sghAlvo = {
      tabelaAlvo: 'SGH_TRILHA',
      ...(f.paciente ? { paciente: f.paciente } : {}),
      chaveNaturalAlvo: `exportar;${chave(f, r.itens.length)}`,
    };
    res.header(
      'content-disposition',
      `attachment; filename="acessos-prontuario-${s.hospital}-p${f.pagina}.csv"`,
    );
    return csvAcessos(r);
  }
}
