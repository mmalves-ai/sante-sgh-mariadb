// O resumo do ensaio do Firebird 5 do hospital (M58-F2; ficha, seções 5, 7, 11 e 12) para o cartão "Plataforma do
// banco" e para a prontidão do desligamento: lê o relatório versionado (docs/marcos/M58/<h>/firebird5.json, gerado
// pelo `pnpm ensaio:firebird5` sobre a cópia de ensaio), reavalia cada etapa pelos números (a situação escrita só vale
// se os números a sustentam), estima a janela e junta o que o registro dos passos diz do ensaio. Não lê banco algum:
// o ensaio roda fora da API, na cópia; a produção nunca é tocada. Ausente ou fora do esquema: tudo "não executada",
// com o aviso (falha fechada).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  caminhoRelatorioEnsaioFirebird5,
  esquemaRelatorioEnsaioFirebird5,
  esquemaResumoEnsaioFirebird5,
  type RegistroDesligamento,
  type RelatorioEnsaioFirebird5,
  type ResumoEnsaioFirebird5,
} from '@sgh/contratos';
import {
  avaliarEtapasEnsaio,
  ensaioAprovavel,
  estimarJanelaMinutos,
  relatorioEnsaioVazio,
} from '@sgh/dominio-config';

export interface RelatorioEnsaioLido {
  readonly relatorio: RelatorioEnsaioFirebird5 | null;
  readonly invalido: string | null;
}

/** O relatório do ensaio em `<raiz>/<h>/firebird5.json` (raiz: docs/marcos/M58, ou SGH_M58_ENSAIOS). */
export function lerRelatorioEnsaioFirebird5(raiz: string, hospital: string): RelatorioEnsaioLido {
  const p = join(raiz, hospital, 'firebird5.json');
  if (!existsSync(p)) return { relatorio: null, invalido: 'ensaio ainda não executado' };
  try {
    const r = esquemaRelatorioEnsaioFirebird5.safeParse(JSON.parse(readFileSync(p, 'utf8')));
    if (!r.success)
      return {
        relatorio: null,
        invalido: `relatório fora do esquema: ${r.error.issues[0]?.message ?? 'inválido'}`,
      };
    if (r.data.estabelecimento !== hospital)
      return { relatorio: null, invalido: 'relatório de outro estabelecimento' };
    return { relatorio: r.data, invalido: null };
  } catch {
    return { relatorio: null, invalido: 'relatório ilegível' };
  }
}

export function resumirEnsaioFirebird5(
  hospital: string,
  em: Date,
  lido: RelatorioEnsaioLido,
  registro: RegistroDesligamento,
): ResumoEnsaioFirebird5 {
  const r =
    lido.relatorio ??
    relatorioEnsaioVazio(
      hospital,
      em.toISOString().slice(0, 10),
      { versaoMotor: '', ods: '' },
      { versaoMotor: '', ods: '' },
    );
  const etapas = avaliarEtapasEnsaio(r);
  const reg = registro.passos.firebird5.ensaio;
  const e = r.etapas;
  return esquemaResumoEnsaioFirebird5.parse({
    hospital,
    em: em.toISOString(),
    relatorio: caminhoRelatorioEnsaioFirebird5(hospital),
    relatorioInvalido: lido.invalido,
    ensaiadoEm: lido.relatorio ? r.em : null,
    origem: lido.relatorio ? `${r.origem.versaoMotor} (ODS ${r.origem.ods})` : null,
    alvo: lido.relatorio ? `${r.alvo.versaoMotor} (ODS ${r.alvo.ods})` : null,
    etapas,
    aprovavel: lido.relatorio !== null && ensaioAprovavel(etapas),
    // A verificação depois da janela: integridade e contagens por tabela (a prova pós-janela da ficha).
    janelaMinutos: estimarJanelaMinutos(
      e.backup.segundos,
      e.restauracao.segundos,
      (e.restauracao.verificacaoSegundos ?? 0) + (e.contagens.segundos ?? 0),
    ),
    funcoes: e['funcoes-externas'].funcoes,
    registro: reg ? { data: reg.data, resultado: reg.resultado } : null,
  });
}

/** O resumo do hospital a partir da raiz dos ensaios (sem raiz: como se não houvesse ensaio). */
export function lerRegistroEnsaio(
  raiz: string | null,
  hospital: string,
  em: Date,
  registro: RegistroDesligamento,
): ResumoEnsaioFirebird5 {
  const lido = raiz
    ? lerRelatorioEnsaioFirebird5(raiz, hospital)
    : { relatorio: null, invalido: 'pasta dos ensaios não configurada' };
  return resumirEnsaioFirebird5(hospital, em, lido, registro);
}
