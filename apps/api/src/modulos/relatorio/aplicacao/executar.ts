// Emissão e exportação dos relatórios do catálogo (M34; ficha, regras 1, 3 e 4; cap-07 §7.5.1; cap-08 §8.13):
//   - só os relatórios do catálogo (as consultas revisadas do repositório; SQL livre não entra: o código do relatório
//     escolhe a consulta, os valores vão como parâmetro), com a permissão de emitir do relatório, a chave liberada no
//     estabelecimento e o acesso de origem (quem não tinha o relatório de origem não ganha);
//   - parâmetros tipados pelo Zod do relatório (os relativos, como "mês anterior", resolvidos no dia do banco);
//   - teto de linhas e tempo por relatório (parâmetro do sistema): acima, o driver cancela e a mensagem é em português;
//   - coluna com dado de pessoa sai mascarada sem `relatorio.dadoPessoal.ver`; exportar o que sai sem máscara exige a
//     justificativa, gravada na execução e na trilha; toda emissão e exportação fica em execucao_relatorio (só o resumo
//     SHA-256 dos parâmetros, nunca os valores) com a trilha na mesma transação.
import {
  EVENTOS_AUDITAVEIS,
  esquemaParametrosRelatorio,
  esquemaPedidoExecucaoRelatorio,
  esquemaPedidoExportacaoRelatorio,
  type FormatoExportacao,
  permissaoExecutarRelatorio,
  permissaoExportarRelatorio,
  PERMISSOES_M34_CODIGOS,
  type RelatorioCatalogo,
  type RelatorioDescrito,
  relatorioDoCatalogo,
  RELATORIOS_CATALOGO,
  type ResultadoRelatorio,
  chaveLiberacaoRelatorio,
  temDadoPessoal,
} from '@sgh/contratos';
import {
  exportacaoExigeJustificativa,
  mascararLinhas,
  resolverParametros,
  textoCanonicoParametros,
  totaisDasLinhas,
} from '@sgh/dominio-relatorio';
import { ErroRelatorio, type LinhaRelatorio } from '../tipos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { exigir, linhaTrilha, type SessaoCadastro } from '../../cadastro/comum.js';
import type { PortaRelatorio } from '../porta.js';
import type { ConfiguracaoM34 } from './configuracao.js';
import { gerarArquivo, type GeradorPdf } from './exportar.js';

const sufixo = (codigo: string) => codigo.charAt(0).toUpperCase() + codigo.slice(1);
const sujeito = (s: SessaoCadastro) => ({
  rede: s.rede,
  hospital: s.hospital,
  login: s.login,
  setor: s.req.sgh?.sessao.unidadeAtiva ?? null,
});

export function relatorioOu404(codigo: string): RelatorioCatalogo {
  const r = /^[a-zA-Z]{2,60}$/.test(codigo) ? relatorioDoCatalogo(codigo) : undefined;
  if (!r) throw new ErroProblema('nao-encontrado', 404, 'Relatório não encontrado no catálogo');
  return r;
}

function entradaInvalida(detalhe: string, campos: string[] = []): ErroProblema {
  return new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', detalhe, { campos });
}

export interface ArquivoExportado {
  readonly conteudo: Uint8Array;
  readonly tipo: string;
  readonly nome: string;
}

export class ServicoExecucao {
  constructor(
    private readonly porta: PortaRelatorio,
    private readonly trilha: RegistradorTrilha,
    private readonly config: ConfiguracaoM34,
    private readonly pdf: GeradorPdf | null,
    private readonly produto: string,
  ) {}

  /** O catálogo para a sessão: cada relatório com a liberação, o motivo e o que a pessoa pode fazer. */
  async catalogo(s: SessaoCadastro): Promise<RelatorioDescrito[]> {
    const estados = await this.config.estados(
      sujeito(s),
      RELATORIOS_CATALOGO.map((r) => chaveLiberacaoRelatorio(r.codigo)),
    );
    const veDado = s.pode(PERMISSOES_M34_CODIGOS.dadoPessoalVer);
    return Promise.all(
      RELATORIOS_CATALOGO.map(async (r) => {
        const e = estados[chaveLiberacaoRelatorio(r.codigo)]!;
        const limites = await this.limites(s, r);
        return {
          codigo: r.codigo,
          titulo: r.titulo,
          descricao: r.descricao,
          area: r.area,
          papelDono: r.papelDono,
          onda: r.onda,
          fonte: r.fonte,
          regua: r.regua,
          formula: r.formula,
          parametros: r.parametros.map((p) => ({ ...p, opcoes: p.opcoes ? [...p.opcoes] : undefined })),
          colunas: r.colunas.map((c) => ({ ...c })),
          tetoLinhas: limites.teto,
          tempoMaximoMs: limites.tempoMaximoMs,
          conferencia: { ...r.conferencia },
          liberado: e.ligado,
          motivo: e.motivo,
          podeExecutar: s.pode(permissaoExecutarRelatorio(r.codigo)),
          podeExportar: s.pode(permissaoExportarRelatorio(r.codigo)),
          veDadoPessoal: veDado,
        };
      }),
    );
  }

