// O resumo do ensaio da conversão para UTF-8 do hospital (M58-F3; ficha, seções 5, 7, 11 e 12) para o cartão
// "Plataforma do banco" e para a prontidão do desligamento: lê o relatório versionado (docs/marcos/M58/<h>/utf8.json,
// gerado pelo ensaio sobre a cópia em Firebird 5), reavalia cada etapa pelos números (a situação escrita só vale se os
// números a sustentam), estima a janela, junta os índices que pedem página maior e o que o registro dos passos diz
// do ensaio. Não lê banco algum: o ensaio roda fora da API, na cópia; a produção nunca é tocada. Ausente ou fora do
// esquema: tudo "não executada", com o aviso (falha fechada).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  caminhoRelatorioEnsaioUtf8,
  esquemaRelatorioEnsaioUtf8,
  esquemaResumoEnsaioUtf8,
  type RegistroDesligamento,
  type RelatorioEnsaioUtf8,
  type ResumoEnsaioUtf8,
} from '@sgh/contratos';
import {
  avaliarEtapasEnsaioUtf8,
  ensaioUtf8Aprovavel,
  estimarJanelaUtf8Minutos,
  relatorioEnsaioUtf8Vazio,
} from '@sgh/dominio-config';

export interface RelatorioEnsaioUtf8Lido {
  readonly relatorio: RelatorioEnsaioUtf8 | null;
  readonly invalido: string | null;
}

/** O relatório do ensaio em `<raiz>/<h>/utf8.json` (raiz: docs/marcos/M58, ou SGH_M58_ENSAIOS). */
export function lerRelatorioEnsaioUtf8(raiz: string, hospital: string): RelatorioEnsaioUtf8Lido {
  const p = join(raiz, hospital, 'utf8.json');
  if (!existsSync(p)) return { relatorio: null, invalido: 'ensaio ainda não executado' };
  try {
    const r = esquemaRelatorioEnsaioUtf8.safeParse(JSON.parse(readFileSync(p, 'utf8')));
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

export function resumirEnsaioUtf8(
  hospital: string,
  em: Date,
  lido: RelatorioEnsaioUtf8Lido,
  registro: RegistroDesligamento,
): ResumoEnsaioUtf8 {
  const r =
    lido.relatorio ??
    relatorioEnsaioUtf8Vazio(
      hospital,
      em.toISOString().slice(0, 10),
      { versaoMotor: '', charset: 'NONE' },
      { versaoMotor: '', charset: 'UTF8' },
    );
  const etapas = avaliarEtapasEnsaioUtf8(r);
  const reg = registro.passos.utf8.ensaio;
  const e = r.etapas;
  const lidoOk = lido.relatorio !== null;
  return esquemaResumoEnsaioUtf8.parse({
    hospital,
    em: em.toISOString(),
    relatorio: caminhoRelatorioEnsaioUtf8(hospital),
    relatorioInvalido: lido.invalido,
    ensaiadoEm: lidoOk ? r.em : null,
    origem: lidoOk ? `${r.origem.versaoMotor} (${r.origem.charset})` : null,
    alvo: lidoOk ? `${r.alvo.versaoMotor} (${r.alvo.charset})` : null,
    etapas,
    aprovavel: lidoOk && ensaioUtf8Aprovavel(etapas),
    // A janela: o bombeamento e a prova de equivalência (a verificação depois da janela da ficha).
    janelaMinutos: lidoOk ? estimarJanelaUtf8Minutos(e.conversao.segundos, e.equivalencia.segundos) : null,
    indicesEstourados: lidoOk ? e.indices.estouram : [],
    paginaAlvo: lidoOk ? e.indices.paginaAlvo : null,
    firebird5Aprovado: registro.passos.firebird5.ensaio?.resultado === 'aprovado',
    registro: reg ? { data: reg.data, resultado: reg.resultado } : null,
  });
}

/** O resumo do hospital a partir da raiz dos ensaios (sem raiz: como se não houvesse ensaio). */
export function lerRegistroEnsaioUtf8(
  raiz: string | null,
  hospital: string,
  em: Date,
  registro: RegistroDesligamento,
): ResumoEnsaioUtf8 {
  const lido = raiz
    ? lerRelatorioEnsaioUtf8(raiz, hospital)
    : { relatorio: null, invalido: 'pasta dos ensaios não configurada' };
  return resumirEnsaioUtf8(hospital, em, lido, registro);
}
