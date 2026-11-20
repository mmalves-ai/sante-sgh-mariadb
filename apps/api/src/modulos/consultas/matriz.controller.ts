// Painel da matriz de cobertura (M14; ficha, seção 7; cap-10 §10.10): as tabelas com dados por área, destino,
// marco e atendimento (tela, consulta, importador, descartada ou marco seguinte), as descartadas com a
// justificativa e a vigia das tabelas vazias do estabelecimento. Só leitura; permissão `config.matriz.ler`.
import { Controller, Get, Inject, Req } from '@nestjs/common';
import { ATENDIMENTOS_MATRIZ, type PainelMatriz } from '@sgh/contratos';
import { PAINEL_MATRIZ } from '@sgh/legado';
import { Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { FONTE_CONSULTAS, type FonteConsultas } from './fonte.js';

@Controller('administracao/coexistencia/matriz')
export class MatrizController {
  constructor(@Inject(FONTE_CONSULTAS) private readonly fonte: FonteConsultas) {}

  @Get()
  @Permissao('config.matriz.ler')
  async painel(@Req() req: RequisicaoAutorizada): Promise<PainelMatriz> {
    const a = req.sgh;
    const hospital = a?.sessao.estabelecimentoAtivo;
    if (!a || !hospital) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    const tabelas = PAINEL_MATRIZ.linhas.map(
      ([tabela, codigo, destino, marco, atendimento, linhas, justificativa]) => ({
        tabela,
        codigo,
        destino,
        marco,
        atendimento,
        linhas,
        justificativa,
      }),
    );
    const porCodigo = new Map<string, Record<(typeof ATENDIMENTOS_MATRIZ)[number], number>>();
    for (const t of tabelas) {
      const x = porCodigo.get(t.codigo) ?? Object.fromEntries(ATENDIMENTOS_MATRIZ.map((k) => [k, 0]));
      x[t.atendimento] = (x[t.atendimento] ?? 0) + 1;
      porCodigo.set(t.codigo, x as Record<(typeof ATENDIMENTOS_MATRIZ)[number], number>);
    }
    const conta = (k: string) => tabelas.filter((t) => t.atendimento === k).length;
    let vazias: PainelMatriz['vazias'] = null;
    try {
      const v = await this.fonte.tabelasVazias({ rede: a.sessao.rede ?? '', hospital });
      if (v)
        vazias = {
          vazias: v.filter((x) => x.situacao === 'vazia').length,
          registradas: v.filter((x) => x.situacao === 'registrada').length,
          comDados: v
            .filter((x) => x.situacao === 'passou-a-ter-dados')
            .map((x) => ({ tabela: x.tabela, desde: x.primeiraComDados, avisadoEm: x.avisadoEm })),
          ultimaVerificacao:
            v
              .map((x) => x.ultimaVerificacao)
              .sort()
              .reverse()[0] ?? null,
        };
    } catch {
      vazias = null;
    }
    return {
      geradoEm: PAINEL_MATRIZ.geradoEm,
      resumo: {
        total: tabelas.length,
        atendidas: conta('tela') + conta('consulta') + conta('importador'),
        descartadas: conta('descartada'),
        pendentes: conta('pendente'),
      },
      porCodigo: [...porCodigo]
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([codigo, porAtendimento]) => ({
          codigo,
          total: Object.values(porAtendimento).reduce((s, n) => s + n, 0),
          porAtendimento,
        })),
      tabelas,
      vazias,
    };
  }
}
