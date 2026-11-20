// M59 (etapa 6): o cliente do painel da retrocompatibilidade (ADR 0033); a resposta é validada pelo contrato. A decisão
// e os passos mudam pelo registro gravado na tela (lerRegistroCoex/gravarRegistroCoex em api.ts, W0-09) ou, na exceção
// do parâmetro coexistencia.registro.modo, pelo registro versionado (D-RETRO-REGISTRO-F6).
import { esquemaPainelRetrocompatibilidade, type PainelRetrocompatibilidade } from '@sgh/contratos';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

export const URL_RETROCOMPATIBILIDADE = '/api/administracao/coexistencia/retrocompatibilidade';

export async function lerRetrocompatibilidade(): Promise<PainelRetrocompatibilidade> {
  const r = await fetch(URL_RETROCOMPATIBILIDADE, { headers: { accept: 'application/json' } });
  if (!r.ok) throw await erroDaResposta(r);
  return esquemaPainelRetrocompatibilidade.parse(await r.json());
}

/** A chave de texto de uma operação de retirada (o ponto do código separaria o caminho do vue-i18n). */
export const chaveOperacao = (operacao: string): string => operacao.replace(/\./g, '-');
