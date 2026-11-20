// Tradução das falhas de validação de @sgh/contratos (código + parâmetros) pelo vue-i18n (regra 15).
import { type FalhaValidacao, falhaDe } from '@sgh/contratos';

type Tradutor = (chave: string, parametros?: Record<string, unknown>) => string;

export function traduzirFalha(t: Tradutor, falha: FalhaValidacao): string {
  const p = falha.parametros;
  if (falha.codigo.startsWith('cp1252.')) {
    const mais = Number(p['mais'] ?? 0);
    return (
      t(`ui.validacao.${falha.codigo}`, { ...p }) +
      (mais > 0 ? t('ui.validacao.cp1252.mais', { mais }) : '') +
      t(p['comTroca'] ? 'ui.validacao.cp1252.comTroca' : 'ui.validacao.cp1252.semTroca')
    );
  }
  return t(`ui.validacao.${falha.codigo}`, { ...p });
}

/** Erro lançado por um contrato → texto traduzido (erro desconhecido → mensagem genérica, sem detalhe). */
export function traduzirErro(t: Tradutor, erro: unknown): string {
  const f = falhaDe(erro);
  return f ? traduzirFalha(t, f) : t('ui.validacao.desconhecida');
}

/** Issue do esquemaTextoCp1252 (params.codigo/parametros) → falha. */
export function falhaDoIssue(issue: { params?: Record<string, unknown> } | undefined): FalhaValidacao | null {
  const codigo = issue?.params?.['codigo'];
  const parametros = issue?.params?.['parametros'];
  if (typeof codigo !== 'string' || typeof parametros !== 'object' || parametros === null) return null;
  return {
    codigo: codigo as FalhaValidacao['codigo'],
    parametros: parametros as FalhaValidacao['parametros'],
  };
}