  /** Teto de linhas e tempo do relatório (parâmetro do sistema; sem a fonte, o da definição). */
  async limites(s: SessaoCadastro, r: RelatorioCatalogo): Promise<{ teto: number; tempoMaximoMs: number }> {
    const teto = await this.config.inteiro(s, `relatorio.tetoLinhas${sufixo(r.codigo)}`, r.tetoLinhas);
    const seg = await this.config.inteiro(
      s,
      `relatorio.tempoMaximoSegundos${sufixo(r.codigo)}`,
      Math.round(r.tempoMaximoMs / 1000),
    );
    return { teto, tempoMaximoMs: seg * 1000 };
  }

  /** Os valores validados (relativos resolvidos no dia do banco; o Zod do relatório decide). */
  async valores(s: SessaoCadastro, r: RelatorioCatalogo, brutos: Record<string, unknown>) {
    const conhecidos = new Set(r.parametros.map((p) => p.campo));
    const estranhos = Object.keys(brutos).filter((k) => !conhecidos.has(k));
    if (estranhos.length)
      throw entradaInvalida(`Parâmetro desconhecido: ${estranhos.join(', ')}.`, estranhos);
    const { hoje } = await this.porta.relogio(s.porta);
    const resolvidos = resolverParametros(r, brutos, hoje);
    const v = esquemaParametrosRelatorio(r).safeParse(resolvidos);
    if (!v.success)
      throw entradaInvalida(
        v.error.issues.map((i) => i.message).join(' '),
        v.error.issues.map((i) => String(i.path[0] ?? '')),
      );
    return v.data as Record<string, string | number>;
  }

