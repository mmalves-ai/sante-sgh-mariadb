// M59-F5 (ficha do M59, seção 4, "Prova da trilha"; cap-13 §13.6.3; SBIS-16 a 19, 21): a trilha exportada para a
// auditoria. O corpo é o mesmo da exportação do M10 (as duas trilhas, CSV sem fórmula ou XML); antes dele vão a
// identificação (software, versão, ambiente, estabelecimento, CNES, CNPJ, período, geração em RFC 3339 e quem gerou)
// e a prova da cadeia de hash da trilha própria no período.
import type { IdentificacaoExportacao, LinhaTrilha, ProvaCadeia } from '@sgh/contratos';
import { camposIdentificacao, camposProva } from '@sgh/dominio-acesso';
import { celulaCsv, exportarTrilha } from '../auditoria.controller.js';

const escapar = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function exportarTrilhaSbis(
  linhas: readonly LinhaTrilha[],
  formato: 'csv' | 'xml',
  identificacao: IdentificacaoExportacao,
  prova: ProvaCadeia,
  corte: { cortado: boolean; teto: number },
): string {
  const campos = [...camposIdentificacao(identificacao), ...camposProva(prova)];
  if (formato === 'csv')
    return [
      ...campos.map(([k, v]) => `${celulaCsv(`# ${k}`)};${celulaCsv(v)}`),
      exportarTrilha(linhas, 'csv', corte),
    ].join('\r\n');
  const corpo = exportarTrilha(linhas, 'xml', corte).replace(/^<\?xml[^>]*>\n/, '');
  const atributos = (lista: [string, string][]) => lista.map(([k, v]) => `${k}="${escapar(v)}"`).join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<exportacaoTrilha>\n  <identificacao ${atributos(
    camposIdentificacao(identificacao),
  )}/>\n  <provaCadeia ${atributos(camposProva(prova))}/>\n${corpo}</exportacaoTrilha>\n`;
}
