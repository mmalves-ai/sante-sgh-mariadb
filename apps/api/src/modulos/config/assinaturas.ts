// Fonte da tela "Testes de assinatura de dados (Sante SGH × legado)" (M03): só leitura dos arquivos do
// catálogo (docs/operacoes/catalogo) e dos resultados (tools/assinatura/resultados/<data>/
// <operacao>.<cod>.json). Nenhum acesso ao banco; nenhum valor de linha (os arquivos não têm).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  esquemaPainelAssinaturas,
  esquemaResultadoOperacao,
  type PainelAssinaturas,
  type ResultadoOperacao,
} from '@sgh/contratos';
import { fonteCatalogo, lerCatalogoOperacoes } from '@sgh/legado';

export interface FonteAssinaturas {
  painel(): PainelAssinaturas;
}

export const FONTE_ASSINATURAS = Symbol('FONTE_ASSINATURAS');

export interface CaminhosAssinaturas {
  readonly catalogo: string;
  readonly resultados: string;
}

export function caminhosPadrao(raiz: string, env: NodeJS.ProcessEnv = process.env): CaminhosAssinaturas {
  return {
    catalogo: resolve(raiz, env['SGH_CATALOGO_OPERACOES'] ?? 'docs/operacoes/catalogo'),
    resultados: resolve(raiz, env['SGH_RESULTADOS_ASSINATURA'] ?? 'tools/assinatura/resultados'),
  };
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Último resultado de cada operação POR estabelecimento (chave `operacao` + `hospital`). */
function ultimosResultados(pasta: string): Map<string, Map<string, ResultadoOperacao>> {
  const r = new Map<string, Map<string, ResultadoOperacao>>();
  if (!existsSync(pasta)) return r;
  const datas = readdirSync(pasta)
    .filter((d) => DATA.test(d))
    .sort()
    .reverse();
  for (const d of datas) {
    for (const f of readdirSync(resolve(pasta, d)).filter((x) => x.endsWith('.json'))) {
      let res: ResultadoOperacao;
      try {
        res = esquemaResultadoOperacao.parse(JSON.parse(readFileSync(resolve(pasta, d, f), 'utf8')));
      } catch {
        continue; // arquivo estranho na pasta: ignorado
      }
      let porHospital = r.get(res.operacao);
      if (!porHospital) r.set(res.operacao, (porHospital = new Map()));
      const atual = porHospital.get(res.hospital);
      if (!atual || atual.executadoEm < res.executadoEm) porHospital.set(res.hospital, res);
    }
  }
  return r;
}

function resumoDoResultado(
  r: ResultadoOperacao,
): PainelAssinaturas['operacoes'][number]['ultimasExecucoes'][string] {
  const resultados = r.cenarios.map((c) => c.resultado);
  const resultado = resultados.includes('diferencas')
    ? 'diferencas'
    : resultados.includes('sem-executor')
      ? 'sem-executor'
      : resultados.includes('verde')
        ? 'verde'
        : 'sem-referencia';
  const diferencasPorTipo: Record<string, number> = {};
  for (const c of r.cenarios) {
    for (const d of c.diferencas)
      if (!d.aceita) diferencasPorTipo[d.tipo] = (diferencasPorTipo[d.tipo] ?? 0) + 1;
  }
  const detalhes = r.cenarios
    .flatMap((c) =>
      c.diferencas
        .filter((d) => !d.aceita)
        .map((d) => ({
          cenario: c.cenario,
          tipo: d.tipo,
          elemento: d.elemento,
          esperado: d.esperado,
          obtido: d.obtido,
        })),
    )
    .slice(0, 20);
  return {
    executadoEm: r.executadoEm,
    resultado,
    diferencasPorTipo,
    ...(detalhes.length ? { detalhes } : {}),
  };
}

export function fonteArquivosAssinatura(
  caminhos: CaminhosAssinaturas,
  estabelecimentos: readonly string[],
): FonteAssinaturas {
  return {
    painel() {
      const cat = lerCatalogoOperacoes(caminhos.catalogo);
      const ultimos = ultimosResultados(caminhos.resultados);
      // M36 (regra 6): o estado mostrado é o efetivo (divergência na última reexecução volta a bloqueada).
      const efetivo = fonteCatalogo(cat, { pastaResultados: caminhos.resultados });
      return esquemaPainelAssinaturas.parse({
        estabelecimentos: [...estabelecimentos],
        operacoes: cat.operacoes.map((o) => {
          const u = ultimos.get(o.nome) ?? new Map<string, ResultadoOperacao>();
          return {
            nome: o.nome,
            modulo: o.modulo,
            descricao: o.descricao,
            origem: o.origem_especificacao,
            cenarios: [...o.cenarios_assinatura],
            estados: Object.fromEntries(
              estabelecimentos.map((e) => [e, efetivo.estado(o.nome, e) ?? 'bloqueada']),
            ),
            ultimasExecucoes: Object.fromEntries(
              [...u.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([h, r]) => [h, resumoDoResultado(r)]),
            ),
          };
        }),
      });
    },
  };
}