  private async exigirAcesso(s: SessaoCadastro, r: RelatorioCatalogo, exportar: boolean): Promise<void> {
    await exigir(s, permissaoExecutarRelatorio(r.codigo), this.trilha);
    if (exportar) await exigir(s, permissaoExportarRelatorio(r.codigo), this.trilha);
    await this.config.exigir(sujeito(s), chaveLiberacaoRelatorio(r.codigo));
    const origem = await this.porta.acessoDeOrigem(s.porta, r.codigo, s.login);
    if (!origem.permitido)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem acesso a este relatório',
        'Os relatórios que este substitui eram restritos a grupos e usuários: o seu acesso não estava entre eles.',
        { codigo: 'acesso-de-origem' },
      );
  }

  private async registrar(
    s: SessaoCadastro,
    r: RelatorioCatalogo,
    x: {
      tipo: 'execucao' | 'exportacao';
      formato: 'grade' | FormatoExportacao;
      valores: Record<string, string | number>;
      linhas: number;
      duracaoMs: number;
      mascarado: boolean;
      justificativa: string | null;
      situacao: 'ok' | 'cancelada' | 'recusada' | 'falhou';
    },
  ): Promise<string> {
    const evento =
      x.tipo === 'exportacao'
        ? EVENTOS_AUDITAVEIS.relatorioExportado.codigo
        : EVENTOS_AUDITAVEIS.relatorioExecutado.codigo;
    return this.porta.gravarSgh(
      s.porta,
      (id: string) =>
        linhaTrilha(s, evento, `relatorio.${r.codigo}`, `${x.tipo}:${x.formato}:${x.situacao}`, {
          tabela: 'execucao_relatorio',
          id,
          chave: r.codigo,
        }),
      (g) =>
        g.registrarExecucao({
          relatorio: r.codigo,
          tipo: x.tipo,
          formato: x.formato,
          usuario: s.login,
          parametros: textoCanonicoParametros(x.valores),
          linhas: x.linhas,
          duracaoMs: x.duracaoMs,
          dadoPessoal: temDadoPessoal(r),
          mascarado: x.mascarado,
          justificativa: x.justificativa,
          situacao: x.situacao,
          agendamento: null,
        }),
    );
  }

  private async rodar(
    s: SessaoCadastro,
    r: RelatorioCatalogo,
    valores: Record<string, string | number>,
    tipo: 'execucao' | 'exportacao',
    formato: 'grade' | FormatoExportacao,
  ): Promise<{ linhas: LinhaRelatorio[]; duracaoMs: number }> {
    const limites = await this.limites(s, r);
    const inicio = performance.now();
    try {
      const { linhas } = await this.porta.executar(s.porta, r.codigo, valores, limites);
      return { linhas, duracaoMs: performance.now() - inicio };
    } catch (e) {
      if (!(e instanceof ErroRelatorio)) throw e;
      await this.registrar(s, r, {
        tipo,
        formato,
        valores,
        linhas: 0,
        duracaoMs: performance.now() - inicio,
        mascarado: true,
        justificativa: null,
        situacao: e.motivo === 'consulta' ? 'recusada' : 'cancelada',
      });
      throw new ErroProblema(
        'recusa-de-negocio',
        422,
        e.motivo === 'tempo' ? 'Relatório cancelado pelo tempo' : 'Relatório não emitido',
        e.message,
        {
          codigo:
            e.motivo === 'tempo'
              ? 'consulta-cancelada'
              : e.motivo === 'teto'
                ? 'teto-de-linhas'
                : 'consulta-recusada',
        },
      );
    }
  }

  /** Emitir na grade (regra 3; a máscara da regra 4). */
  async executar(s: SessaoCadastro, codigo: string, corpo: unknown): Promise<ResultadoRelatorio> {
    const r = relatorioOu404(codigo);
    const p = esquemaPedidoExecucaoRelatorio.safeParse(corpo);
    if (!p.success) throw entradaInvalida('Envie os parâmetros do relatório.');
    await this.exigirAcesso(s, r, false);
    const valores = await this.valores(s, r, p.data.parametros);
    const { linhas, duracaoMs } = await this.rodar(s, r, valores, 'execucao', 'grade');
    const m = mascararLinhas(r, linhas, s.pode(PERMISSOES_M34_CODIGOS.dadoPessoalVer));
    const execucao = await this.registrar(s, r, {
      tipo: 'execucao',
      formato: 'grade',
      valores,
      linhas: linhas.length,
      duracaoMs,
      mascarado: m.mascarado,
      justificativa: null,
      situacao: 'ok',
    });
    return {
      codigo: r.codigo,
      execucao,
      colunas: r.colunas.map((c) => ({ campo: c.campo, rotulo: c.rotulo, tipo: c.tipo })),
      linhas: m.linhas,
      totais: totaisDasLinhas(r, m.linhas),
      quantidade: linhas.length,
      duracaoMs: Math.round(duracaoMs),
      mascarado: m.mascarado,
      dadosAte: r.fonte === 'copia-diaria' ? 'cópia diária (dados até o fim do dia anterior)' : null,
    };
  }

  /** Exportar (CSV, XLSX ou PDF), sempre com a justificativa (W0-09; a regra 4 explica a do dado de pessoa). */
  async exportar(s: SessaoCadastro, codigo: string, corpo: unknown): Promise<ArquivoExportado> {
    const r = relatorioOu404(codigo);
    const p = esquemaPedidoExportacaoRelatorio.safeParse(corpo);
    if (!p.success)
      throw entradaInvalida(
        p.error.issues.map((i) => i.message).join(' '),
        p.error.issues.map((i) => String(i.path[0] ?? '')),
      );
    await this.exigirAcesso(s, r, true);
    const valores = await this.valores(s, r, p.data.parametros);
    const veDado = s.pode(PERMISSOES_M34_CODIGOS.dadoPessoalVer);
    // W0-09 (logs de acesso: LGPD art. 37; Dec. 8.771 art. 13): TODA exportação leva a justificativa, gravada na
    // execução e na trilha; com dado de pessoa sem máscara, a mensagem diz por quê. Antes da consulta: sem
    // justificativa, nada é lido.
    if (!p.data.justificativa)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Justificativa obrigatória',
        exportacaoExigeJustificativa(r, !veDado)
          ? 'Este relatório sai com dado de pessoa: escreva o motivo da exportação (fica registrado).'
          : 'Escreva o motivo da exportação (fica registrado com o arquivo gerado).',
        { campos: ['justificativa'], codigo: 'justificativa-obrigatoria' },
      );
    const { linhas, duracaoMs } = await this.rodar(s, r, valores, 'exportacao', p.data.formato);
    const m = mascararLinhas(r, linhas, veDado);
    const arquivo = await gerarArquivo(p.data.formato, {
      relatorio: r,
      linhas: m.linhas,
      totais: totaisDasLinhas(r, m.linhas),
      parametros: valores,
      produto: this.produto,
      estabelecimento: s.hospital,
      emitidoPor: s.login,
      emitidoEm: (await this.porta.relogio(s.porta)).agora,
      pdf: this.pdf,
    });
    await this.registrar(s, r, {
      tipo: 'exportacao',
      formato: p.data.formato,
      valores,
      linhas: linhas.length,
      duracaoMs,
      mascarado: m.mascarado,
      justificativa: p.data.justificativa,
      situacao: 'ok',
    });
    return { ...arquivo, nome: `${r.codigo}.${p.data.formato}` };
  }
}
